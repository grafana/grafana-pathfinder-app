package plugin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"

	"github.com/grafana/grafana-pathfinder-app/pkg/achievements"
	"github.com/grafana/grafana-pathfinder-app/pkg/achievements/storetest"
)

const (
	achievementTestNamespace = "stacks-1"
	achievementTestToken     = "obo-token"
)

var (
	achievementTestNow    = time.Date(2026, 11, 2, 9, 30, 0, 0, time.FixedZone("test", 3600))
	achievementTestPerson = achievements.Person{ID: "user:27"}
)

// fakeAchievementAPI enforces the kinds' CRD schemas, 409 on a duplicate create
// or a stale resourceVersion, and create-only verbs on AchievementAward.
// testdata/achievements holds byte copies of the CRDs generated at
// grafana-pathfinder-backend 84c582fdae1916910e5197a44bd0078018315135.
type fakeAchievementAPI struct {
	mu        sync.Mutex
	rv        int
	objects   map[string]map[string]any
	schemas   map[string]map[string]any
	requests  []string
	failNext  map[string]int
	emptyNext map[string]bool
}

func newFakeAchievementAPI(t *testing.T) *fakeAchievementAPI {
	t.Helper()
	api := &fakeAchievementAPI{
		objects:   map[string]map[string]any{},
		schemas:   map[string]map[string]any{},
		failNext:  map[string]int{},
		emptyNext: map[string]bool{},
	}
	for resource, file := range map[string]string{
		achievementProgressResource: "achievementprogress.crd.json",
		achievementAwardResource:    "achievementaward.crd.json",
	} {
		raw, err := os.ReadFile(filepath.Join("testdata", "achievements", file))
		if err != nil {
			t.Fatal(err)
		}
		var crd struct {
			Spec struct {
				Versions []struct {
					Schema struct {
						OpenAPIV3Schema struct {
							Properties struct {
								Spec map[string]any `json:"spec"`
							} `json:"properties"`
						} `json:"openAPIV3Schema"`
					} `json:"schema"`
				} `json:"versions"`
			} `json:"spec"`
		}
		if err := json.Unmarshal(raw, &crd); err != nil || len(crd.Spec.Versions) == 0 {
			t.Fatalf("decode %s: %v", file, err)
		}
		api.schemas[resource] = crd.Spec.Versions[0].Schema.OpenAPIV3Schema.Properties.Spec
	}
	return api
}

func (a *fakeAchievementAPI) status(w http.ResponseWriter, code int, reason, msg string) {
	a.statusWith(w, code, reason, msg, map[string]any{})
}

func (a *fakeAchievementAPI) notFound(w http.ResponseWriter, resource, name string) {
	a.statusWith(w, http.StatusNotFound, "NotFound", name+" not found", map[string]any{"group": appPlatformGroup, "kind": resource, "name": name})
}

func (a *fakeAchievementAPI) statusWith(w http.ResponseWriter, code int, reason, msg string, details map[string]any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]any{"kind": "Status", "apiVersion": "v1", "status": "Failure", "reason": reason, "code": code, "message": msg, "details": details})
}

func (a *fakeAchievementAPI) object(w http.ResponseWriter, code int, obj map[string]any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(obj)
}

