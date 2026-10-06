// DO NOT MERGE — incremental-progress feasibility spike. See SPIKE.md.

package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"path"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	sdkconfig "github.com/grafana/grafana-plugin-sdk-go/config"
	"github.com/grafana/grafana-plugin-sdk-go/experimental/featuretoggles"

	"github.com/grafana/grafana-pathfinder-app/pkg/plugin/auth"
)

const (
	spikeTestAccessToken = "at-spike-secret-0123456789"
	spikeRunTarget       = "/spike/progress/run?confirm=spike-progress-writes"
	spikeFakeCollection  = "/apis/pathfinderbackend.ext.grafana.app/v1alpha1/namespaces/" + testNamespace + "/completionrecords"
	spikeForeignName     = "completion-foreign123"
)

// --- Fake apiserver (+ JWKS on the same origin) -------------------------------

type spikeFakeRequest struct {
	Method, Path, RawQuery, ContentType string
	Header                              http.Header
}

type spikeFake struct {
	mu       sync.Mutex
	rv       int
	objs     map[string]map[string]any
	requests []spikeFakeRequest

	annotationKey       string // stamped on a spec-changing update; "" = none
	putStatus           int    // forced status for PUT
	patchStatus         int    // forced status for PATCH
	deleteStatus        int    // forced status for DELETE
	putNoPersist        bool   // PUT answers 200 but changes nothing
	createCommitThen500 bool   // POST stores the object, then answers 500
	preexistOnCreate    bool   // POST finds the name already taken (stores a look-alike), answers 409
	listStatus          int    // forced status for collection LIST
	listContinue        string // metadata.continue on collection LIST; "" = last page

	server *httptest.Server
}

func newSpikeFake(t *testing.T, configure func(*spikeFake)) *spikeFake {
	t.Helper()
	f := &spikeFake{objs: map[string]map[string]any{}, annotationKey: spikeAnnoUpdatedTimestampApp}
	if configure != nil {
		configure(f)
	}
	jwks := jwksBody(testSigningKeyID, testSigningKey())
	f.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == auth.SigningKeysPath {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write(jwks)
			return
		}
		f.serve(w, r)
	}))
	t.Cleanup(f.server.Close)
	return f
}

func (f *spikeFake) seedForeign() {
	f.rv++
	f.objs[spikeForeignName] = map[string]any{
		"apiVersion": completionRecordsGroupVersion,
		"kind":       "CompletionRecord",
		"metadata": map[string]any{
			"name": spikeForeignName, "namespace": testNamespace, "uid": "uid-foreign",
			"resourceVersion": strconv.Itoa(f.rv),
			// Deliberately carries the spike label and guideSource to stress the
			// name-prefix guard.
			"labels":      map[string]any{spikeLabelKey: spikeLabelValue},
			"annotations": map[string]any{"note": "FOREIGN-ANNOTATION"},
		},
		"spec": map[string]any{"userId": "user:victim", "guideTitle": "FOREIGN-SECRET-TITLE", "guideSource": "spike"},
	}
}

// seedOwn stores a spike-labelled record owned by userID, as a leftover from
// an earlier run would look.
func (f *spikeFake) seedOwn(name, userID string) {
	f.rv++
	f.objs[name] = map[string]any{
		"apiVersion": completionRecordsGroupVersion,
		"kind":       "CompletionRecord",
		"metadata": map[string]any{
			"name": name, "namespace": testNamespace, "uid": "uid-" + name,
			"resourceVersion": strconv.Itoa(f.rv),
			"labels":          map[string]any{spikeLabelKey: spikeLabelValue},
		},
		"spec": map[string]any{"userId": userID, "guideSource": "spike"},
	}
}

func fakeMeta(obj map[string]any) map[string]any {
	md, _ := obj["metadata"].(map[string]any)
	if md == nil {
		md = map[string]any{}
	}
	return md
}

func (f *spikeFake) snapshotRequests() []spikeFakeRequest {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]spikeFakeRequest(nil), f.requests...)
}

func (f *spikeFake) apiRequests() int {
	n := 0
	for _, r := range f.snapshotRequests() {
		if strings.HasPrefix(r.Path, "/apis") {
			n++
		}
	}
	return n
}

func (f *spikeFake) has(name string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	_, ok := f.objs[name]
	return ok
}

func (f *spikeFake) writeObj(w http.ResponseWriter, code int, obj any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(obj)
}

func (f *spikeFake) status(w http.ResponseWriter, code int, reason, message string, details map[string]any) {
	st := map[string]any{
		"kind": "Status", "apiVersion": "v1", "metadata": map[string]any{},
		"status": "Failure", "message": message, "reason": reason, "code": code,
	}
	if details != nil {
		st["details"] = details
	}
	f.writeObj(w, code, st)
}

func (f *spikeFake) forced(w http.ResponseWriter, code int) {
	reason := map[int]string{401: "Unauthorized", 403: "Forbidden", 500: "InternalError"}[code]
	f.status(w, code, reason, "forced by test", nil)
}

func (f *spikeFake) conflict(w http.ResponseWriter, name string) {
	f.status(w, http.StatusConflict, "Conflict",
		fmt.Sprintf("Operation cannot be fulfilled on completionrecords %q: the object has been modified", name),
		map[string]any{"name": name, "kind": "completionrecords"})
}

func (f *spikeFake) plain404(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusNotFound)
	_, _ = io.WriteString(w, "404 page not found\n")
}

func (f *spikeFake) serve(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	body, _ := io.ReadAll(r.Body)
	f.requests = append(f.requests, spikeFakeRequest{
		Method: r.Method, Path: r.URL.Path, RawQuery: r.URL.RawQuery,
		ContentType: r.Header.Get("Content-Type"), Header: r.Header.Clone(),
	})
	w.Header().Set("Audit-Id", fmt.Sprintf("audit-%d", len(f.requests)))

	rest, ok := strings.CutPrefix(r.URL.Path, spikeFakeCollection)
	switch {
	case !ok:
		f.plain404(w)
	case rest == "":
		f.collection(w, r, body)
	case len(rest) > 1 && rest[0] == '/' && !strings.Contains(rest[1:], "/"):
		f.item(w, r, rest[1:], body)
	default:
		f.plain404(w)
	}
}

