package plugin

import (
	"bytes"
	"context"
	"encoding"
	"encoding/json"
	"flag"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	sdkconfig "github.com/grafana/grafana-plugin-sdk-go/config"
)

// Contract goldens for the four App Platform response envelopes
// (docs/design/BACKEND_PROXY_PATTERN.md). Go and TypeScript describe these
// shapes twice, in two processes, so no compiler can couple them; these
// committed bytes are what does. `src/validation/backend-api-contract.test.ts`
// reads every file this test writes and parses it against the Zod schemas in
// `src/types/backend-api.schema.ts`, so a Go-side change lands as a TypeScript
// failure that names the field.
//
// Two golden families, because either alone leaves a hole:
//
//   - Value goldens, captured from the real handlers over httptest, catch a
//     handler that stops emitting a field its struct still declares.
//   - The tag golden (struct-tags.json) inventories json names, Go types,
//     normalized wire types and omitempty flags, and catches a struct that
//     GAINS an omitempty field. No fixture populates a brand-new field, so
//     every value golden stays byte-identical and both sides stay green while TypeScript
//     never learns the field exists.
//
// Regenerate both after an intentional envelope change:
//
//	go test ./pkg/plugin -run TestContract -update
//
// Deliberately absent: an error-envelope golden. The failure bodies on these
// routes are not a uniform contract (resources.go:35, :48, :58, :306 and :333
// emit text/plain via http.Error rather than the {error} JSON envelope), no
// TypeScript consumer reads them, and one shared fixture would encode a
// uniformity that does not exist.

var updateContractGoldens = flag.Bool("update", false, "rewrite the goldens under pkg/plugin/testdata/contract")

const contractGoldenDir = "testdata/contract"

// contractTagGolden holds the reflected struct-tag inventory. The value goldens
// are named "<schema-key>.<variant>.json"; the TypeScript side derives the
// schema key from everything before the first dot.
const contractTagGolden = "struct-tags.json"

// contractRoot is one response envelope: the reflected Go type plus the
// fixture-name key its value goldens share with the TypeScript schema registry.
type contractRoot struct {
	key string
	typ reflect.Type
}

// contractRoots are the four in-scope envelopes. Every Coda route is out of
// scope: #1468 deletes coda.go, coda_exec.go and resources.go.
func contractRoots() []contractRoot {
	return []contractRoot{
		{"package-recommendations", reflect.TypeOf(PackageRecommendationsResponse{})},
		{"custom-guide-repository", reflect.TypeOf(customGuideRepositoryResponse{})},
		{"completion-records-my", reflect.TypeOf(myCompletionsResponse{})},
		{"completion-records-capability", reflect.TypeOf(completionCapability{})},
	}
}

// --- Value goldens -----------------------------------------------------------

type contractCase struct {
	name    string
	capture func(t *testing.T) *httptest.ResponseRecorder
}

func contractCases() []contractCase {
	return []contractCase{
		{"package-recommendations.default", capturePackageRecommendationsDefault},
		{"package-recommendations.untargeted", capturePackageRecommendationsUntargeted},
		{"package-recommendations.empty", capturePackageRecommendationsEmpty},
		{"custom-guide-repository.default", captureCustomGuideDefault},
		{"custom-guide-repository.wire-widened-manifest", captureCustomGuideWireWidenedManifest},
		{"custom-guide-repository.unavailable", captureCustomGuideUnavailable},
		{"completion-records-my.default", captureMyCompletionsDefault},
		{"completion-records-my.empty", captureMyCompletionsEmpty},
		{"completion-records-my.unavailable", captureMyCompletionsUnavailable},
		{"completion-records-capability.available", captureCapabilityAvailable},
		{"completion-records-capability.unavailable", captureCapabilityUnavailable},
	}
}

func TestContractValueGoldens(t *testing.T) {
	for _, c := range contractCases() {
		t.Run(c.name, func(t *testing.T) {
			rr := c.capture(t)
			if rr.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200 (goldens capture success envelopes only)", rr.Code)
			}
			if ct := rr.Header().Get("Content-Type"); ct != "application/json" {
				t.Fatalf("content-type = %q, want application/json", ct)
			}
			assertContractGolden(t, c.name+".json", rr.Body.Bytes())
		})
	}
}