func (a *fakeAchievementAPI) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	defer a.mu.Unlock()

	prefix := "/apis/" + achievementGroupVersion + "/namespaces/" + achievementTestNamespace + "/"
	rest, ok := strings.CutPrefix(r.URL.Path, prefix)
	if !ok || r.Header.Get("X-Access-Token") != achievementTestToken {
		a.status(w, http.StatusNotFound, "NotFound", "the server could not find the requested resource")
		return
	}
	resource, name, _ := strings.Cut(rest, "/")
	a.requests = append(a.requests, r.Method+" "+resource)

	if code, ok := a.failNext[r.Method+" "+resource]; ok {
		delete(a.failNext, r.Method+" "+resource)
		a.status(w, code, "InternalError", "injected")
		return
	}
	schema, served := a.schemas[resource]
	if !served {
		a.status(w, http.StatusNotFound, "NotFound", "the server could not find the requested resource")
		return
	}
	if resource == achievementAwardResource && r.Method != http.MethodGet && r.Method != http.MethodPost {
		a.status(w, http.StatusForbidden, "Forbidden", r.Method+" "+resource+" is not permitted")
		return
	}
	key := resource + "/" + name

	switch r.Method {
	case http.MethodGet:
		obj, ok := a.objects[key]
		if !ok {
			a.notFound(w, resource, name)
			return
		}
		a.object(w, http.StatusOK, obj)
	case http.MethodPost:
		obj := a.decode(w, r, schema)
		if obj == nil {
			return
		}
		meta := obj["metadata"].(map[string]any)
		key = resource + "/" + meta["name"].(string)
		if _, exists := a.objects[key]; exists {
			a.status(w, http.StatusConflict, "AlreadyExists", "already exists")
			return
		}
		if rv, _ := meta["resourceVersion"].(string); rv != "" {
			a.status(w, http.StatusUnprocessableEntity, "Invalid", "resourceVersion should not be set on objects to be created")
			return
		}
		a.store(key, obj)
		a.object(w, http.StatusCreated, obj)
	case http.MethodPut:
		obj := a.decode(w, r, schema)
		if obj == nil {
			return
		}
		meta := obj["metadata"].(map[string]any)
		stored, exists := a.objects[key]
		switch rv, _ := meta["resourceVersion"].(string); {
		case meta["name"] != name:
			a.status(w, http.StatusBadRequest, "BadRequest", "name does not match the URL")
		case rv == "":
			a.status(w, http.StatusUnprocessableEntity, "Invalid", "metadata.resourceVersion: must be specified for an update")
		case !exists:
			a.notFound(w, resource, name)
		case rv != stored["metadata"].(map[string]any)["resourceVersion"]:
			a.status(w, http.StatusConflict, "Conflict", "the object has been modified; please apply your changes to the latest version and try again")
		default:
			a.store(key, obj)
			if a.emptyNext[r.Method+" "+resource] {
				delete(a.emptyNext, r.Method+" "+resource)
				w.WriteHeader(http.StatusOK)
				return
			}
			a.object(w, http.StatusOK, obj)
		}
	default:
		a.status(w, http.StatusMethodNotAllowed, "MethodNotAllowed", r.Method)
	}
}

func (a *fakeAchievementAPI) decode(w http.ResponseWriter, r *http.Request, schema map[string]any) map[string]any {
	var obj map[string]any
	if err := json.NewDecoder(r.Body).Decode(&obj); err != nil {
		a.status(w, http.StatusBadRequest, "BadRequest", err.Error())
		return nil
	}
	meta, _ := obj["metadata"].(map[string]any)
	if meta == nil || meta["name"] == "" || meta["name"] == nil || meta["namespace"] != achievementTestNamespace {
		a.status(w, http.StatusUnprocessableEntity, "Invalid", "metadata.name and metadata.namespace are required")
		return nil
	}
	if causes := validateAgainstSchema("spec", obj["spec"], schema); len(causes) > 0 {
		a.status(w, http.StatusUnprocessableEntity, "Invalid", strings.Join(causes, "; "))
		return nil
	}
	return obj
}

func (a *fakeAchievementAPI) store(key string, obj map[string]any) {
	a.rv++
	obj["metadata"].(map[string]any)["resourceVersion"] = strconv.Itoa(a.rv)
	a.objects[key] = obj
}

func (a *fakeAchievementAPI) seed(resource, name string, spec map[string]any) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.store(resource+"/"+name, map[string]any{
		"apiVersion": achievementGroupVersion,
		"metadata":   map[string]any{"name": name, "namespace": achievementTestNamespace},
		"spec":       spec,
	})
}

func (a *fakeAchievementAPI) spec(resource, name string) map[string]any {
	a.mu.Lock()
	defer a.mu.Unlock()
	obj, ok := a.objects[resource+"/"+name]
	if !ok {
		return nil
	}
	return obj["spec"].(map[string]any)
}