func (f *spikeFake) collection(w http.ResponseWriter, r *http.Request, body []byte) {
	switch r.Method {
	case http.MethodGet:
		if f.listStatus != 0 {
			f.forced(w, f.listStatus)
			return
		}
		q := r.URL.Query()
		names := make([]string, 0, len(f.objs))
		for n := range f.objs {
			names = append(names, n)
		}
		sort.Strings(names)
		items := []any{}
		for _, n := range names {
			obj := f.objs[n]
			if sel := q.Get("labelSelector"); sel != "" {
				k, v, _ := strings.Cut(sel, "=")
				labels, _ := fakeMeta(obj)["labels"].(map[string]any)
				if labels[k] != v {
					continue
				}
			}
			if sel := q.Get("fieldSelector"); sel != "" {
				if _, v, _ := strings.Cut(sel, "="); n != v {
					continue
				}
			}
			items = append(items, obj)
		}
		f.writeObj(w, http.StatusOK, map[string]any{
			"kind": "CompletionRecordList", "apiVersion": completionRecordsGroupVersion,
			"metadata": map[string]any{"resourceVersion": strconv.Itoa(f.rv), "continue": f.listContinue}, "items": items,
		})
	case http.MethodPost:
		var obj map[string]any
		if err := json.Unmarshal(body, &obj); err != nil {
			f.status(w, http.StatusBadRequest, "BadRequest", "bad json", nil)
			return
		}
		md := fakeMeta(obj)
		name, _ := md["name"].(string)
		spec, _ := obj["spec"].(map[string]any)
		if _, ok := spec["completedAt"]; !ok {
			// Hostile: echoes the received credential, to prove redaction.
			f.status(w, http.StatusUnprocessableEntity, "Invalid",
				fmt.Sprintf("CompletionRecord %q is invalid: spec.completedAt: Required value (request token %s)", name, r.Header.Get(auth.AccessTokenHeader)),
				map[string]any{"name": name, "kind": "CompletionRecord", "causes": []any{
					map[string]any{"reason": "FieldValueRequired", "message": "Required value", "field": "spec.completedAt"},
				}})
			return
		}
		if _, exists := f.objs[name]; exists {
			f.status(w, http.StatusConflict, "AlreadyExists", "already exists", nil)
			return
		}
		f.rv++
		md["uid"] = "uid-" + name
		md["resourceVersion"] = strconv.Itoa(f.rv)
		md["generation"] = 1
		md["creationTimestamp"] = timeNow().UTC().Format(time.RFC3339)
		md["managedFields"] = []any{map[string]any{"manager": "spike-fake", "operation": "Update"}}
		if ann, ok := md["annotations"].(map[string]any); ok {
			delete(ann, f.annotationKey)
		}
		f.objs[name] = obj
		if f.preexistOnCreate {
			// The stored record matches this caller in every respect (name,
			// label, guideSource, userId, fresh creationTimestamp) except that
			// this request did not create it.
			md["uid"] = "uid-preexisting-" + name
			f.status(w, http.StatusConflict, "AlreadyExists", fmt.Sprintf("completionrecords %q already exists", name), nil)
			return
		}
		if f.createCommitThen500 {
			f.status(w, http.StatusInternalServerError, "InternalError", "committed, then failed", nil)
			return
		}
		f.writeObj(w, http.StatusCreated, obj)
	default:
		f.status(w, http.StatusMethodNotAllowed, "MethodNotAllowed", "", nil)
	}
}

func (f *spikeFake) update(obj, spec map[string]any) {
	md := fakeMeta(obj)
	changed := string(spikeJSON(obj["spec"])) != string(spikeJSON(spec))
	obj["spec"] = spec
	f.rv++
	md["resourceVersion"] = strconv.Itoa(f.rv)
	if !changed {
		return
	}
	g, _ := md["generation"].(int)
	md["generation"] = g + 1
	if f.annotationKey != "" {
		ann, _ := md["annotations"].(map[string]any)
		if ann == nil {
			ann = map[string]any{}
			md["annotations"] = ann
		}
		ann[f.annotationKey] = fmt.Sprintf("2026-10-06T10:00:%02dZ", f.rv)
	}
}

func (f *spikeFake) item(w http.ResponseWriter, r *http.Request, name string, body []byte) {
	obj, exists := f.objs[name]
	notFound := func() {
		f.status(w, http.StatusNotFound, "NotFound",
			fmt.Sprintf("completionrecords.pathfinderbackend.ext.grafana.app %q not found", name),
			map[string]any{"name": name, "kind": "completionrecords"})
	}
	var in map[string]any
	_ = json.Unmarshal(body, &in)

	switch r.Method {
	case http.MethodGet:
		if !exists {
			notFound()
			return
		}
		f.writeObj(w, http.StatusOK, obj)
	case http.MethodPut:
		if f.putStatus != 0 {
			f.forced(w, f.putStatus)
			return
		}
		if !exists {
			notFound()
			return
		}
		if fakeMeta(in)["resourceVersion"] != fakeMeta(obj)["resourceVersion"] {
			f.conflict(w, name)
			return
		}
		if f.putNoPersist {
			f.writeObj(w, http.StatusOK, obj)
			return
		}
		spec, _ := in["spec"].(map[string]any)
		f.update(obj, spec)
		f.writeObj(w, http.StatusOK, obj)
	case http.MethodPatch:
		if f.patchStatus != 0 {
			f.forced(w, f.patchStatus)
			return
		}
		if r.Header.Get("Content-Type") != spikeMergePatchType {
			f.status(w, http.StatusUnsupportedMediaType, "UnsupportedMediaType", "", nil)
			return
		}
		if !exists {
			notFound()
			return
		}
		if rv, ok := fakeMeta(in)["resourceVersion"]; ok && rv != fakeMeta(obj)["resourceVersion"] {
			f.conflict(w, name)
			return
		}
		merged := map[string]any{}
		if cur, ok := obj["spec"].(map[string]any); ok {
			for k, v := range cur {
				merged[k] = v
			}
		}
		if patch, ok := in["spec"].(map[string]any); ok {
			for k, v := range patch {
				merged[k] = v
			}
		}
		f.update(obj, merged)
		f.writeObj(w, http.StatusOK, obj)
	case http.MethodDelete:
		if f.deleteStatus != 0 {
			f.forced(w, f.deleteStatus)
			return
		}
		if !exists {
			notFound()
			return
		}
		pre, _ := in["preconditions"].(map[string]any)
		if pre["uid"] != fakeMeta(obj)["uid"] {
			f.conflict(w, name)
			return
		}
		delete(f.objs, name)
		f.writeObj(w, http.StatusOK, map[string]any{"kind": "Status", "apiVersion": "v1", "status": "Success", "details": map[string]any{"name": name}})
	default:
		f.status(w, http.StatusMethodNotAllowed, "MethodNotAllowed", "", nil)
	}
}

// --- Harness -----------------------------------------------------------------

func withSpikeEnv(t *testing.T, minter accessTokenMinter) {
	t.Helper()
	withFrozenTime(t, time.Date(2026, 10, 6, 12, 0, 0, 0, time.UTC))
	prevMinter, prevSleep := spikeMinterOverride, spikeProgressSleep
	spikeMinterOverride = minter
	spikeProgressSleep = func(context.Context, time.Duration) {}
	resetCompletionRecordsCache()
	t.Cleanup(func() {
		spikeMinterOverride = prevMinter
		spikeProgressSleep = prevSleep
		resetCompletionRecordsCache()
	})
}

type spikeReqOpts struct {
	role    string // default Viewer
	sub     string // default user:42
	noToken bool
	cfg     map[string]string
}

// newSpikeApp is newTestApp with its spike run counter dropped at test end.
func newSpikeApp(t *testing.T) *App {
	t.Helper()
	app := newTestApp(t)
	t.Cleanup(func() { delete(spikeRunCounts, app) })
	return app
}

func spikeInvalidations() uint64 {
	completionCacheMu.Lock()
	defer completionCacheMu.Unlock()
	return completionGenerations[testNamespace]
}

type spikeRoundTripFunc func(*http.Request) (*http.Response, error)