// Every golden on disk must belong to a live case. Without this, renaming a
// case leaves an orphan that the TypeScript side keeps parsing forever against
// a schema nothing produces.
func TestContractGoldensHaveNoOrphans(t *testing.T) {
	entries, err := os.ReadDir(contractGoldenDir)
	if err != nil {
		t.Fatalf("read %s: %v\nregenerate with: go test ./pkg/plugin -run TestContract -update", contractGoldenDir, err)
	}

	want := map[string]bool{contractTagGolden: true}
	for _, c := range contractCases() {
		want[c.name+".json"] = true
	}

	found := 0
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		found++
		if !want[e.Name()] {
			t.Errorf("orphan golden %s: no contract case produces it — delete it, or restore the case", e.Name())
		}
	}
	if found == 0 {
		t.Fatalf("%s contains no goldens; a contract guard that enumerates nothing passes vacuously", contractGoldenDir)
	}
	if found != len(want) {
		t.Errorf("found %d goldens, expected %d — regenerate with: go test ./pkg/plugin -run TestContract -update", found, len(want))
	}
}

// Both directions: every envelope needs a value golden, and every value golden
// needs an envelope. A case whose prefix matches no envelope would be parsed on
// the TypeScript side against a schema no Go type backs.
func TestContractCasesCoverEveryRoot(t *testing.T) {
	perRoot := map[string]int{}
	for _, root := range contractRoots() {
		perRoot[root.key] = 0
	}

	for _, c := range contractCases() {
		key, variant, ok := strings.Cut(c.name, ".")
		if !ok || variant == "" {
			t.Errorf("case %q must be named <envelope-key>.<variant>", c.name)
			continue
		}
		if _, known := perRoot[key]; !known {
			t.Errorf("case %q has no matching envelope in contractRoots()", c.name)
			continue
		}
		perRoot[key]++
	}

	for key, n := range perRoot {
		if n == 0 {
			t.Errorf("envelope %q has no value golden", key)
		}
	}
}

// --- Tag golden --------------------------------------------------------------

type contractFieldTag struct {
	Field     string `json:"field"`
	JSON      string `json:"json"`
	Type      string `json:"type"`
	Wire      string `json:"wire"`
	OmitEmpty bool   `json:"omitempty"`
}

func TestContractStructTagGolden(t *testing.T) {
	inventory := map[string][]contractFieldTag{}
	for _, root := range contractRoots() {
		collectContractTags(t, root.typ, root.typ.Name(), inventory)
	}

	var got bytes.Buffer
	encoder := json.NewEncoder(&got)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(inventory); err != nil {
		t.Fatalf("marshal tag inventory: %v", err)
	}
	assertContractGolden(t, contractTagGolden, got.Bytes())
}

// collectContractTags records one entry per struct reachable from a root
// envelope, keyed by the Go type name (or "<parent>.<jsonName>" for the
// anonymous structs the manifests declare inline).
func collectContractTags(t *testing.T, typ reflect.Type, key string, out map[string][]contractFieldTag) {
	t.Helper()
	if typ.Kind() != reflect.Struct {
		t.Fatalf("%s is not a struct", key)
	}
	if _, seen := out[key]; seen {
		return
	}
	out[key] = nil
	out[key] = collectContractFields(t, typ, key, out)
}

// collectContractFields returns the fields of one JSON object, flattening
// embedded structs the way encoding/json promotes them so the inventory
// describes the object that reaches the wire rather than the Go nesting.
func collectContractFields(t *testing.T, typ reflect.Type, key string, out map[string][]contractFieldTag) []contractFieldTag {
	t.Helper()
	if implementsContractMarshaler(typ, jsonMarshalerType) {
		t.Fatalf("%s (%s) implements json.Marshaler, so it does not marshal as a JSON object; add an explicit normalized wire descriptor", key, typ)
	}
	if implementsContractMarshaler(typ, textMarshalerType) {
		t.Fatalf("%s (%s) implements encoding.TextMarshaler, so it marshals as a JSON string, not an object", key, typ)
	}

	fields := []contractFieldTag{}
	for i := 0; i < typ.NumField(); i++ {
		f := typ.Field(i)
		name, omitEmpty, named, skip := parseContractJSONTag(f)
		if skip {
			continue
		}
		if promoted, ok := contractPromotedStruct(t, key, f, named); ok {
			fields = append(fields, collectContractFields(t, promoted, key, out)...)
			continue
		}
		if f.PkgPath != "" {
			continue // unexported fields never reach the wire
		}
		wire, err := renderContractWireType(f.Type, omitEmpty)
		if err != nil {
			t.Fatalf("%s.%s: %v", key, name, err)
		}
		fields = append(fields, contractFieldTag{
			Field:     f.Name,
			JSON:      name,
			Type:      renderContractType(f.Type),
			Wire:      wire,
			OmitEmpty: omitEmpty,
		})
		if contractWireBottom(wire) != "object" {
			continue
		}
		nested, ok := contractNestedStruct(f.Type)
		if !ok {
			t.Fatalf("%s.%s: wire type %s promises a JSON object but %s has no struct to inventory", key, name, wire, f.Type)
		}
		nestedKey := nested.Name()
		if nestedKey == "" {
			nestedKey = key + "." + name
		}
		collectContractTags(t, nested, nestedKey, out)
	}
	assertContractJSONNamesAreUnique(t, key, fields)
	return fields
}