// validateAgainstSchema covers the OpenAPI subset the two CRDs use.
func validateAgainstSchema(path string, value any, schema map[string]any) []string {
	bad := func(format string, args ...any) []string {
		return []string{path + ": " + fmt.Sprintf(format, args...)}
	}
	switch schema["type"] {
	case "object":
		obj, ok := value.(map[string]any)
		if !ok {
			return bad("must be an object")
		}
		var causes []string
		required, _ := schema["required"].([]any)
		for _, f := range required {
			if _, present := obj[f.(string)]; !present {
				causes = append(causes, path+"."+f.(string)+": required")
			}
		}
		props, _ := schema["properties"].(map[string]any)
		for field, v := range obj {
			if sub, known := props[field].(map[string]any); known {
				causes = append(causes, validateAgainstSchema(path+"."+field, v, sub)...)
			}
		}
		return causes
	case "string":
		s, ok := value.(string)
		if !ok {
			return bad("must be a string")
		}
		if n, ok := schema["minLength"].(float64); ok && float64(utf8.RuneCountInString(s)) < n {
			return bad("shorter than %v", n)
		}
		if n, ok := schema["maxLength"].(float64); ok && float64(utf8.RuneCountInString(s)) > n {
			return bad("longer than %v", n)
		}
		if pattern, ok := schema["pattern"].(string); ok && !regexp.MustCompile(pattern).MatchString(s) {
			return bad("does not match %s", pattern)
		}
		if _, err := time.Parse(time.RFC3339, s); schema["format"] == "date-time" && err != nil {
			return bad("is not a date-time")
		}
	case "integer":
		n, ok := value.(float64)
		if !ok || n != float64(int64(n)) {
			return bad("must be an integer")
		}
		if lo, ok := schema["minimum"].(float64); ok {
			if exclusive, _ := schema["exclusiveMinimum"].(bool); n < lo || (exclusive && n == lo) {
				return bad("below the minimum %v", lo)
			}
		}
		if hi, ok := schema["maximum"].(float64); ok && n > hi {
			return bad("above the maximum %v", hi)
		}
	case "array":
		items, ok := value.([]any)
		if !ok {
			return bad("must be an array")
		}
		if n, ok := schema["maxItems"].(float64); ok && float64(len(items)) > n {
			return bad("more than %v items", n)
		}
		sub, _ := schema["items"].(map[string]any)
		var causes []string
		for i, item := range items {
			causes = append(causes, validateAgainstSchema(fmt.Sprintf("%s[%d]", path, i), item, sub)...)
		}
		return causes
	}
	return nil
}

func newAchievementTestStore(t *testing.T) (*achievementStore, *fakeAchievementAPI) {
	t.Helper()
	return newAchievementTestStoreLogging(t, log.DefaultLogger)
}

func newAchievementTestStoreLogging(t *testing.T, logger log.Logger) (*achievementStore, *fakeAchievementAPI) {
	t.Helper()
	api := newFakeAchievementAPI(t)
	srv := httptest.NewServer(api)
	t.Cleanup(srv.Close)
	client := newAppPlatformListClient(srv.URL, &stubMinter{token: achievementTestToken}, "id-token", logger)
	writer := achievementWriter{Namespace: achievementTestNamespace, OrgID: 1, UserLogin: "ada", UserDisplayName: "Ada L"}
	return newAchievementStore(client, writer, func() time.Time { return achievementTestNow }), api
}

func TestAchievementStore_MeetsStoreContract(t *testing.T) {
	storetest.Run(t, func(t *testing.T) achievements.Store {
		store, _ := newAchievementTestStore(t)
		return store
	})
}

func TestAchievementStore_ProgressWriteIsStampedAndSchemaValid(t *testing.T) {
	store, api := newAchievementTestStore(t)
	ctx := context.Background()

	created, err := store.CreateProgress(ctx, achievementTestPerson, achievements.Progress{AchievementID: "guides-finished", SchemaVersion: achievements.SchemaVersion})
	if err != nil {
		t.Fatalf("CreateProgress: %v", err)
	}
	name := achievementProgressName(achievementTestPerson.ID, "guides-finished")
	spec := api.spec(achievementProgressResource, name)
	if spec == nil {
		t.Fatalf("no object stored at %s", name)
	}
	for _, field := range []string{"tierIds", "units"} {
		if list, ok := spec[field].([]any); !ok || len(list) != 0 {
			t.Fatalf("%s = %#v, want an empty array", field, spec[field])
		}
	}
	if _, present := spec["revision"]; present {
		t.Error("revision was written")
	}
	want := map[string]any{
		"achievementId": "guides-finished",
		"userId":        "user:27", "orgId": 1.0, "stackNamespace": achievementTestNamespace,
		"schemaVersion": 1.0, "updatedAt": "2026-11-02T08:30:00Z",
	}
	for k, v := range want {
		if spec[k] != v {
			t.Errorf("spec[%s] = %#v, want %#v", k, spec[k], v)
		}
	}

	saved, err := store.SaveProgress(ctx, achievementTestPerson, achievements.Progress{
		AchievementID: "guides-finished", TierIDs: []string{"silver", "bronze"}, Units: []string{"b", "a"}, SchemaVersion: 1, Version: created.Version,
	})
	if err != nil {
		t.Fatalf("SaveProgress: %v", err)
	}
	if !slices.Equal(saved.TierIDs, []string{"bronze", "silver"}) || len(saved.Units) != 2 || saved.Units[0] != "a" {
		t.Fatalf("saved = %+v", saved)
	}
}