func (f spikeRoundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func spikeRequest(t *testing.T, f *spikeFake, method, target string, opts spikeReqOpts) (*http.Request, string) {
	t.Helper()
	role := opts.role
	if role == "" {
		role = "Viewer"
	}
	r := httptest.NewRequest(method, target, nil)
	idToken := ""
	sub := opts.sub
	if sub == "" {
		sub = "user:42"
	}
	if !opts.noToken {
		idToken = makeValidIDTokenWithProfile(t, sub, "viewer1", "Vera Viewer")
		r.Header.Set(backend.GrafanaUserSignInTokenHeaderName, idToken)
	}
	cfg := opts.cfg
	if cfg == nil {
		cfg = map[string]string{
			featuretoggles.EnabledFeatures: completionRecordsAggregationToggle,
			sdkconfig.AppURL:               f.server.URL,
		}
	}
	pc := backend.PluginContext{Namespace: testNamespace, OrgID: 7, User: &backend.User{Login: "viewer1", Role: role}} //nolint:staticcheck // numeric orgId
	ctx := backend.WithPluginContext(r.Context(), pc)
	ctx = sdkconfig.WithGrafanaConfig(ctx, sdkconfig.NewGrafanaCfg(cfg))
	return r.WithContext(ctx), idToken
}

func runSpike(t *testing.T, f *spikeFake) (spikeReport, string, string) {
	t.Helper()
	r, idToken := spikeRequest(t, f, http.MethodPost, spikeRunTarget, spikeReqOpts{})
	rec := httptest.NewRecorder()
	newSpikeApp(t).handleSpikeProgressRun(rec, r)
	if rec.Code != http.StatusOK {
		t.Fatalf("run status = %d, body: %s", rec.Code, rec.Body.String())
	}
	var rep spikeReport
	if err := json.Unmarshal(rec.Body.Bytes(), &rep); err != nil {
		t.Fatalf("decode report: %v", err)
	}
	return rep, rec.Body.String(), idToken
}

func tsKey(t *testing.T, rep spikeReport, key string) spikeTimestampKey {
	t.Helper()
	for _, k := range rep.UpdateTimestamp.Keys {
		if k.Key == key {
			return k
		}
	}
	t.Fatalf("timestamp key %q not reported", key)
	return spikeTimestampKey{}
}

func cleanupOutcome(rep spikeReport, suffix string) string {
	return cleanupFor(rep, suffix).Outcome
}

func cleanupFor(rep spikeReport, suffix string) spikeCleanupResult {
	for _, c := range rep.Cleanup {
		if strings.HasSuffix(c.Name, suffix) {
			return c
		}
	}
	return spikeCleanupResult{}
}

func stepFor(rep spikeReport, check string) *spikeStep {
	for _, s := range rep.Steps {
		if s.Check == check {
			return s
		}
	}
	return nil
}

func decisionHas(rep spikeReport, substr string) bool {
	for _, l := range rep.Decision {
		if strings.Contains(l, substr) {
			return true
		}
	}
	return false
}

// --- Unit: redaction, parsing, verdict, decision -------------------------------

func TestSpikeRedactor(t *testing.T) {
	red := &spikeRedactor{}
	red.addSecret("exact-secret-value")
	red.addSecret("")

	for _, tc := range []struct{ in, leak string }{
		{"jwt eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ1In0.c2ln-_x here", "eyJ"},
		{"Authorization: Bearer abc.def", "abc.def"},
		{"key glsa_ABCdef_123-x", "glsa_"},
		{"key glc_ABCdef", "glc_"},
		{"key glpat_ABCdef", "glpat_"},
		{"key glc_AB+cd/ef== end", "/ef=="},
		{"key glsa_abc=def+ghi", "=def+ghi"},
		{"contains exact-secret-value here", "exact-secret-value"},
	} {
		got := red.str(tc.in)
		if strings.Contains(got, tc.leak) || !strings.Contains(got, spikeRedacted) {
			t.Errorf("str(%q) = %q", tc.in, got)
		}
	}

	v := red.value(map[string]any{
		"access_token": "plain",
		"nested":       map[string]any{"Cookie": "c=1", "ok": "fine"},
		"list":         []any{"Bearer zzz"},
	}).(map[string]any)
	if v["access_token"] != spikeRedacted {
		t.Errorf("access_token = %v", v["access_token"])
	}
	nested := v["nested"].(map[string]any)
	if nested["Cookie"] != spikeRedacted || nested["ok"] != "fine" {
		t.Errorf("nested = %v", nested)
	}
	if l := v["list"].([]any); l[0] != spikeRedacted {
		t.Errorf("list = %v", l)
	}

	// Hostile Status body.
	body := `{"kind":"Status","reason":"Forbidden","message":"denied for exact-secret-value and eyJa.eyJb.c","details":{"authorization":"x","causes":[{"message":"Bearer qqq"}]}}`
	st, _, _ := spikeSummarize(403, "application/json", []byte(body), red)
	out := string(spikeJSON(st))
	for _, leak := range []string{"exact-secret-value", "eyJa", "qqq"} {
		if strings.Contains(out, leak) {
			t.Errorf("summary leaks %q: %s", leak, out)
		}
	}
	if d := st.Details.(map[string]any); d["authorization"] != spikeRedacted {
		t.Errorf("details.authorization = %v", d["authorization"])
	}

	// Label/annotation maps: values under sensitive keys are redacted even when
	// they don't look like a token.
	sm := spikeStringMap(map[string]any{
		"example.com/auth-token":       "plain-value",
		"Session-Cookie":               "c=1",
		"x/Password":                   "hunter2",
		"grafana.app/updatedTimestamp": "2026-10-06T10:00:00Z",
	}, red, spikeAnnotationMaxBytes)
	for _, k := range []string{"example.com/auth-token", "Session-Cookie", "x/Password"} {
		if sm[k] != spikeRedacted {
			t.Errorf("stringMap[%q] = %q", k, sm[k])
		}
	}
	if sm["grafana.app/updatedTimestamp"] != "2026-10-06T10:00:00Z" {
		t.Errorf("timestamp annotation altered: %q", sm["grafana.app/updatedTimestamp"])
	}
	if meta := spikeMetaFrom(map[string]any{"metadata": map[string]any{"name": "n", "annotations": map[string]any{"secretRef": "s3cr3t"}}}, red); meta.Annotations["secretRef"] != spikeRedacted {
		t.Errorf("meta annotation = %q", meta.Annotations["secretRef"])
	}

	// Upstream URLs and hosts.
	up := spikeNewRedactor("https://stack-x.grafana-dev.net/")
	got := up.str("Get https://stack-x.grafana-dev.net/apis: lookup stack-x.grafana-dev.net; via " + tokenExchangeURL)
	if strings.Contains(got, "stack-x.grafana-dev.net") || strings.Contains(got, tokenExchangeURL) || !strings.Contains(got, spikeUpstream) {
		t.Errorf("upstream redaction = %q", got)
	}
}

func TestSpikeSummarize(t *testing.T) {
	red := &spikeRedactor{}

	t.Run("status JSON", func(t *testing.T) {
		body := `{"kind":"Status","apiVersion":"v1","status":"Failure","message":"x not found","reason":"NotFound","code":404,"details":{"name":"x"}}`
		st, meta, _ := spikeSummarize(404, "application/json", []byte(body), red)
		if st == nil || !st.IsStatusJSON || st.Kind != "Status" || st.Reason != "NotFound" || st.Code != 404 || st.Message != "x not found" || st.Excerpt != "" {
			t.Fatalf("summary = %+v", st)
		}
		if meta != nil {
			t.Errorf("Status must not yield meta: %+v", meta)
		}
	})
	t.Run("non-JSON", func(t *testing.T) {
		st, meta, _ := spikeSummarize(404, "text/plain; charset=utf-8", []byte("404 page not found\n"), red)
		if st == nil || st.IsStatusJSON || st.Excerpt != "404 page not found\n" || st.Status != 404 || meta != nil {
			t.Fatalf("summary = %+v", st)
		}
	})
	t.Run("excerpt capped", func(t *testing.T) {
		st, _, _ := spikeSummarize(502, "text/html", []byte(strings.Repeat("a", 5000)), red)
		if len(st.Excerpt) != spikeExcerptMaxBytes || !st.ExcerptTruncated {
			t.Errorf("excerpt len = %d, truncated = %t", len(st.Excerpt), st.ExcerptTruncated)
		}
		st, _, _ = spikeSummarize(502, "text/html", []byte("short"), red)
		if st.Excerpt != "short" || st.ExcerptTruncated {
			t.Errorf("short excerpt = %+v", st)
		}
	})
	t.Run("non-Status JSON 422", func(t *testing.T) {
		body := `{"error":"validation failed: spec.completedAt required","access_token":"tok-XYZ",` +
			`"metadata":{"name":"n","managedFields":[{"manager":"MF-MGR"}]},` +
			`"detail":"Bearer abc123 and glsa_Zz+/9=","nested":{"Cookie":"c=1"},` +
			`"pad":"` + strings.Repeat("p", 3000) + `"}`
		st, _, _ := spikeSummarize(422, "application/json", []byte(body), red)
		if st == nil || st.IsStatusJSON || st.Status != 422 {
			t.Fatalf("summary = %+v", st)
		}
		if !strings.Contains(st.Excerpt, "validation failed: spec.completedAt required") {
			t.Errorf("excerpt lacks the error: %q", st.Excerpt)
		}
		for _, leak := range []string{"tok-XYZ", "MF-MGR", "managedFields", "abc123", "Zz+/9=", "c=1"} {
			if strings.Contains(st.Excerpt, leak) {
				t.Errorf("excerpt leaks %q", leak)
			}
		}
		if !st.ExcerptTruncated || len(st.Excerpt) > spikeExcerptMaxBytes {
			t.Errorf("excerpt len = %d, truncated = %t", len(st.Excerpt), st.ExcerptTruncated)
		}
	})
	t.Run("object", func(t *testing.T) {
		body := `{"kind":"CompletionRecord","metadata":{"name":"n","uid":"u","resourceVersion":"12","generation":3,
			"labels":{"l":"v"},"annotations":{"grafana.app/updatedTimestamp":"t"},
			"managedFields":[{"manager":"m1"},{"manager":"m2"}]},"spec":{"guideTitle":"SECRET-SPEC"}}`
		st, meta, _ := spikeSummarize(200, "application/json", []byte(body), red)
		if st != nil {
			t.Errorf("2xx object must not yield a status summary: %+v", st)
		}
		if meta == nil || meta.Name != "n" || meta.UID != "u" || meta.ResourceVersion != "12" || meta.Generation == nil || *meta.Generation != 3 ||
			meta.Labels["l"] != "v" || meta.Annotations[spikeAnnoUpdatedTimestampApp] != "t" ||
			!meta.ManagedFieldsPresent || meta.ManagedFieldsCount != 2 || strings.Join(meta.Managers, ",") != "m1,m2" {
			t.Fatalf("meta = %+v", meta)
		}
		if strings.Contains(string(spikeJSON(meta)), "SECRET-SPEC") {
			t.Error("meta snapshot carries spec data")
		}
	})
	t.Run("list", func(t *testing.T) {
		body := `{"kind":"XList","metadata":{"resourceVersion":"9"},"items":[{"metadata":{"name":"foreign"}}]}`
		st, meta, _ := spikeSummarize(200, "application/json", []byte(body), red)
		if st != nil || meta != nil {
			t.Errorf("list must yield neither: %+v %+v", st, meta)
		}
	})
	t.Run("distinguishable", func(t *testing.T) {
		notFound := &spikeStatusSummary{IsStatusJSON: true, Reason: "NotFound", ContentType: "application/json"}
		plain := &spikeStatusSummary{ContentType: "text/plain; charset=utf-8"}
		if got, _ := spikeDistinguishable(404, notFound, 404, plain); got != "yes" {
			t.Errorf("Status NotFound vs text/plain = %q, want yes", got)
		}
		if got, _ := spikeDistinguishable(404, notFound, 404, &spikeStatusSummary{IsStatusJSON: true, Reason: "NotFound", ContentType: "application/json; charset=utf-8"}); got != "no" {
			t.Errorf("identical shapes = %q, want no", got)
		}
		for _, tc := range []struct{ a, b int }{{404, 403}, {401, 404}, {0, 404}, {200, 200}} {
			got, reason := spikeDistinguishable(tc.a, notFound, tc.b, plain)
			if got != "inconclusive" || !strings.Contains(reason, fmt.Sprintf("got %d and %d", tc.a, tc.b)) {
				t.Errorf("statuses %d/%d = (%q, %q), want inconclusive", tc.a, tc.b, got, reason)
			}
		}
	})
}

func TestSpikeVerdict(t *testing.T) {
	for _, tc := range []struct {
		status     int
		noResponse bool
		want       []int
		verdict    string
	}{
		{200, false, []int{200}, spikePass},
		{201, false, []int{201, 200}, spikePass},
		{404, false, []int{200}, spikeFail},
		{0, true, []int{200}, spikeError},
		{403, false, nil, spikeObserve},
	} {
		if got := spikeVerdict(tc.status, tc.noResponse, tc.want); got != tc.verdict {
			t.Errorf("spikeVerdict(%d, %t, %v) = %q, want %q", tc.status, tc.noResponse, tc.want, got, tc.verdict)
		}
	}
}

func TestSpikeDecide(t *testing.T) {
	noTS := spikeTimestampReport{Keys: []spikeTimestampKey{{Key: spikeAnnoUpdatedTimestampApp}, {Key: spikeAnnoUpdateTimestampCom}}}
	withTS := spikeTimestampReport{Keys: []spikeTimestampKey{{Key: spikeAnnoUpdatedTimestampApp}, {Key: spikeAnnoUpdateTimestampCom, ChangedByPut: true}}}
	tests := []struct {
		name     string
		f        spikeFindings
		ts       spikeTimestampReport
		first    string
		contains []string
		absent   []string
	}{
		{"proceed", spikeFindings{PutWorks: true, PutStatus: 200, StalePutConflicts: true, Check8Status: 422, Check8Reason: "Invalid"}, withTS,
			"PROCEED: GET→PUT with metadata.resourceVersion",
			[]string{"SERVER UPDATE TIMESTAMP: grafana.com/updateTimestamp", `status 422, reason "Invalid"`}, []string{"AUTHZ", "NO SERVER UPDATE TIMESTAMP", "SIGNIFICANT"}},
		{"caution", spikeFindings{PutWorks: true, PutStatus: 200, StalePutStatus: 200}, noTS,
			"CAUTION: PUT persists but optimistic concurrency not enforced — do not proceed without resolving",
			[]string{"NO SERVER UPDATE TIMESTAMP: use spec.recordedAt"}, nil},
		{"merge-patch, stale rejected", spikeFindings{PutStatus: 403, MergePatchStatus: 200, MergePatchWorks: true, MergePatchStaleConflicts: true, MergePatchStaleMeaningful: true}, noTS,
			"USE MERGE-PATCH with RV precondition (stale rejected)", []string{"AUTHZ"}, nil},
		{"merge-patch, stale not meaningful", spikeFindings{PutStatus: 403, MergePatchStatus: 200, MergePatchWorks: true, MergePatchStaleConflicts: true}, noTS,
			"USE MERGE-PATCH \u2014 stale-RV protection not demonstrated", nil, []string{"stale rejected"}},
		{"merge-patch, stale not rejected", spikeFindings{PutStatus: 403, MergePatchStatus: 200, MergePatchWorks: true, MergePatchStaleStatus: 200, MergePatchStaleMeaningful: true}, noTS,
			"USE MERGE-PATCH — WARNING: stale RV not rejected", nil, nil},
		{"merge-patch, stale 409 but persisted", spikeFindings{MergePatchWorks: true, MergePatchStaleConflicts: true, MergePatchStalePersisted: true, MergePatchStaleMeaningful: true}, noTS,
			"USE MERGE-PATCH — WARNING: stale RV not rejected", nil, nil},
		{"stop", spikeFindings{PutStatus: 403, MergePatchStatus: 403}, noTS,
			"STOP: no in-place update path for a Viewer via OBO", []string{"AUTHZ"}, nil},
		{"check 8 accepted", spikeFindings{Check8Status: 201}, noTS,
			"STOP: no in-place update path for a Viewer via OBO", []string{"SIGNIFICANT"}, nil},
		{"skipped note", spikeFindings{DependentStepsSkipped: true}, noTS,
			"STOP: no in-place update path for a Viewer via OBO", []string{"not conclusive"}, nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			lines := spikeDecide(tt.f, tt.ts)
			if len(lines) == 0 || lines[0] != tt.first {
				t.Fatalf("first line = %q, want %q (all: %v)", lines, tt.first, lines)
			}
			joined := strings.Join(lines, "\n")
			for _, c := range tt.contains {
				if !strings.Contains(joined, c) {
					t.Errorf("missing %q in %v", c, lines)
				}
			}
			for _, a := range tt.absent {
				if strings.Contains(joined, a) {
					t.Errorf("unexpected %q in %v", a, lines)
				}
			}
		})
	}
}