// encoding/json promotes an embedded struct's exported fields into the parent
// object unless the embedded field carries a json name of its own, and it does
// that for embedded types whose own name is unexported too — so f.PkgPath cannot
// stand in for "never reaches the wire" on an anonymous field.
func contractPromotedStruct(t *testing.T, key string, f reflect.StructField, named bool) (reflect.Type, bool) {
	t.Helper()
	if !f.Anonymous || named {
		return nil, false
	}
	if f.Type.Kind() == reflect.Pointer && f.Type.Elem().Kind() == reflect.Struct {
		t.Fatalf("%s embeds %s: a nil embedded pointer drops its promoted fields from the wire, which this flat inventory cannot express", key, f.Type)
	}
	if f.Type.Kind() != reflect.Struct {
		return nil, false // json names an embedded non-struct after its type
	}
	return f.Type, true
}

// encoding/json resolves same-name fields by embedding depth, dropping both when
// they tie. Neither outcome is expressible here, so refuse the shape instead of
// inventorying a field the wire may not carry.
func assertContractJSONNamesAreUnique(t *testing.T, key string, fields []contractFieldTag) {
	t.Helper()
	seen := map[string]string{}
	for _, f := range fields {
		if prior, dup := seen[f.JSON]; dup {
			t.Fatalf("%s: fields %s and %s both marshal to json name %q; encoding/json resolves that by embedding depth and this inventory cannot model it", key, prior, f.Field, f.JSON)
		}
		seen[f.JSON] = f.Field
	}
}

func parseContractJSONTag(f reflect.StructField) (name string, omitEmpty, named, skip bool) {
	tag := f.Tag.Get("json")
	if tag == "-" {
		return "", false, false, true
	}
	parts := strings.Split(tag, ",")
	name = parts[0]
	named = name != ""
	if !named {
		name = f.Name
	}
	for _, opt := range parts[1:] {
		if opt == "omitempty" {
			omitEmpty = true
		}
	}
	return name, omitEmpty, named, false
}

// contractWireBottom peels the array/record/nullable wrappers off a normalized
// wire descriptor to reach the scalar or object it bottoms out in. Only "object"
// warrants a nested struct entry: time.Time and encoding.TextMarshaler structs
// bottom out in "string", and json.RawMessage in "json".
func contractWireBottom(wire string) string {
	for {
		open := strings.IndexByte(wire, '<')
		if open < 0 || !strings.HasSuffix(wire, ">") {
			return wire
		}
		wire = wire[open+1 : len(wire)-1]
	}
}

// contractNestedStruct unwraps pointers, slices, arrays and map values to find
// a struct worth inventorying. json.RawMessage is a []byte, so it never
// qualifies — its contents are opaque on both sides by design.
func contractNestedStruct(typ reflect.Type) (reflect.Type, bool) {
	for {
		switch typ.Kind() {
		case reflect.Pointer, reflect.Slice, reflect.Array, reflect.Map:
			typ = typ.Elem()
		case reflect.Struct:
			return typ, true
		default:
			return nil, false
		}
	}
}

func renderContractType(typ reflect.Type) string {
	if typ.Name() != "" {
		return typ.String()
	}
	switch typ.Kind() {
	case reflect.Pointer:
		return "*" + renderContractType(typ.Elem())
	case reflect.Slice:
		return "[]" + renderContractType(typ.Elem())
	case reflect.Array:
		return fmt.Sprintf("[%d]%s", typ.Len(), renderContractType(typ.Elem()))
	case reflect.Map:
		return "map[" + renderContractType(typ.Key()) + "]" + renderContractType(typ.Elem())
	case reflect.Struct:
		return "struct"
	default:
		return typ.String()
	}
}