func TestAchievementStore_AwardWriteIsStamped(t *testing.T) {
	store, api := newAchievementTestStore(t)
	err := store.CreateAward(context.Background(), achievementTestPerson, achievements.Award{
		AchievementID: "guides-finished", TierID: "silver", Entity: "guides", EarnedAt: achievementTestNow,
	})
	if err != nil {
		t.Fatalf("CreateAward: %v", err)
	}
	spec := api.spec(achievementAwardResource, achievementAwardName(achievementTestPerson.ID, "guides-finished", "silver"))
	if spec == nil {
		t.Fatal("award not stored under its tier name")
	}
	want := map[string]any{
		"achievementId": "guides-finished", "tierId": "silver", "entity": "guides",
		"earnedAt": "2026-11-02T08:30:00Z", "userId": "user:27", "userLogin": "ada", "userDisplayName": "Ada L",
		"orgId": 1.0, "stackNamespace": achievementTestNamespace, "schemaVersion": 1.0,
	}
	for k, v := range want {
		if spec[k] != v {
			t.Errorf("spec[%s] = %#v, want %#v", k, spec[k], v)
		}
	}
	if len(spec) != len(want) {
		t.Errorf("spec = %v, want exactly %v", spec, want)
	}
}

func TestAchievementStore_AwardOmitsUnavailableDisplayFields(t *testing.T) {
	store, api := newAchievementTestStore(t)
	store.writer.UserLogin, store.writer.UserDisplayName = "", ""
	if err := store.CreateAward(context.Background(), achievementTestPerson, achievements.Award{AchievementID: "a", TierID: "bronze", Entity: "guides", EarnedAt: achievementTestNow}); err != nil {
		t.Fatalf("CreateAward: %v", err)
	}
	spec := api.spec(achievementAwardResource, achievementAwardName(achievementTestPerson.ID, "a", "bronze"))
	for _, k := range []string{"userLogin", "userDisplayName"} {
		if _, present := spec[k]; present {
			t.Errorf("%s was written although unavailable", k)
		}
	}
}

func TestAchievementStore_SchemaRejectionIsNotAConflict(t *testing.T) {
	store, _ := newAchievementTestStore(t)
	ctx := context.Background()
	created, err := store.CreateProgress(ctx, achievementTestPerson, achievements.Progress{AchievementID: "a", SchemaVersion: 1})
	if err != nil {
		t.Fatalf("CreateProgress: %v", err)
	}
	created.TierIDs = []string{"Gold Star"}
	_, err = store.SaveProgress(ctx, achievementTestPerson, created)
	if status, ok := upstreamStatusOf(err); !ok || status != http.StatusUnprocessableEntity || errors.Is(err, achievements.ErrConflict) {
		t.Fatalf("err = %v, want an upstream 422 that is not ErrConflict", err)
	}
}