// --- End to end ----------------------------------------------------------------

func TestSpikeRun_HappyPath(t *testing.T) {
	f := newSpikeFake(t, nil)
	minter := &stubMinter{token: spikeTestAccessToken}
	withSpikeEnv(t, minter)

	rep, raw, idToken := runSpike(t, f)

	if len(rep.Decision) == 0 || rep.Decision[0] != "PROCEED: GET→PUT with metadata.resourceVersion" {
		t.Fatalf("decision = %v", rep.Decision)
	}
	if !decisionHas(rep, "SERVER UPDATE TIMESTAMP: "+spikeAnnoUpdatedTimestampApp) {
		t.Errorf("decision does not name the annotation: %v", rep.Decision)
	}
	fd := rep.Findings
	if !fd.PutWorks || !fd.StalePutConflicts || !fd.MergePatchWorks || !fd.MergePatchStaleConflicts || fd.MergePatchStalePersisted || !fd.MergePatchStaleMeaningful {
		t.Errorf("findings = %+v", fd)
	}
	if fd.OnList != "found-via-labelSelector" || fd.NotFoundDistinguishable != "yes" || fd.Check8Status != 422 || fd.Check8Reason != "Invalid" || !fd.DeleteWorks {
		t.Errorf("findings = %+v", fd)
	}
	if n := spikeInvalidations(); n != 1 {
		t.Errorf("completion index invalidated %d times, want 1 (a create returned 2xx)", n)
	}
	if pre := stepFor(rep, "check0-leftovers-list"); pre == nil || pre.Status != 200 || pre.Note != "callerLeftovers=0" {
		t.Errorf("leftover pre-check step = %+v", pre)
	}
	if c := cleanupFor(rep, "-a"); c.CreateOutcome != spikeCreateCreated {
		t.Errorf("A create outcome = %q", c.CreateOutcome)
	}
	if c := cleanupFor(rep, "-b"); c.CreateOutcome != spikeCreateRejected {
		t.Errorf("B create outcome = %q", c.CreateOutcome)
	}

	k := tsKey(t, rep, spikeAnnoUpdatedTimestampApp)
	if k.PresentAfterCreate || !k.ChangedByPut || !k.ChangedByPatch || !k.ReturnedOnList {
		t.Errorf("grafana.app key = %+v", k)
	}
	if com := tsKey(t, rep, spikeAnnoUpdateTimestampCom); com.ChangedByPut || com.ChangedByPatch {
		t.Errorf("grafana.com key = %+v", com)
	}
	if rep.StorageSignals.Conclusion != spikeStorageConclusion || !rep.StorageSignals.ManagedFieldsPresent {
		t.Errorf("storage = %+v", rep.StorageSignals)
	}

	if cleanupOutcome(rep, "-a") != "deleted" || cleanupOutcome(rep, "-b") != "absent" {
		t.Errorf("cleanup = %+v", rep.Cleanup)
	}
	for _, name := range rep.Records {
		if f.has(name) {
			t.Errorf("record %s left behind", name)
		}
	}

	if minter.gotIDToken != idToken || minter.gotNamespace != testNamespace {
		t.Errorf("minter got (%q, %q)", minter.gotNamespace, minter.gotIDToken)
	}
	sawPatch := false
	for _, req := range f.snapshotRequests() {
		if req.Header.Get(auth.AccessTokenHeader) != spikeTestAccessToken {
			t.Errorf("%s %s: X-Access-Token = %q", req.Method, req.Path, req.Header.Get(auth.AccessTokenHeader))
		}
		if req.Header.Get(backend.GrafanaUserSignInTokenHeaderName) != "" || req.Header.Get("Authorization") != "" {
			t.Errorf("%s %s forwarded the ID token or an Authorization header", req.Method, req.Path)
		}
		if req.Method == http.MethodPatch {
			sawPatch = true
			if req.ContentType != spikeMergePatchType {
				t.Errorf("PATCH content-type = %q", req.ContentType)
			}
		}
		if req.Method == http.MethodGet && strings.HasSuffix(req.Path, "/completionrecords") && req.RawQuery == "" {
			t.Error("unfiltered LIST issued")
		}
	}
	if !sawPatch {
		t.Error("no PATCH issued")
	}
	if strings.Contains(raw, f.server.URL) {
		t.Error("report carries the upstream host")
	}
}