var (
	jsonMarshalerType = reflect.TypeOf((*json.Marshaler)(nil)).Elem()
	textMarshalerType = reflect.TypeOf((*encoding.TextMarshaler)(nil)).Elem()
	timeType          = reflect.TypeOf(time.Time{})
)

func renderContractWireType(typ reflect.Type, omitEmpty bool) (string, error) {
	if typ == reflect.TypeOf(json.RawMessage{}) {
		return "json", nil
	}
	if typ == timeType || typ == reflect.PointerTo(timeType) {
		return nullableWireType("string", typ, omitEmpty), nil
	}
	if implementsContractMarshaler(typ, jsonMarshalerType) {
		return "", fmt.Errorf("Go type %s implements json.Marshaler; add an explicit normalized wire descriptor", typ)
	}
	if implementsContractMarshaler(typ, textMarshalerType) {
		return nullableWireType("string", typ, omitEmpty), nil
	}

	switch typ.Kind() {
	case reflect.Pointer:
		inner, err := renderContractWireType(typ.Elem(), false)
		if err != nil {
			return "", err
		}
		return nullableWireType(inner, typ, omitEmpty), nil
	case reflect.Interface:
		return "json", nil
	case reflect.String:
		return "string", nil
	case reflect.Bool:
		return "boolean", nil
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64,
		reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64, reflect.Uintptr:
		return "integer", nil
	case reflect.Float32, reflect.Float64:
		return "number", nil
	case reflect.Slice:
		if typ.Elem().Kind() == reflect.Uint8 {
			return "string", nil
		}
		elem, err := renderContractWireType(typ.Elem(), false)
		if err != nil {
			return "", err
		}
		return "array<" + elem + ">", nil
	case reflect.Array:
		elem, err := renderContractWireType(typ.Elem(), false)
		if err != nil {
			return "", err
		}
		return "array<" + elem + ">", nil
	case reflect.Map:
		if typ.Key().Kind() != reflect.String {
			return "", fmt.Errorf("map key %s is not a JSON object key", typ.Key())
		}
		value, err := renderContractWireType(typ.Elem(), false)
		if err != nil {
			return "", err
		}
		return "record<" + value + ">", nil
	case reflect.Struct:
		return "object", nil
	default:
		return "", fmt.Errorf("Go type %s has no normalized JSON wire descriptor", typ)
	}
}

func implementsContractMarshaler(typ, marshaler reflect.Type) bool {
	if typ.Implements(marshaler) {
		return true
	}
	return typ.Kind() != reflect.Pointer && reflect.PointerTo(typ).Implements(marshaler)
}

func nullableWireType(inner string, typ reflect.Type, omitEmpty bool) string {
	if typ.Kind() == reflect.Pointer && !omitEmpty {
		return "nullable<" + inner + ">"
	}
	return inner
}

type contractTextValue string

func (contractTextValue) MarshalText() ([]byte, error) {
	return []byte("value"), nil
}

type contractJSONValue struct{}

func (contractJSONValue) MarshalJSON() ([]byte, error) {
	return []byte(`"value"`), nil
}

func TestContractWireTypeDescriptors(t *testing.T) {
	cases := []struct {
		name      string
		value     any
		omitEmpty bool
		want      string
	}{
		{"string", "", false, "string"},
		{"boolean", false, false, "boolean"},
		{"integer", int64(0), false, "integer"},
		{"number", float64(0), false, "number"},
		{"bytes", []byte{}, false, "string"},
		{"array", []string{}, false, "array<string>"},
		{"opaque array", []json.RawMessage{}, false, "array<json>"},
		{"record", map[string]any{}, false, "record<json>"},
		{"object", struct{ Value string }{}, false, "object"},
		{"pointer", &struct{ Value string }{}, false, "nullable<object>"},
		{"omitempty pointer", &struct{ Value string }{}, true, "object"},
		{"time", time.Time{}, false, "string"},
		{"time pointer", &time.Time{}, false, "nullable<string>"},
		{"text marshaler", contractTextValue(""), false, "string"},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := renderContractWireType(reflect.TypeOf(c.value), c.omitEmpty)
			if err != nil {
				t.Fatalf("render wire type: %v", err)
			}
			if got != c.want {
				t.Errorf("wire type = %q, want %q", got, c.want)
			}
		})
	}

	if _, err := renderContractWireType(reflect.TypeOf(contractJSONValue{}), false); err == nil {
		t.Error("custom json.Marshaler must require an explicit normalized wire descriptor")
	}
}