func TestAchievementStore_UpstreamFailuresPassThrough(t *testing.T) {
	for _, tc := range []struct {
		name   string
		op     string
		status int
		call   func(*achievementStore) error
	}{
		{"load 503", "GET " + achievementProgressResource, http.StatusServiceUnavailable, func(s *achievementStore) error {
			_, err := s.LoadProgress(context.Background(), achievementTestPerson, []string{"a"})
			return err
		}},
		{"create 403", "POST " + achievementProgressResource, http.StatusForbidden, func(s *achievementStore) error {
			_, err := s.CreateProgress(context.Background(), achievementTestPerson, achievements.Progress{AchievementID: "a", SchemaVersion: 1})
			return err
		}},
		{"save 503", "PUT " + achievementProgressResource, http.StatusServiceUnavailable, func(s *achievementStore) error {
			_, err := s.SaveProgress(context.Background(), achievementTestPerson, achievements.Progress{AchievementID: "a", SchemaVersion: 1, Version: "1"})
			return err
		}},
		{"award 503", "POST " + achievementAwardResource, http.StatusServiceUnavailable, func(s *achievementStore) error {
			return s.CreateAward(context.Background(), achievementTestPerson, achievements.Award{AchievementID: "a", TierID: "bronze", Entity: "guides", EarnedAt: achievementTestNow})
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			store, api := newAchievementTestStore(t)
			api.failNext[tc.op] = tc.status
			err := tc.call(store)
			status, ok := upstreamStatusOf(err)
			if !ok || status != tc.status {
				t.Fatalf("err = %v, want upstream status %d", err, tc.status)
			}
			if errors.Is(err, achievements.ErrExists) || errors.Is(err, achievements.ErrConflict) {
				t.Fatalf("err = %v must not be a store sentinel", err)
			}
		})
	}
}

func TestAchievementStore_RowWrittenDirectlyIsNormalised(t *testing.T) {
	store, api := newAchievementTestStore(t)
	api.seed(achievementProgressResource, achievementProgressName(achievementTestPerson.ID, "a"), map[string]any{
		"achievementId": "a", "tierIds": []any{"silver", "bronze"}, "units": []any{"b", "a", "b"}, "updatedAt": "2026-01-01T00:00:00Z",
		"userId": achievementTestPerson.ID, "orgId": 1, "stackNamespace": achievementTestNamespace, "schemaVersion": 1,
	})
	rows, err := store.LoadProgress(context.Background(), achievementTestPerson, []string{"a"})
	if err != nil {
		t.Fatalf("LoadProgress: %v", err)
	}
	if got := rows["a"].Units; len(got) != 2 || got[0] != "a" || got[1] != "b" {
		t.Fatalf("units = %v, want [a b]", got)
	}
	if got := rows["a"].TierIDs; !slices.Equal(got, []string{"bronze", "silver"}) {
		t.Fatalf("tier ids = %v, want [bronze silver]", got)
	}
}

func TestAchievementStore_RowOfAnotherUserIsRefused(t *testing.T) {
	store, api := newAchievementTestStore(t)
	api.seed(achievementProgressResource, achievementProgressName(achievementTestPerson.ID, "a"), map[string]any{
		"achievementId": "a", "tierIds": []any{"gold"}, "units": []any{}, "updatedAt": "2026-01-01T00:00:00Z",
		"userId": "user:99", "orgId": 1, "stackNamespace": achievementTestNamespace, "schemaVersion": 1,
	})
	_, err := store.LoadProgress(context.Background(), achievementTestPerson, []string{"a"})
	if !errors.Is(err, errAchievementRowMismatch) {
		t.Fatalf("err = %v, want errAchievementRowMismatch", err)
	}
}

func TestAchievementNames(t *testing.T) {
	dnsSafe := regexp.MustCompile(`^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`)
	names := map[string]string{
		"progress":             achievementProgressName("user:1", "a"),
		"progress other user":  achievementProgressName("user:2", "a"),
		"progress other id":    achievementProgressName("user:1", "b"),
		"progress ambiguous 1": achievementProgressName("user:1a", ""),
		"award bronze":         achievementAwardName("user:1", "a", "bronze"),
		"award silver":         achievementAwardName("user:1", "a", "silver"),
		"award other user":     achievementAwardName("user:2", "a", "bronze"),
		"award a-b, c":         achievementAwardName("user:1", "a-b", "c"),
		"award a, b-c":         achievementAwardName("user:1", "a", "b-c"),
	}
	seen := map[string]string{}
	for label, name := range names {
		if !dnsSafe.MatchString(name) || len(name) > 253 {
			t.Errorf("%s: %q is not a DNS-safe name", label, name)
		}
		if prev, dup := seen[name]; dup {
			t.Errorf("%s and %s share the name %q", label, prev, name)
		}
		seen[name] = label
	}
	again := achievementProgressName("user:1", "a")
	if again != names["progress"] {
		t.Error("names are not deterministic")
	}
}