func TestSpikeRun_NoSecretsInReport(t *testing.T) {
	f := newSpikeFake(t, nil) // the fake echoes the access token in its 422 message
	withSpikeEnv(t, &stubMinter{token: spikeTestAccessToken})

	_, raw, idToken := runSpike(t, f)
	if strings.Contains(raw, spikeTestAccessToken) {
		t.Error("report leaks the access token")
	}
	if strings.Contains(raw, idToken) || strings.Contains(raw, "eyJ") {
		t.Error("report leaks the ID token")
	}
	if !strings.Contains(raw, spikeRedacted) {
		t.Error("expected the echoed token to be redacted, not dropped")
	}
}

func TestSpikeRun_AlternateAnnotationKeys(t *testing.T) {
	t.Run("grafana.com/updateTimestamp", func(t *testing.T) {
		f := newSpikeFake(t, func(f *spikeFake) { f.annotationKey = spikeAnnoUpdateTimestampCom })
		withSpikeEnv(t, &stubMinter{token: spikeTestAccessToken})
		rep, _, _ := runSpike(t, f)
		if k := tsKey(t, rep, spikeAnnoUpdateTimestampCom); k.PresentAfterCreate || !k.ChangedByPut || !k.ReturnedOnList {
			t.Errorf("grafana.com key = %+v", k)
		}
		if k := tsKey(t, rep, spikeAnnoUpdatedTimestampApp); k.ChangedByPut {
			t.Errorf("grafana.app key = %+v", k)
		}
		if !decisionHas(rep, "SERVER UPDATE TIMESTAMP: "+spikeAnnoUpdateTimestampCom) {
			t.Errorf("decision = %v", rep.Decision)
		}
	})
	t.Run("no annotation", func(t *testing.T) {
		f := newSpikeFake(t, func(f *spikeFake) { f.annotationKey = "" })
		withSpikeEnv(t, &stubMinter{token: spikeTestAccessToken})
		rep, _, _ := runSpike(t, f)
		if !decisionHas(rep, "NO SERVER UPDATE TIMESTAMP: use spec.recordedAt") {
			t.Errorf("decision = %v", rep.Decision)
		}
	})
}

func TestSpikeRun_PutForbiddenPatchWorks(t *testing.T) {
	f := newSpikeFake(t, func(f *spikeFake) { f.putStatus = http.StatusForbidden })
	withSpikeEnv(t, &stubMinter{token: spikeTestAccessToken})
	rep, _, _ := runSpike(t, f)
	if rep.Decision[0] != "USE MERGE-PATCH with RV precondition (stale rejected)" {
		t.Fatalf("decision = %v", rep.Decision)
	}
	if !decisionHas(rep, "AUTHZ") || !rep.Findings.StalePutSkipped {
		t.Errorf("decision = %v, findings = %+v", rep.Decision, rep.Findings)
	}
}