func TestContractWireBottom(t *testing.T) {
	cases := map[string]string{
		"string":                  "string",
		"object":                  "object",
		"json":                    "json",
		"array<object>":           "object",
		"nullable<string>":        "string",
		"record<array<object>>":   "object",
		"record<nullable<json>>":  "json",
		"array<array<integer>>":   "integer",
		"nullable<array<string>>": "string",
	}
	for wire, want := range cases {
		if got := contractWireBottom(wire); got != want {
			t.Errorf("contractWireBottom(%q) = %q, want %q", wire, got, want)
		}
	}
}

type contractPromotedFields struct {
	Base string `json:"base"`
}

// A host for the shapes the inventory walk has to model but no live envelope
// exercises yet: an embedded struct of unexported type (promoted by
// encoding/json despite its non-empty PkgPath), and two fields whose structs
// marshal as strings rather than objects.
type contractEmbeddedHost struct {
	contractPromotedFields
	Own  string                 `json:"own"`
	When time.Time              `json:"when"`
	Text contractTextValue      `json:"text"`
	Deep contractPromotedFields `json:"deep"`
}

func TestContractTagsMirrorEncodingJSON(t *testing.T) {
	inventory := map[string][]contractFieldTag{}
	collectContractTags(t, reflect.TypeOf(contractEmbeddedHost{}), "contractEmbeddedHost", inventory)

	structs := make([]string, 0, len(inventory))
	for key := range inventory {
		structs = append(structs, key)
	}
	sort.Strings(structs)
	// No "Time" and no "contractTextValue": both are strings on the wire.
	if want := []string{"contractEmbeddedHost", "contractPromotedFields"}; !reflect.DeepEqual(structs, want) {
		t.Errorf("inventoried structs = %v, want %v", structs, want)
	}

	got := []string{}
	for _, f := range inventory["contractEmbeddedHost"] {
		got = append(got, f.JSON)
	}
	if want := []string{"base", "own", "when", "text", "deep"}; !reflect.DeepEqual(got, want) {
		t.Errorf("inventoried json names = %v, want %v", got, want)
	}

	body, err := json.Marshal(contractEmbeddedHost{})
	if err != nil {
		t.Fatalf("marshal host: %v", err)
	}
	var object map[string]json.RawMessage
	if err := json.Unmarshal(body, &object); err != nil {
		t.Fatalf("unmarshal host: %v", err)
	}
	marshalled := make([]string, 0, len(object))
	for name := range object {
		marshalled = append(marshalled, name)
	}
	sort.Strings(marshalled)
	inventoried := append([]string{}, got...)
	sort.Strings(inventoried)
	if !reflect.DeepEqual(marshalled, inventoried) {
		t.Errorf("encoding/json emits %v but the inventory records %v", marshalled, inventoried)
	}

	for _, f := range inventory["contractEmbeddedHost"] {
		if (f.JSON == "when" || f.JSON == "text") && f.Wire != "string" {
			t.Errorf("%s wire = %q, want string", f.JSON, f.Wire)
		}
	}
}

// --- Golden plumbing ---------------------------------------------------------

func assertContractGolden(t *testing.T, name string, got []byte) {
	t.Helper()
	path := filepath.Join(contractGoldenDir, name)

	if *updateContractGoldens {
		if err := os.MkdirAll(contractGoldenDir, 0o750); err != nil {
			t.Fatalf("create %s: %v", contractGoldenDir, err)
		}
		if err := os.WriteFile(path, got, 0o600); err != nil {
			t.Fatalf("write %s: %v", path, err)
		}
		return
	}

	want, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read golden %s: %v\nregenerate with: go test ./pkg/plugin -run TestContract -update", path, err)
	}
	if !bytes.Equal(want, got) {
		t.Errorf("golden %s is stale.\n want: %s\n  got: %s\nIf the envelope change is intended, regenerate with"+
			" `go test ./pkg/plugin -run TestContract -update` and update src/types/backend-api.schema.ts to match.",
			path, want, got)
	}
}

const contractGoldenTime = "2026-04-01T00:00:00Z"