func TestAchievementStore_EvaluatorsLongestUnitKeyFits(t *testing.T) {
	store, _ := newAchievementTestStore(t)
	ctx := context.Background()
	created, err := store.CreateProgress(ctx, achievementTestPerson, achievements.Progress{AchievementID: "a", SchemaVersion: 1})
	if err != nil {
		t.Fatalf("CreateProgress: %v", err)
	}
	longest := unitKeyForTest(strings.Repeat("s", 256), strings.Repeat("i", 256))
	created.Units = []string{longest}
	if _, err := store.SaveProgress(ctx, achievementTestPerson, created); err != nil {
		t.Fatalf("the recorder's longest guide key (%d bytes) was refused: %v", len(longest), err)
	}
}

func TestAchievementStore_WritesADistinctHeldSet(t *testing.T) {
	store, api := newAchievementTestStore(t)
	ctx := context.Background()
	created, err := store.CreateProgress(ctx, achievementTestPerson, achievements.Progress{AchievementID: "a", TierIDs: []string{"bronze", "bronze"}, SchemaVersion: 1})
	if err != nil {
		t.Fatalf("CreateProgress: %v", err)
	}
	name := achievementProgressName(achievementTestPerson.ID, "a")
	if held := api.spec(achievementProgressResource, name)["tierIds"].([]any); len(held) != 1 {
		t.Fatalf("created tierIds = %v, want one bronze: the kind does not dedupe, so the writer must", held)
	}
	created.TierIDs = []string{"silver", "bronze", "silver"}
	if _, err := store.SaveProgress(ctx, achievementTestPerson, created); err != nil {
		t.Fatalf("SaveProgress: %v", err)
	}
	if held := api.spec(achievementProgressResource, name)["tierIds"].([]any); len(held) != 2 || held[0] != "bronze" || held[1] != "silver" {
		t.Fatalf("saved tierIds = %v, want [bronze silver]", held)
	}
}

func TestAchievementStore_UnreadableSaveAckIsStillASave(t *testing.T) {
	catalog := achievementTestCatalog(t)
	store, api := newAchievementTestStore(t)
	api.emptyNext["PUT "+achievementProgressResource] = true
	evaluator := achievements.NewEvaluator(catalog, store, allowAllPolicy{}, func() time.Time { return achievementTestNow })
	decisions, err := evaluator.Evaluate(context.Background(), achievementTestPerson, achievements.Event{
		ID: "evt-1", Entity: "guides", Action: "completed",
		Context: map[string]any{"guideSource": "bundled", "guideId": "one", "guideCategory": "interactive"},
	})
	if err != nil || len(decisions) != 1 {
		t.Fatalf("Evaluate = %v, %v", decisions, err)
	}
	if api.emptyNext["PUT "+achievementProgressResource] {
		t.Fatal("the save never received the empty acknowledgement")
	}
	if d := decisions[0]; d.Reason.Transient() || !slices.Equal(d.Awarded, []string{"bronze"}) {
		t.Fatalf("decision = %+v, want bronze reported for the durable save", d)
	}

	saved, err := store.SaveProgress(context.Background(), achievementTestPerson, achievements.Progress{AchievementID: "guides-finished", SchemaVersion: 1, Version: "1"})
	if !errors.Is(err, achievements.ErrConflict) || saved.Version != "" {
		t.Fatalf("save at an old version = %+v, %v, want ErrConflict", saved, err)
	}
}