func TestSpikeRun_NeitherWorks(t *testing.T) {
	f := newSpikeFake(t, func(f *spikeFake) {
		f.putStatus = http.StatusForbidden
		f.patchStatus = http.StatusForbidden
	})
	withSpikeEnv(t, &stubMinter{token: spikeTestAccessToken})
	rep, _, _ := runSpike(t, f)
	if rep.Decision[0] != "STOP: no in-place update path for a Viewer via OBO" || !decisionHas(rep, "AUTHZ") {
		t.Fatalf("decision = %v", rep.Decision)
	}
	if cleanupOutcome(rep, "-a") != "deleted" {
		t.Errorf("cleanup = %+v", rep.Cleanup)
	}
}

func TestSpikeRun_PutOKButNotPersisted(t *testing.T) {
	f := newSpikeFake(t, func(f *spikeFake) { f.putNoPersist = true })
	withSpikeEnv(t, &stubMinter{token: spikeTestAccessToken})
	rep, _, _ := runSpike(t, f)
	fd := rep.Findings
	if fd.PutStatus != 200 || fd.PutPersisted || fd.PutWorks {
		t.Fatalf("findings = %+v", fd)
	}
	if !strings.HasPrefix(rep.Decision[0], "USE MERGE-PATCH") {
		t.Errorf("decision = %v", rep.Decision)
	}
}

func TestSpikeRun_NeverTouchesForeignRecord(t *testing.T) {
	f := newSpikeFake(t, func(f *spikeFake) { f.seedForeign() })
	withSpikeEnv(t, &stubMinter{token: spikeTestAccessToken})
	rep, raw, _ := runSpike(t, f)

	for _, req := range f.snapshotRequests() {
		if req.Method == http.MethodGet || (req.Method == http.MethodPost && req.Path == spikeFakeCollection) {
			continue
		}
		if !strings.HasPrefix(path.Base(req.Path), spikeNamePrefix) {
			t.Errorf("mutating %s to non-spike path %s", req.Method, req.Path)
		}
	}
	f.mu.Lock()
	foreignRV := fakeMeta(f.objs[spikeForeignName])["resourceVersion"]
	f.mu.Unlock()
	if foreignRV != "1" {
		t.Error("foreign record was modified")
	}
	for _, leak := range []string{spikeForeignName, "FOREIGN-SECRET-TITLE", "FOREIGN-ANNOTATION", "user:victim", "uid-foreign"} {
		if strings.Contains(raw, leak) {
			t.Errorf("report carries foreign data %q", leak)
		}
	}
	if rep.Findings.ListItemsReturned != 2 || rep.Findings.OnList != "found-via-labelSelector" {
		t.Errorf("findings = %+v", rep.Findings)
	}
}

func TestSpikeRun_CreateCommitsButReturns500(t *testing.T) {
	f := newSpikeFake(t, func(f *spikeFake) { f.createCommitThen500 = true })
	withSpikeEnv(t, &stubMinter{token: spikeTestAccessToken})
	rep, _, _ := runSpike(t, f)
	if !rep.Findings.DependentStepsSkipped || rep.Findings.CreateStatus != 500 {
		t.Errorf("findings = %+v", rep.Findings)
	}
	if cleanupOutcome(rep, "-a") != "deleted" || f.has(rep.Records[0]) {
		t.Errorf("A not cleaned up: %+v", rep.Cleanup)
	}
	if c := cleanupFor(rep, "-a"); c.CreateOutcome != spikeCreateAmbiguous {
		t.Errorf("A create outcome = %q", c.CreateOutcome)
	}
	if rep.Findings.Check8Status != 422 {
		t.Errorf("check 8 must still run: %+v", rep.Findings)
	}
	if n := spikeInvalidations(); n != 1 {
		t.Errorf("completion index invalidated %d times, want 1 (ambiguous create found a record)", n)
	}
}

// A create that answers 409 must never lead to a DELETE, even when the
// existing record looks like this run's in every other respect.
func TestSpikeRun_Create409IsNeverDeleted(t *testing.T) {
	f := newSpikeFake(t, func(f *spikeFake) { f.preexistOnCreate = true })
	withSpikeEnv(t, &stubMinter{token: spikeTestAccessToken})
	rep, _, _ := runSpike(t, f)

	if rep.Findings.CreateStatus != http.StatusConflict || !rep.Findings.DependentStepsSkipped {
		t.Errorf("findings = %+v", rep.Findings)
	}
	c := cleanupFor(rep, "-a")
	if c.Outcome != "refused" || c.CreateOutcome != spikeCreateRejected || !strings.Contains(c.Reason, "409") {
		t.Errorf("cleanup A = %+v", c)
	}
	if !f.has(rep.Records[0]) {
		t.Error("pre-existing record was deleted")
	}
	for _, req := range f.snapshotRequests() {
		if req.Method == http.MethodDelete {
			t.Errorf("DELETE issued: %s", req.Path)
		}
	}
	if n := spikeInvalidations(); n != 0 {
		t.Errorf("completion index invalidated %d times, want 0 (nothing was written)", n)
	}
}

func TestSpikeOwnershipProblem(t *testing.T) {
	const sub = "user:42"
	runStart := time.Date(2026, 10, 6, 12, 0, 0, 0, time.UTC)
	name := spikeNamePrefix + "20261006120000-abcdef-a"
	obj := func(uid, userID, created string, labelled bool) map[string]any {
		labels := map[string]any{}
		if labelled {
			labels[spikeLabelKey] = spikeLabelValue
		}
		return map[string]any{
			"metadata": map[string]any{"name": name, "uid": uid, "creationTimestamp": created, "labels": labels},
			"spec":     map[string]any{"guideSource": spikeGuideSource, "userId": userID},
		}
	}
	fresh := runStart.Format(time.RFC3339)
	cand := func(sent bool, status int, uid string) *spikeCandidate {
		return &spikeCandidate{label: "a", name: name, createSent: sent, createStatus: status, createdUID: uid}
	}
	tests := []struct {
		name string
		c    *spikeCandidate
		obj  map[string]any
		want string // "" = deletable; otherwise a substring of the reason
	}{
		{"created, uid matches", cand(true, 201, "u1"), obj("u1", sub, fresh, true), ""},
		{"created, uid differs", cand(true, 201, "u1"), obj("u2", sub, fresh, true), "uid differs"},
		{"created, not labelled", cand(true, 201, "u1"), obj("u1", sub, fresh, false), "label"},
		{"409 never", cand(true, 409, ""), obj("u1", sub, fresh, true), "409"},
		{"422 never", cand(true, 422, ""), obj("u1", sub, fresh, true), "422"},
		{"403 never", cand(true, 403, ""), obj("u1", sub, fresh, true), "403"},
		{"not sent", cand(false, 0, ""), obj("u1", sub, fresh, true), "never sent"},
		{"5xx, owned, fresh", cand(true, 500, ""), obj("u1", sub, fresh, true), ""},
		{"transport error, owned, fresh", cand(true, 0, ""), obj("u1", sub, fresh, true), ""},
		{"2xx without uid, owned, fresh", cand(true, 201, ""), obj("u1", sub, fresh, true), ""},
		{"5xx, within skew", cand(true, 503, ""), obj("u1", sub, runStart.Add(-4*time.Second).Format(time.RFC3339), true), ""},
		{"5xx, other user", cand(true, 500, ""), obj("u1", "user:7", fresh, true), "spec.userId"},
		{"5xx, too old", cand(true, 500, ""), obj("u1", sub, runStart.Add(-6*time.Second).Format(time.RFC3339), true), "predates"},
		{"5xx, no creationTimestamp", cand(true, 500, ""), obj("u1", sub, "", true), "unparseable"},
		{"5xx, not labelled", cand(true, 500, ""), obj("u1", sub, fresh, false), "label"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := spikeOwnershipProblem(tt.c, tt.obj, sub, runStart)
			if tt.want == "" && got != "" {
				t.Errorf("refused: %q", got)
			}
			if tt.want != "" && !strings.Contains(got, tt.want) {
				t.Errorf("reason = %q, want it to mention %q", got, tt.want)
			}
		})
	}
}