func freezeContractTime(t *testing.T) {
	t.Helper()
	base, err := time.Parse(time.RFC3339, contractGoldenTime)
	if err != nil {
		t.Fatalf("parse golden time: %v", err)
	}
	withFrozenTime(t, base)
}

// --- Captures: /package-recommendations --------------------------------------

// packageIndexFetcher serves the repository index for the index URL and a
// manifest for any manifest.json beneath it.
func packageIndexFetcher(t *testing.T, index map[string]map[string]any, manifest map[string]any) packageRepositoryFetcher {
	t.Helper()
	indexBody, err := json.Marshal(index)
	if err != nil {
		t.Fatalf("marshal index: %v", err)
	}
	manifestBody, err := json.Marshal(manifest)
	if err != nil {
		t.Fatalf("marshal manifest: %v", err)
	}
	return func(_ context.Context, rawURL string, _ int64) ([]byte, error) {
		if strings.HasSuffix(rawURL, "manifest.json") {
			return manifestBody, nil
		}
		return indexBody, nil
	}
}

// Single-entry (or empty) indexes only: the handler builds `packages` by ranging
// over a map, so a multi-entry response has no stable element order to pin.
func doPackageRecommendations(t *testing.T, index map[string]map[string]any, manifest map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	if len(index) > 1 {
		t.Fatalf("package-recommendations goldens must use at most one entry; got %d", len(index))
	}
	resetPackageRecommendationsCache()
	t.Cleanup(resetPackageRecommendationsCache)
	freezeContractTime(t)
	// The enrichment budget is wall-clock, so the default 3 s could theoretically
	// expire on a loaded runner and drop `manifest` from the golden.
	withEnrichBudgetOverride(t, time.Minute)
	withFetcherOverride(t, packageIndexFetcher(t, index, manifest))

	r, _ := http.NewRequest(http.MethodGet, "/package-recommendations", nil)
	rr := httptest.NewRecorder()
	newTestApp(t).handlePackageRecommendations(rr, r)
	return rr
}

// A fully populated entry. `targeting.match` carries an unsupported predicate
// key on purpose: it is json.RawMessage in Go, so the golden proves unknown
// keys survive to the frontend's fail-closed matcher.
func capturePackageRecommendationsDefault(t *testing.T) *httptest.ResponseRecorder {
	return doPackageRecommendations(t,
		map[string]map[string]any{
			"prom-101": {
				"path":        "prom-101/v1.0.0",
				"type":        "guide",
				"title":       "Prometheus 101",
				"description": "Get started with Prometheus",
				"targeting": map[string]any{
					"match": map[string]any{"urlPrefix": "/connections", "cohort": "new-user"},
				},
			},
		},
		map[string]any{
			"id":         "prom-101",
			"type":       "guide",
			"milestones": []string{"prom-101-a", "prom-101-b"},
		},
	)
}

// An untargeted entry keeps every omitempty field off the wire (manifest
// enrichment skips it), so the golden pins which fields are genuinely optional.
func capturePackageRecommendationsUntargeted(t *testing.T) *httptest.ResponseRecorder {
	return doPackageRecommendations(t,
		map[string]map[string]any{"untargeted": {"path": "untargeted/v1.0.0"}},
		map[string]any{},
	)
}

func capturePackageRecommendationsEmpty(t *testing.T) *httptest.ResponseRecorder {
	return doPackageRecommendations(t, map[string]map[string]any{}, map[string]any{})
}

// --- Captures: /custom-guide-repository --------------------------------------

func doCustomGuideGolden(t *testing.T, r *http.Request, entries ...customGuideRepositoryEntry) *httptest.ResponseRecorder {
	t.Helper()
	withGuideLister(t, singlePageGuideLister(entries...))
	rr := httptest.NewRecorder()
	newTestApp(t).handleCustomGuideRepository(rr, r)
	return rr
}

func captureCustomGuideDefault(t *testing.T) *httptest.ResponseRecorder {
	freezeContractTime(t)
	full := customGuideRepositoryEntry{
		ID:     "fe-alerting-path",
		Title:  "Alerting enablement",
		Status: "published",
		Manifest: &customGuideManifest{
			Type:        "path",
			Repository:  "app-platform",
			Description: "Take a team from zero to on-call",
			Milestones:  []string{"fe-alerting-01", "fe-alerting-02"},
			Category:    "alerting",
			Author: &struct {
				Name string `json:"name,omitempty"`
				Team string `json:"team,omitempty"`
			}{Name: "Field engineering", Team: "field-eng"},
			Depends: []json.RawMessage{json.RawMessage(`"fe-intro"`), json.RawMessage(`["fe-loki","fe-mimir"]`)},
		},
	}
	bare := customGuideRepositoryEntry{ID: "fe-alerting-01"}
	return doCustomGuideGolden(t, customGuideRequest(t, "/custom-guide-repository", "user:1"), full, bare)
}