func TestAchievementStore_ExpectedOutcomesAreNotProxyFailures(t *testing.T) {
	logger := newCapturingLogger()
	store, api := newAchievementTestStoreLogging(t, logger)
	ctx := context.Background()
	seed := achievements.Progress{AchievementID: "a", SchemaVersion: 1}
	bronze := achievements.Award{AchievementID: "a", TierID: "bronze", Entity: "guides", EarnedAt: achievementTestNow}

	if rows, err := store.LoadProgress(ctx, achievementTestPerson, []string{"a"}); err != nil || len(rows) != 0 {
		t.Fatalf("first load = %v, %v, want no row", rows, err)
	}
	created, err := store.CreateProgress(ctx, achievementTestPerson, seed)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateProgress(ctx, achievementTestPerson, seed); !errors.Is(err, achievements.ErrExists) {
		t.Fatalf("repeat CreateProgress = %v, want ErrExists", err)
	}
	if _, err := store.SaveProgress(ctx, achievementTestPerson, created); err != nil {
		t.Fatal(err)
	}
	if _, err := store.SaveProgress(ctx, achievementTestPerson, created); !errors.Is(err, achievements.ErrConflict) {
		t.Fatalf("stale SaveProgress = %v, want ErrConflict", err)
	}
	if err := store.CreateAward(ctx, achievementTestPerson, bronze); err != nil {
		t.Fatal(err)
	}
	if err := store.CreateAward(ctx, achievementTestPerson, bronze); !errors.Is(err, achievements.ErrExists) {
		t.Fatalf("repeat CreateAward = %v, want ErrExists", err)
	}
	if logger.warnedWith("Pathfinder proxy operation failed") {
		t.Fatal("an expected store outcome was logged as a proxy failure")
	}

	api.failNext["POST "+achievementAwardResource] = http.StatusServiceUnavailable
	if err := store.CreateAward(ctx, achievementTestPerson, bronze); err == nil {
		t.Fatal("injected 503 was not returned")
	}
	if !logger.warnedWith("Pathfinder proxy operation failed") {
		t.Fatal("a real upstream failure was not logged")
	}
}

func TestAchievementStore_KindNotServedIsAnOutageNotAnAbsentRow(t *testing.T) {
	logger := newCapturingLogger()
	store, api := newAchievementTestStoreLogging(t, logger)
	delete(api.schemas, achievementProgressResource)
	if _, err := store.LoadProgress(context.Background(), achievementTestPerson, []string{"a"}); err == nil {
		t.Fatal("a kind the backend does not serve read as a row not yet created")
	}
	if !logger.warnedWith("Pathfinder proxy operation failed") {
		t.Fatal("a kind the backend does not serve was not logged")
	}
}

func TestAchievementStore_ExistingAwardRowIsHeldNotReported(t *testing.T) {
	catalog := achievementTestCatalog(t)
	store, api := newAchievementTestStore(t)
	bronze := achievements.Award{AchievementID: "guides-finished", TierID: "bronze", Entity: "guides", EarnedAt: achievementTestNow}
	if err := store.CreateAward(context.Background(), achievementTestPerson, bronze); err != nil {
		t.Fatal(err)
	}
	if err := store.CreateAward(context.Background(), achievementTestPerson, bronze); !errors.Is(err, achievements.ErrExists) {
		t.Fatalf("repeat create err = %v, want ErrExists: the tier is already held", err)
	}
	evaluator := achievements.NewEvaluator(catalog, store, allowAllPolicy{}, func() time.Time { return achievementTestNow })
	decisions, err := evaluator.Evaluate(context.Background(), achievementTestPerson, achievements.Event{
		ID: "evt-1", Entity: "guides", Action: "completed",
		Context: map[string]any{"guideSource": "bundled", "guideId": "one", "guideCategory": "interactive"},
	})
	if err != nil || len(decisions) != 1 {
		t.Fatalf("Evaluate = %v, %v", decisions, err)
	}
	if d := decisions[0]; d.Reason.Transient() || len(d.Awarded) != 0 {
		t.Fatalf("decision = %+v, want the 409 tier left out of awarded and the event settled", d)
	}
	held := api.spec(achievementProgressResource, achievementProgressName(achievementTestPerson.ID, "guides-finished"))["tierIds"].([]any)
	if len(held) != 1 || held[0] != "bronze" {
		t.Fatalf("held = %v, want the existing award recorded", held)
	}
}

func achievementTestCatalog(t *testing.T) *achievements.Catalog {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "achievements", "testdata", "bundle.json"))
	if err != nil {
		t.Fatal(err)
	}
	bundle, err := achievements.LoadBundle(data)
	if err != nil || len(bundle.Skipped) > 0 {
		t.Fatalf("LoadBundle = %v, skipped %+v", err, bundle)
	}
	return bundle.Catalog
}

type allowAllPolicy struct{}