// A transport error's message (here carrying the app URL, the token-exchange
// URL and the bare host) must reach the report without any of them, and
// without the *url.Error wrapper.
func TestSpikeCall_TransportErrorHidesUpstream(t *testing.T) {
	appURL := "https://stack-secret.grafana-dev.net"
	s := &spikeRunner{
		minter: &stubMinter{token: spikeTestAccessToken},
		client: &http.Client{Transport: spikeRoundTripFunc(func(*http.Request) (*http.Response, error) {
			return nil, fmt.Errorf("dial %s: lookup stack-secret.grafana-dev.net: no such host (via %s)", appURL, tokenExchangeURL)
		})},
		logger:     log.DefaultLogger,
		red:        spikeNewRedactor(appURL),
		headerVals: map[string]map[string]bool{},
		rep:        &spikeReport{},
	}
	step, resp, _ := s.call(context.Background(), spikeCall{check: "x", method: http.MethodGet, url: appURL + "/apis/x", want: []int{200}})
	if !resp.sent || resp.status != 0 || step.Verdict != spikeError {
		t.Fatalf("resp = %+v, step = %+v", resp, step)
	}
	if !strings.Contains(step.Error, spikeUpstream) || strings.HasPrefix(step.Error, "Get ") {
		t.Errorf("error = %q", step.Error)
	}
	out := string(spikeJSON(step))
	for _, leak := range []string{appURL, "stack-secret", tokenExchangeURL} {
		if strings.Contains(out, leak) {
			t.Errorf("step leaks %q: %s", leak, out)
		}
	}
	// A transport error is an ambiguous create.
	c := &spikeCandidate{}
	c.noteCreate(resp, nil)
	if c.createOutcome() != spikeCreateAmbiguous {
		t.Errorf("create outcome = %q", c.createOutcome())
	}
}