// The two mismatches Go's type system cannot express, pinned as bytes: `type`
// has no omitempty, so an untyped manifest emits "", which is not a member of
// the TypeScript PackageType union; and `depends` is []json.RawMessage, which
// is wider than the DependencyList it is mirrored as.
func captureCustomGuideWireWidenedManifest(t *testing.T) *httptest.ResponseRecorder {
	freezeContractTime(t)
	entry := customGuideRepositoryEntry{
		ID: "fe-untyped",
		Manifest: &customGuideManifest{
			Depends: []json.RawMessage{json.RawMessage(`{"package":"fe-intro","version":">=1"}`), json.RawMessage(`7`)},
		},
	}
	return doCustomGuideGolden(t, customGuideRequest(t, "/custom-guide-repository", "user:1"), entry)
}

func captureCustomGuideUnavailable(t *testing.T) *httptest.ResponseRecorder {
	freezeContractTime(t)
	r, _ := http.NewRequest(http.MethodGet, "/custom-guide-repository", nil)
	ctx := backend.WithPluginContext(r.Context(), backend.PluginContext{Namespace: testNamespace})
	ctx = sdkconfig.WithGrafanaConfig(ctx, sdkconfig.NewGrafanaCfg(testGrafanaConfig()))
	return doCustomGuideGolden(t, r.WithContext(ctx))
}

// --- Captures: /completion-records/* -----------------------------------------

func doCompletionGolden(t *testing.T, r *http.Request, serve func(*App) http.HandlerFunc, records ...completionRecordSpec) *httptest.ResponseRecorder {
	t.Helper()
	withLister(t, singlePageLister(records...))
	rr := httptest.NewRecorder()
	serve(newTestApp(t))(rr, r)
	return rr
}

func myCompletions(a *App) http.HandlerFunc { return a.handleMyCompletions }

func completionCapabilityRoute(a *App) http.HandlerFunc { return a.handleCompletionCapability }

func captureMyCompletionsDefault(t *testing.T) *httptest.ResponseRecorder {
	freezeContractTime(t)
	return doCompletionGolden(t, completionRequest(t, "/completion-records/my", "user:1"), myCompletions,
		rec("user:1", "app-platform", "fe-alerting-01", "Alerting module 1", "interactive", "fe-alerting-path", "objectives", "2026-03-30T09:00:00Z", 100),
		rec("user:1", "app-platform", "fe-alerting-01", "Alerting module 1", "interactive", "fe-alerting-path", "manual", "2026-03-29T09:00:00Z", 60),
		rec("user:1", "bundled", "linux", "Linux server integration", "interactive", "", "objectives", "2026-03-28T09:00:00Z", 80),
		rec("user:2", "bundled", "loki", "Loki basics", "interactive", "", "objectives", "2026-03-27T09:00:00Z", 100),
	)
}

func captureMyCompletionsEmpty(t *testing.T) *httptest.ResponseRecorder {
	freezeContractTime(t)
	return doCompletionGolden(t, completionRequest(t, "/completion-records/my", "user:nobody"), myCompletions,
		rec("user:1", "bundled", "linux", "Linux server integration", "interactive", "", "objectives", "2026-03-28T09:00:00Z", 80),
	)
}

func captureMyCompletionsUnavailable(t *testing.T) *httptest.ResponseRecorder {
	freezeContractTime(t)
	return doCompletionGolden(t, completionRequest(t, "/completion-records/my", ""), myCompletions)
}

func captureCapabilityAvailable(t *testing.T) *httptest.ResponseRecorder {
	freezeContractTime(t)
	return doCompletionGolden(t, completionRequest(t, "/completion-records/capability", "user:1"), completionCapabilityRoute)
}

func captureCapabilityUnavailable(t *testing.T) *httptest.ResponseRecorder {
	freezeContractTime(t)
	return doCompletionGolden(t, completionRequest(t, "/completion-records/capability", ""), completionCapabilityRoute)
}