func (allowAllPolicy) Allow(context.Context, achievements.Person) error { return nil }

func TestAchievementStore_DrivesTheEvaluator(t *testing.T) {
	catalog := achievementTestCatalog(t)
	store, api := newAchievementTestStore(t)
	evaluator := achievements.NewEvaluator(catalog, store, allowAllPolicy{}, func() time.Time { return achievementTestNow })
	guide := func(id string) achievements.Event {
		return achievements.Event{ID: "evt-" + id, Entity: "guides", Action: "completed",
			Context: map[string]any{"guideSource": "bundled", "guideId": id, "guideCategory": "interactive"}}
	}
	run := func(ev achievements.Event) achievements.Decision {
		t.Helper()
		decisions, err := evaluator.Evaluate(context.Background(), achievementTestPerson, ev)
		if err != nil || len(decisions) != 1 {
			t.Fatalf("Evaluate = %v, %v", decisions, err)
		}
		return decisions[0]
	}

	if d := run(guide("one")); d.Decision != achievements.KindAward || !slices.Equal(d.Awarded, []string{"bronze"}) || d.Units != 1 {
		t.Fatalf("first guide = %+v", d)
	}
	if d := run(guide("one")); d.Decision != achievements.KindIgnored || d.Reason != achievements.ReasonDuplicate || d.Units != 1 {
		t.Fatalf("repeat of the same guide = %+v", d)
	}
	if d := run(guide("two")); d.Decision != achievements.KindIncrement || d.Units != 2 {
		t.Fatalf("second guide = %+v", d)
	}

	if api.spec(achievementAwardResource, achievementAwardName(achievementTestPerson.ID, "guides-finished", "bronze")) == nil {
		t.Fatal("bronze award row missing")
	}
	progress := api.spec(achievementProgressResource, achievementProgressName(achievementTestPerson.ID, "guides-finished"))
	if held := progress["tierIds"].([]any); len(held) != 1 || held[0] != "bronze" || len(progress["units"].([]any)) != 2 {
		t.Fatalf("progress row = %v", progress)
	}
}

func TestAchievementStore_EvaluatorRecoversFromAStaleVersion(t *testing.T) {
	catalog := achievementTestCatalog(t)
	store, api := newAchievementTestStore(t)
	other := &racingStore{Store: store, api: api}
	evaluator := achievements.NewEvaluator(catalog, other, allowAllPolicy{}, func() time.Time { return achievementTestNow })

	decisions, err := evaluator.Evaluate(context.Background(), achievementTestPerson, achievements.Event{
		ID: "evt-mine", Entity: "guides", Action: "completed",
		Context: map[string]any{"guideSource": "bundled", "guideId": "mine", "guideCategory": "interactive"},
	})
	if err != nil || len(decisions) != 1 {
		t.Fatalf("Evaluate = %v, %v", decisions, err)
	}
	if !other.raced {
		t.Fatal("the competing write never happened")
	}
	if d := decisions[0]; d.Reason == achievements.ReasonConflict || d.Units != 2 {
		t.Fatalf("decision = %+v, want both units counted after one retry", d)
	}
	units := api.spec(achievementProgressResource, achievementProgressName(achievementTestPerson.ID, "guides-finished"))["units"].([]any)
	if len(units) != 2 {
		t.Fatalf("stored units = %v, want the other writer's unit and ours", units)
	}
}

// racingStore commits a rival write just before the first save, making it stale.
type racingStore struct {
	achievements.Store
	api   *fakeAchievementAPI
	raced bool
}

func (r *racingStore) SaveProgress(ctx context.Context, person achievements.Person, p achievements.Progress) (achievements.Progress, error) {
	if !r.raced {
		r.raced = true
		rival := p
		rival.Units = []string{unitKeyForTest("bundled", "rival")}
		rival.TierIDs = nil
		if _, err := r.Store.SaveProgress(ctx, person, rival); err != nil {
			return achievements.Progress{}, err
		}
	}
	return r.Store.SaveProgress(ctx, person, p)
}

func unitKeyForTest(parts ...string) string {
	var b strings.Builder
	for _, p := range parts {
		b.WriteString(strconv.Itoa(len(p)))
		b.WriteByte(':')
		b.WriteString(p)
	}
	return b.String()
}