func TestSpikeRun_PerUserCap(t *testing.T) {
	f := newSpikeFake(t, nil)
	withSpikeEnv(t, &stubMinter{token: spikeTestAccessToken})
	app := newSpikeApp(t)
	runAs := func(sub string) *httptest.ResponseRecorder {
		r, _ := spikeRequest(t, f, http.MethodPost, spikeRunTarget, spikeReqOpts{sub: sub})
		rec := httptest.NewRecorder()
		app.handleSpikeProgressRun(rec, r)
		return rec
	}
	for i := 0; i < spikeRunCapPerUser; i++ {
		if rec := runAs("user:42"); rec.Code != http.StatusOK {
			t.Fatalf("run %d status = %d: %s", i+1, rec.Code, rec.Body.String())
		}
	}
	before := f.apiRequests()
	rec := runAs("user:42")
	var env struct {
		Error string `json:"error"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &env)
	if rec.Code != http.StatusTooManyRequests || env.Error != "spike-run-cap" {
		t.Fatalf("capped run = %d %s", rec.Code, rec.Body.String())
	}
	if f.apiRequests() != before {
		t.Error("capped run made upstream requests")
	}
	if rec := runAs("user:43"); rec.Code != http.StatusOK {
		t.Errorf("another user's run = %d: %s", rec.Code, rec.Body.String())
	}
}

func TestSpikeRun_RefusesWhenCallerHasLeftovers(t *testing.T) {
	f := newSpikeFake(t, func(f *spikeFake) {
		f.seedForeign()
		f.seedOwn(spikeNamePrefix+"old-a", "user:42")
	})
	withSpikeEnv(t, &stubMinter{token: spikeTestAccessToken})
	r, _ := spikeRequest(t, f, http.MethodPost, spikeRunTarget, spikeReqOpts{})
	rec := httptest.NewRecorder()
	newSpikeApp(t).handleSpikeProgressRun(rec, r)

	var body spikeLeftoversResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if rec.Code != http.StatusConflict || body.Error != "spike-leftovers-exist" || body.Truncated ||
		len(body.Leftovers) != 1 || body.Leftovers[0] != spikeNamePrefix+"old-a" {
		t.Fatalf("response = %d %s", rec.Code, rec.Body.String())
	}
	for _, leak := range []string{spikeForeignName, "user:victim", "FOREIGN"} {
		if strings.Contains(rec.Body.String(), leak) {
			t.Errorf("response carries other users' data %q", leak)
		}
	}
	reqs := f.snapshotRequests()
	if len(reqs) != 1 || reqs[0].Method != http.MethodGet || !strings.Contains(reqs[0].RawQuery, "labelSelector=") {
		t.Errorf("expected exactly the filtered pre-check LIST, got %+v", reqs)
	}

	t.Run("list capped", func(t *testing.T) {
		f := newSpikeFake(t, func(f *spikeFake) {
			for i := 0; i < spikeLeftoverListMax+5; i++ {
				f.seedOwn(fmt.Sprintf("%sold-%02d", spikeNamePrefix, i), "user:42")
			}
		})
		r, _ := spikeRequest(t, f, http.MethodPost, spikeRunTarget, spikeReqOpts{})
		rec := httptest.NewRecorder()
		newSpikeApp(t).handleSpikeProgressRun(rec, r)
		var body spikeLeftoversResponse
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		if rec.Code != http.StatusConflict || len(body.Leftovers) != spikeLeftoverListMax || !body.Truncated {
			t.Errorf("response = %d, %d names, truncated=%t", rec.Code, len(body.Leftovers), body.Truncated)
		}
	})

	t.Run("refused attempts do not count toward the cap", func(t *testing.T) {
		leftover := spikeNamePrefix + "old-a"
		f := newSpikeFake(t, func(f *spikeFake) { f.seedOwn(leftover, "user:42") })
		app := newSpikeApp(t)
		attempt := func() *httptest.ResponseRecorder {
			r, _ := spikeRequest(t, f, http.MethodPost, spikeRunTarget, spikeReqOpts{})
			rec := httptest.NewRecorder()
			app.handleSpikeProgressRun(rec, r)
			return rec
		}
		for i := 0; i < spikeRunCapPerUser+2; i++ {
			if rec := attempt(); rec.Code != http.StatusConflict {
				t.Fatalf("attempt %d status = %d, want 409: %s", i+1, rec.Code, rec.Body.String())
			}
		}
		if n := spikeRunCounts[app]["user:42"]; n != 0 {
			t.Errorf("refused attempts counted: %d", n)
		}
		f.mu.Lock()
		delete(f.objs, leftover)
		f.mu.Unlock()
		if rec := attempt(); rec.Code != http.StatusOK {
			t.Fatalf("run after removing leftover = %d: %s", rec.Code, rec.Body.String())
		}
		if n := spikeRunCounts[app]["user:42"]; n != 1 {
			t.Errorf("run count after successful run = %d, want 1", n)
		}
	})

	t.Run("labelled, caller-owned, non-prefixed record is ignored", func(t *testing.T) {
		f := newSpikeFake(t, func(f *spikeFake) { f.seedOwn("completion-mine-not-spike", "user:42") })
		rep, body, _ := runSpike(t, f)
		if pre := stepFor(rep, "check0-leftovers-list"); pre == nil || pre.Note != "callerLeftovers=0" || pre.Verdict == spikeFail {
			t.Errorf("pre-check step = %+v", pre)
		}
		if strings.Contains(body, "completion-mine-not-spike") {
			t.Error("non-prefixed record listed in the report")
		}
		if !f.has("completion-mine-not-spike") {
			t.Error("non-prefixed record was deleted")
		}
	})

	t.Run("more pages: note says detection is partial", func(t *testing.T) {
		f := newSpikeFake(t, func(f *spikeFake) { f.listContinue = "page-2" })
		rep, _, _ := runSpike(t, f)
		if pre := stepFor(rep, "check0-leftovers-list"); pre == nil || !strings.Contains(pre.Note, "detection is partial") {
			t.Errorf("pre-check step = %+v", pre)
		}
	})

	t.Run("pre-check LIST fails: recorded, run continues", func(t *testing.T) {
		f := newSpikeFake(t, func(f *spikeFake) { f.listStatus = http.StatusForbidden })
		rep, _, _ := runSpike(t, f)
		pre := stepFor(rep, "check0-leftovers-list")
		if pre == nil || pre.Status != http.StatusForbidden || pre.Verdict != spikeFail || !strings.Contains(pre.Note, "continuing") {
			t.Errorf("pre-check step = %+v", pre)
		}
		if rep.Findings.CreateStatus != http.StatusCreated || cleanupOutcome(rep, "-a") != "deleted" {
			t.Errorf("run did not continue: %+v %+v", rep.Findings, rep.Cleanup)
		}
	})
}

func TestSpikeRun_DeleteForbiddenIsLeftover(t *testing.T) {
	f := newSpikeFake(t, func(f *spikeFake) { f.deleteStatus = http.StatusForbidden })
	withSpikeEnv(t, &stubMinter{token: spikeTestAccessToken})
	rep, _, _ := runSpike(t, f)
	if cleanupOutcome(rep, "-a") != "leftover" || rep.Findings.DeleteWorks {
		t.Errorf("cleanup = %+v, deleteWorks = %t", rep.Cleanup, rep.Findings.DeleteWorks)
	}
}

// --- Gates, preflight, routing ---------------------------------------------------

func TestSpikeRun_Gates(t *testing.T) {
	noToggle := func(f *spikeFake) map[string]string { return map[string]string{sdkconfig.AppURL: f.server.URL} }
	tests := []struct {
		name     string
		method   string
		target   string
		opts     spikeReqOpts
		cfg      func(*spikeFake) map[string]string
		noMinter bool
		expired  bool
		busy     bool
		capped   bool
		want     int
		wantErr  string
	}{
		{name: "wrong method", method: http.MethodGet, target: spikeRunTarget, want: http.StatusMethodNotAllowed},
		{name: "expired", method: http.MethodPost, target: spikeRunTarget, expired: true, want: http.StatusGone, wantErr: "spike-expired"},
		{name: "no confirm", method: http.MethodPost, target: "/spike/progress/run", want: http.StatusBadRequest},
		{name: "wrong confirm", method: http.MethodPost, target: "/spike/progress/run?confirm=yes", want: http.StatusBadRequest},
		{name: "no identity", method: http.MethodPost, target: spikeRunTarget, opts: spikeReqOpts{noToken: true}, want: http.StatusUnauthorized, wantErr: "unauthenticated"},
		{name: "service account", method: http.MethodPost, target: spikeRunTarget, opts: spikeReqOpts{sub: "service-account:9"}, want: http.StatusForbidden},
		{name: "editor", method: http.MethodPost, target: spikeRunTarget, opts: spikeReqOpts{role: "Editor"}, want: http.StatusForbidden},
		{name: "admin", method: http.MethodPost, target: spikeRunTarget, opts: spikeReqOpts{role: "Admin"}, want: http.StatusForbidden},
		{name: "toggle off", method: http.MethodPost, target: spikeRunTarget, cfg: noToggle, want: http.StatusNotFound, wantErr: reasonBackendUnavailable},
		{name: "no exchanger", method: http.MethodPost, target: spikeRunTarget, noMinter: true, want: http.StatusNotFound, wantErr: reasonOBOUnavailable},
		{name: "busy", method: http.MethodPost, target: spikeRunTarget, busy: true, want: http.StatusConflict, wantErr: "spike-run-in-progress"},
		{name: "run cap", method: http.MethodPost, target: spikeRunTarget, capped: true, want: http.StatusTooManyRequests, wantErr: "spike-run-cap"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := newSpikeFake(t, nil)
			if tt.noMinter {
				withSpikeEnv(t, nil)
			} else {
				withSpikeEnv(t, &stubMinter{token: spikeTestAccessToken})
			}
			if tt.expired {
				withFrozenTime(t, spikeProgressExpiry)
			}
			opts := tt.opts
			if tt.cfg != nil {
				opts.cfg = tt.cfg(f)
			}
			r, _ := spikeRequest(t, f, tt.method, tt.target, opts)
			if tt.busy {
				spikeProgressMu.Lock()
				defer spikeProgressMu.Unlock()
			}
			app := newSpikeApp(t)
			if tt.capped {
				spikeRunCounts[app] = map[string]int{"user:42": spikeRunCapPerUser}
			}
			rec := httptest.NewRecorder()
			app.handleSpikeProgressRun(rec, r)
			if rec.Code != tt.want {
				t.Fatalf("status = %d, want %d (body %s)", rec.Code, tt.want, rec.Body.String())
			}
			if tt.wantErr != "" {
				var env struct {
					Error string `json:"error"`
				}
				_ = json.Unmarshal(rec.Body.Bytes(), &env)
				if env.Error != tt.wantErr {
					t.Errorf("error = %q, want %q", env.Error, tt.wantErr)
				}
			}
			if n := f.apiRequests(); n != 0 {
				t.Errorf("gate made %d upstream requests", n)
			}
		})
	}
}

func TestSpikePreflight(t *testing.T) {
	f := newSpikeFake(t, nil)
	minter := &stubMinter{token: spikeTestAccessToken}
	withSpikeEnv(t, minter)

	r, idToken := spikeRequest(t, f, http.MethodGet, "/spike/progress", spikeReqOpts{})
	rec := httptest.NewRecorder()
	newTestApp(t).handleSpikeProgressPreflight(rec, r)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", rec.Code, rec.Body.String())
	}
	var rep spikePreflightReport
	if err := json.Unmarshal(rec.Body.Bytes(), &rep); err != nil {
		t.Fatal(err)
	}
	id := rep.Identity
	if id.Status != "verified" || id.Sub != "user:42" || id.Login != "viewer1" || id.Name != "Vera Viewer" || id.Role != "Viewer" || !id.IDTokenForwarded || id.OrgID != 7 {
		t.Errorf("identity = %+v", id)
	}
	if !rep.RoleIsViewer || !rep.SubIsUser || !rep.Config.Available || !rep.Mint.Attempted || !rep.Mint.OK || !rep.Ready || rep.MinterSource != "override" || rep.OBOProvisioned {
		t.Errorf("preflight = %+v", rep)
	}
	if n := f.apiRequests(); n != 0 {
		t.Errorf("preflight made %d /apis requests", n)
	}
	if body := rec.Body.String(); strings.Contains(body, spikeTestAccessToken) || strings.Contains(body, idToken) {
		t.Error("preflight leaks a token")
	}

	t.Run("wrong method", func(t *testing.T) {
		r, _ := spikeRequest(t, f, http.MethodPost, "/spike/progress", spikeReqOpts{})
		rec := httptest.NewRecorder()
		newTestApp(t).handleSpikeProgressPreflight(rec, r)
		if rec.Code != http.StatusMethodNotAllowed {
			t.Errorf("status = %d", rec.Code)
		}
	})
}

func TestSpikeRoutes_MountedViaRegisterRoutes(t *testing.T) {
	withSpikeEnv(t, nil)
	mux := http.NewServeMux()
	newTestApp(t).registerRoutes(mux)
	for _, tc := range []struct {
		method, target string
		want           int
	}{
		{http.MethodPut, "/spike/progress", http.StatusMethodNotAllowed},
		{http.MethodGet, "/spike/progress/run", http.StatusMethodNotAllowed},
		{http.MethodGet, "/spike/progress", http.StatusOK},
	} {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(tc.method, tc.target, nil))
		if rec.Code != tc.want {
			t.Errorf("%s %s = %d, want %d (handler not reached?)", tc.method, tc.target, rec.Code, tc.want)
		}
	}
}
