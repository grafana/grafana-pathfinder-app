package plugin

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

// fakeAttemptStore is an in-memory completionRecordUpdater with Kubernetes
// optimistic concurrency: every write bumps resourceVersion, and a PUT at a
// stale one is a 409. Errors can be injected per operation.
type fakeAttemptStore struct {
	mu      sync.Mutex
	objects map[string]map[string]any
	rv      int

	createErr   error
	replaceErrs []error // consumed one per Replace call, before the write
	getErr      error

	creates, replaces, gets int
	lastReplace             map[string]any
}

func newFakeAttemptStore() *fakeAttemptStore {
	return &fakeAttemptStore{objects: map[string]map[string]any{}}
}

func (f *fakeAttemptStore) Create(_ context.Context, _ string, obj completionRecordObject) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.creates++
	if f.createErr != nil {
		return f.createErr
	}
	if _, exists := f.objects[obj.Metadata.Name]; exists {
		return &appPlatformUpstreamError{status: http.StatusConflict, msg: "exists"}
	}
	raw := toRawObject(obj)
	f.rv++
	raw["metadata"].(map[string]any)["resourceVersion"] = strconv.Itoa(f.rv)
	f.objects[obj.Metadata.Name] = raw
	return nil
}

func (f *fakeAttemptStore) Get(_ context.Context, _ string, name string) (*storedCompletionRecord, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.gets++
	if f.getErr != nil {
		return nil, f.getErr
	}
	raw, ok := f.objects[name]
	if !ok {
		return nil, nil
	}
	body, _ := json.Marshal(raw)
	return decodeStoredCompletionRecord(body)
}

func (f *fakeAttemptStore) Replace(_ context.Context, _ string, name string, obj map[string]any) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.replaces++
	f.lastReplace = obj
	if len(f.replaceErrs) > 0 {
		err := f.replaceErrs[0]
		f.replaceErrs = f.replaceErrs[1:]
		if err != nil {
			return err
		}
	}
	cur := f.objects[name]
	if cur == nil {
		return &appPlatformUpstreamError{status: http.StatusNotFound, msg: "gone"}
	}
	gotRV := obj["metadata"].(map[string]any)["resourceVersion"]
	if gotRV != cur["metadata"].(map[string]any)["resourceVersion"] {
		return &appPlatformUpstreamError{status: http.StatusConflict, msg: "stale"}
	}
	body, _ := json.Marshal(obj)
	var stored map[string]any
	_ = json.Unmarshal(body, &stored)
	f.rv++
	stored["metadata"].(map[string]any)["resourceVersion"] = strconv.Itoa(f.rv)
	f.objects[name] = stored
	return nil
}

func (f *fakeAttemptStore) spec(t *testing.T, name string) map[string]any {
	t.Helper()
	f.mu.Lock()
	defer f.mu.Unlock()
	raw, ok := f.objects[name]
	if !ok {
		t.Fatalf("no stored record %q", name)
	}
	return raw["spec"].(map[string]any)
}

func toRawObject(obj completionRecordObject) map[string]any {
	body, _ := json.Marshal(obj)
	var raw map[string]any
	_ = json.Unmarshal(body, &raw)
	return raw
}

func attemptBody(percent int, attemptID string) map[string]any {
	b := validWriteBody()
	b["completionPercent"] = percent
	b["attemptId"] = attemptID
	b["idempotencyKey"] = attemptID + "-" + strconv.Itoa(percent)
	if percent == 100 {
		b["source"] = "manual"
		b["durationMs"] = 90_000
	}
	return b
}

const testAttemptUser = "user:abc"

func doAttemptWrite(t *testing.T, store *fakeAttemptStore, percent int, attemptID string) *httptest.ResponseRecorder {
	t.Helper()
	withCreator(t, store)
	return doWrite(t, nil, writeRequest(t, testAttemptUser, attemptBody(percent, attemptID), testGrafanaConfig()))
}

func TestAttemptWrite_FirstPartialCreatesWithoutCompletionFields(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	store := newFakeAttemptStore()

	rec := doAttemptWrite(t, store, 40, "att-1")

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (%s)", rec.Code, rec.Body.String())
	}
	name := completionAttemptRecordName(testAttemptUser, "att-1")
	spec := store.spec(t, name)
	if _, has := spec["completedAt"]; has {
		t.Errorf("a partial must not carry completedAt, got %v", spec["completedAt"])
	}
	if spec["completionPercent"] != float64(40) || spec["source"] != "objectives" || spec["durationSeconds"] != float64(0) {
		t.Errorf("partial spec = %+v", spec)
	}
	if spec["userId"] != testAttemptUser {
		t.Errorf("userId = %v, want the verified caller", spec["userId"])
	}
}

func TestAttemptWrite_RaisesPercentInPlaceWithResourceVersion(t *testing.T) {
	advance := withFrozenTime(t, time.Unix(1_700_000_000, 0))
	store := newFakeAttemptStore()
	doAttemptWrite(t, store, 40, "att-1")
	advance(time.Minute)

	rec := doAttemptWrite(t, store, 70, "att-1")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	if store.creates != 1 || store.replaces != 1 {
		t.Fatalf("creates=%d replaces=%d, want 1 and 1", store.creates, store.replaces)
	}
	if rv := store.lastReplace["metadata"].(map[string]any)["resourceVersion"]; rv != "1" {
		t.Errorf("PUT carried resourceVersion %v, want the one read (1)", rv)
	}
	spec := store.spec(t, completionAttemptRecordName(testAttemptUser, "att-1"))
	if spec["completionPercent"] != float64(70) {
		t.Errorf("percent = %v, want 70", spec["completionPercent"])
	}
	if spec["recordedAt"] != timeNow().UTC().Format(time.RFC3339) {
		t.Errorf("recordedAt = %v, want re-stamped", spec["recordedAt"])
	}
	if _, has := spec["completedAt"]; has {
		t.Errorf("a partial update must not set completedAt")
	}
}

func TestAttemptWrite_LowerOrEqualPercentIsNoOp(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	store := newFakeAttemptStore()
	doAttemptWrite(t, store, 60, "att-1")

	for _, p := range []int{60, 40} {
		rec := doAttemptWrite(t, store, p, "att-1")
		if rec.Code != http.StatusOK {
			t.Fatalf("percent %d: status = %d, want 200", p, rec.Code)
		}
	}
	if store.replaces != 0 {
		t.Fatalf("replaces = %d, want 0: progress must never go down", store.replaces)
	}
	if got := store.spec(t, completionAttemptRecordName(testAttemptUser, "att-1"))["completionPercent"]; got != float64(60) {
		t.Errorf("percent = %v, want 60", got)
	}
}

func TestAttemptWrite_ReachingOneHundredSetsCompletionFields(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	store := newFakeAttemptStore()
	doAttemptWrite(t, store, 60, "att-1")

	rec := doAttemptWrite(t, store, 100, "att-1")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d (%s)", rec.Code, rec.Body.String())
	}
	spec := store.spec(t, completionAttemptRecordName(testAttemptUser, "att-1"))
	if spec["completedAt"] == nil || spec["completedAt"] == "" {
		t.Errorf("completedAt not set at 100: %+v", spec)
	}
	if spec["source"] != "manual" || spec["durationSeconds"] != float64(90) {
		t.Errorf("source/duration = %v/%v, want manual/90", spec["source"], spec["durationSeconds"])
	}
	// A replay of the completion is a no-op.
	if rec := doAttemptWrite(t, store, 100, "att-1"); rec.Code != http.StatusOK || store.replaces != 1 {
		t.Fatalf("replayed 100: status=%d replaces=%d", rec.Code, store.replaces)
	}
}

func TestAttemptWrite_StraightToOneHundredCreatesACompletedRecord(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	store := newFakeAttemptStore()

	rec := doAttemptWrite(t, store, 100, "att-1")

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d", rec.Code)
	}
	spec := store.spec(t, completionAttemptRecordName(testAttemptUser, "att-1"))
	if spec["completedAt"] == nil || spec["source"] != "manual" {
		t.Errorf("spec = %+v", spec)
	}
}

func TestAttemptWrite_CreateRaceReadsAgainAndUpdates(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	store := newFakeAttemptStore()
	name := completionAttemptRecordName(testAttemptUser, "att-1")
	// Another tab created the record between our GET and our create.
	racing := &raceOnFirstGet{fakeAttemptStore: store, seed: func() {
		_ = store.Create(context.Background(), testNamespace, completionRecordObject{
			APIVersion: completionRecordsGroupVersion, Kind: "CompletionRecord",
			Metadata: completionRecordObjectMeta{Name: name, Namespace: testNamespace},
			Spec:     completionRecordWriteSpec{UserID: testAttemptUser, GuideSource: "bundled", GuideID: "first-dashboard", CompletionPercent: 20},
		})
	}}
	withCreator(t, racing)

	rec := doWrite(t, nil, writeRequest(t, testAttemptUser, attemptBody(50, "att-1"), testGrafanaConfig()))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 after the race (%s)", rec.Code, rec.Body.String())
	}
	if got := store.spec(t, name)["completionPercent"]; got != float64(50) {
		t.Errorf("percent = %v, want 50", got)
	}
}

// raceOnFirstGet reports "absent" on the first GET, then seeds the record so
// the following create collides.
type raceOnFirstGet struct {
	*fakeAttemptStore
	seed func()
	done bool
}

func (r *raceOnFirstGet) Get(ctx context.Context, ns, name string) (*storedCompletionRecord, error) {
	if !r.done {
		r.done = true
		r.seed()
		return nil, nil
	}
	return r.fakeAttemptStore.Get(ctx, ns, name)
}

func TestAttemptWrite_PersistentConflictIsRetryable503(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	store := newFakeAttemptStore()
	doAttemptWrite(t, store, 20, "att-1")
	conflict := &appPlatformUpstreamError{status: http.StatusConflict, msg: "stale"}
	store.replaceErrs = []error{conflict, conflict, conflict}

	rec := doAttemptWrite(t, store, 50, "att-1")

	if rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), reasonWriteContended) {
		t.Fatalf("status = %d body = %s, want 503 %s", rec.Code, rec.Body.String(), reasonWriteContended)
	}
	if rec.Header().Get("Retry-After") == "" {
		t.Error("missing Retry-After")
	}
	if store.replaces != completionAttemptMaxTries {
		t.Errorf("replaces = %d, want %d tries", store.replaces, completionAttemptMaxTries)
	}
}

func TestAttemptWrite_OneConflictThenSuccess(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	store := newFakeAttemptStore()
	doAttemptWrite(t, store, 20, "att-1")
	store.replaceErrs = []error{&appPlatformUpstreamError{status: http.StatusConflict, msg: "stale"}}

	if rec := doAttemptWrite(t, store, 50, "att-1"); rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 after one retry", rec.Code)
	}
	if store.gets != 3 { // first write's GET, then GET, retry GET
		t.Errorf("gets = %d, want 3", store.gets)
	}
}

func TestAttemptWrite_StoredRecordForAnotherUserOrGuideIsConflict(t *testing.T) {
	for _, tc := range []struct {
		name   string
		mutate func(spec *completionRecordWriteSpec)
	}{
		{"other user", func(s *completionRecordWriteSpec) { s.UserID = "user:other" }},
		{"other guide", func(s *completionRecordWriteSpec) { s.GuideID = "other-guide" }},
		{"other source", func(s *completionRecordWriteSpec) { s.GuideSource = "app-platform" }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			withFrozenTime(t, time.Unix(1_700_000_000, 0))
			store := newFakeAttemptStore()
			name := completionAttemptRecordName(testAttemptUser, "att-1")
			spec := completionRecordWriteSpec{UserID: testAttemptUser, GuideSource: "bundled", GuideID: "first-dashboard", CompletionPercent: 10}
			tc.mutate(&spec)
			_ = store.Create(context.Background(), testNamespace, completionRecordObject{Metadata: completionRecordObjectMeta{Name: name}, Spec: spec})

			rec := doAttemptWrite(t, store, 50, "att-1")

			if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), reasonAttemptConflict) {
				t.Fatalf("status = %d body = %s, want 409 %s", rec.Code, rec.Body.String(), reasonAttemptConflict)
			}
			if store.replaces != 0 {
				t.Errorf("must not write over a mismatched record")
			}
		})
	}
}

func TestAttemptWrite_OldSchemaRejectingAPartialIsRetryable(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	invalid := &appPlatformUpstreamError{status: http.StatusUnprocessableEntity, body: []byte(`{"kind":"Status","reason":"Invalid","details":{"causes":[{"field":"spec.completedAt","reason":"FieldValueRequired"}]}}`)}

	store := newFakeAttemptStore()
	store.createErr = invalid
	rec := doAttemptWrite(t, store, 40, "att-1")
	if rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), reasonSchemaNotReady) {
		t.Fatalf("partial: status = %d body = %s, want 503 %s", rec.Code, rec.Body.String(), reasonSchemaNotReady)
	}

	// A 422 on a completion is not a schema skew: it stays terminal.
	store = newFakeAttemptStore()
	store.createErr = invalid
	if rec := doAttemptWrite(t, store, 100, "att-2"); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("100%%: status = %d, want the terminal 422", rec.Code)
	}
}

func TestAttemptWrite_OnlyMissingCompletedAtIsSchemaNotReady(t *testing.T) {
	for _, body := range []string{
		`{"kind":"Status","reason":"Invalid","details":{"causes":[{"field":"spec.guideId","reason":"FieldValueRequired"}]}}`,
		`{"kind":"Status","reason":"Invalid","details":{"causes":[{"field":"spec.completedAt","reason":"FieldValueInvalid"}]}}`,
		`{"kind":"Status","reason":"Invalid","details":{"causes":[{"field":"spec.completedAt","reason":"FieldValueRequired"},{"field":"spec.guideId","reason":"FieldValueInvalid"}]}}`,
		`{"kind":"Status","reason":"Invalid"}`, `broken`,
	} {
		t.Run(body, func(t *testing.T) {
			withFrozenTime(t, time.Unix(1_700_000_000, 0))
			store := newFakeAttemptStore()
			store.createErr = &appPlatformUpstreamError{status: http.StatusUnprocessableEntity, body: []byte(body)}
			if got := doAttemptWrite(t, store, 40, "att-1"); got.Code != http.StatusUnprocessableEntity {
				t.Fatalf("status=%d, want 422", got.Code)
			}
		})
	}
}

type deleteBeforeReplace struct{ *fakeAttemptStore }

func (s *deleteBeforeReplace) Replace(ctx context.Context, ns, name string, obj map[string]any) error {
	s.mu.Lock()
	delete(s.objects, name)
	s.mu.Unlock()
	return &appPlatformUpstreamError{status: http.StatusNotFound, body: []byte(`{"kind":"Status","reason":"NotFound"}`)}
}

func TestAttemptWrite_RecreatesAfterConcurrentDeletion(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	store := newFakeAttemptStore()
	doAttemptWrite(t, store, 20, "att-1")
	withCreator(t, &deleteBeforeReplace{store})
	got := doWrite(t, nil, writeRequest(t, testAttemptUser, attemptBody(60, "att-1"), testGrafanaConfig()))
	if got.Code != http.StatusCreated || store.creates != 2 {
		t.Fatalf("status=%d creates=%d", got.Code, store.creates)
	}
	if got := store.spec(t, completionAttemptRecordName(testAttemptUser, "att-1"))["completionPercent"]; got != float64(60) {
		t.Fatalf("percent=%v", got)
	}
}

func TestAttemptWrite_ReplaceStructural404RemainsTerminal(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	store := newFakeAttemptStore()
	doAttemptWrite(t, store, 20, "att-1")
	store.replaceErrs = []error{&appPlatformUpstreamError{status: http.StatusNotFound, body: []byte("route missing")}}
	if got := doAttemptWrite(t, store, 60, "att-1"); got.Code != http.StatusNotFound {
		t.Fatalf("status=%d", got.Code)
	}
	if store.replaces != 1 {
		t.Fatalf("replaces=%d", store.replaces)
	}
}

func TestAttemptRetryReturnsStoredCompletion(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	store := newFakeAttemptStore()
	doAttemptWrite(t, store, 100, "att-1")
	name := completionAttemptRecordName(testAttemptUser, "att-1")
	stored, err := store.Get(context.Background(), testNamespace, name)
	if err != nil {
		t.Fatal(err)
	}
	incoming := stored.Spec
	incoming.CompletedAt = "2026-01-01T00:00:00Z"
	incoming.Source = "objectives"
	outcome, persisted, err := upsertCompletionAttempt(httptest.NewRequest(http.MethodPost, "/", nil), store, testNamespace, name, incoming)
	if err != nil || outcome != attemptUnchanged || persisted.CompletedAt != stored.Spec.CompletedAt || persisted.Source != "manual" {
		t.Fatalf("outcome=%v persisted=%+v err=%v", outcome, persisted, err)
	}
}

func TestAttemptWrite_UnchangedCompletionRepairsAssignmentsAndCache(t *testing.T) {
	path := pathWithGuides(t)
	target := asg("user:1", path.ID, "", "onboarding", "2026-09-01T00:00:00Z")
	target.Name = "assignment-1"
	target.ResourceVersion = "42"
	patched := make(chan bool, 1)
	lister := singlePageAssignmentLister(target)
	lister.updateStatus = func(_ context.Context, _, _, _ string, satisfied bool) error {
		patched <- satisfied
		return nil
	}
	withAssignmentLister(t, lister)
	done := completionsFor(path, "2026-09-14T15:00:00Z")
	withLister(t, singlePageLister(done[:len(done)-1]...))
	just := done[len(done)-1]
	store := newFakeAttemptStore()
	name := completionAttemptRecordName("user:1", "att-1")
	spec := completionRecordWriteSpec{UserID: "user:1", GuideID: just.GuideID, GuideSource: just.GuideSource,
		CompletedAt: just.CompletedAt, CompletionPercent: 100, Source: "manual"}
	if err := store.Create(context.Background(), testNamespace, completionRecordObject{Metadata: completionRecordObjectMeta{Name: name}, Spec: spec}); err != nil {
		t.Fatal(err)
	}
	completionCacheMu.Lock()
	completionCacheInit()
	generation := completionGenerations[testNamespace]
	completionCacheMu.Unlock()
	// A replay's timestamp must not replace the stored completion used for assignment matching.
	spec.CompletedAt = "2020-01-01T00:00:00Z"
	w := httptest.NewRecorder()
	newTestApp(t).handleCompletionAttemptWrite(w, completionRequest(t, "/completion-records", "user:1"), store, testNamespace, "user:1", "att-1", spec)
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d", w.Code)
	}
	completionCacheMu.Lock()
	invalidated := completionGenerations[testNamespace] > generation
	completionCacheMu.Unlock()
	if !invalidated {
		t.Fatal("unchanged completion did not invalidate cache")
	}
	select {
	case satisfied := <-patched:
		if !satisfied {
			t.Fatal("assignment not satisfied")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("unchanged completion did not repair assignment")
	}
}

func TestAttemptWrite_StructuralUpstreamErrorsPassThrough(t *testing.T) {
	for _, status := range []int{http.StatusNotFound, http.StatusForbidden, http.StatusTooManyRequests} {
		t.Run(strconv.Itoa(status), func(t *testing.T) {
			withFrozenTime(t, time.Unix(1_700_000_000, 0))
			store := newFakeAttemptStore()
			store.getErr = &appPlatformUpstreamError{status: status, msg: "upstream"}
			if rec := doAttemptWrite(t, store, 40, "att-1"); rec.Code != status {
				t.Fatalf("status = %d, want %d passed through", rec.Code, status)
			}
		})
	}
}

func TestAttemptWrite_LegacyBodyStillCreatesOnce(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	store := newFakeAttemptStore()
	withCreator(t, store)

	rec := doWrite(t, nil, writeRequest(t, testAttemptUser, validWriteBody(), testGrafanaConfig()))

	if rec.Code != http.StatusCreated || store.creates != 1 || store.gets != 0 || store.replaces != 0 {
		t.Fatalf("status=%d creates=%d gets=%d replaces=%d, want one plain create", rec.Code, store.creates, store.gets, store.replaces)
	}
	if _, ok := store.objects[completionRecordName(testAttemptUser, "evt-default")]; !ok {
		t.Fatal("legacy record not under the legacy name")
	}
}

func TestAttemptRecordName_DisjointFromLegacyNames(t *testing.T) {
	if completionAttemptRecordName("user:1", "k") == completionRecordName("user:1", "k") {
		t.Fatal("attempt and legacy names must differ for the same key")
	}
	if completionAttemptRecordName("user:1", "k") == completionAttemptRecordName("user:2", "k") {
		t.Fatal("attempt names must be scoped to the user")
	}
}

func TestAttemptWrite_InvalidAttemptIDIsRejected(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	withCreator(t, newFakeAttemptStore())
	for _, id := range []string{" padded ", strings.Repeat("a", completionMaxIDLen+1), "with\ncontrol"} {
		rec := doWrite(t, nil, writeRequest(t, testAttemptUser, attemptBody(40, id), testGrafanaConfig()))
		if rec.Code != http.StatusBadRequest {
			t.Errorf("attemptId %q: status = %d, want 400", id, rec.Code)
		}
	}
}

// --- HTTP client: GET classification, one token, PUT body -------------------

type countingMinter struct {
	mu sync.Mutex
	n  int
}

func (m *countingMinter) Mint(context.Context, string, string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.n++
	return "tok-" + strconv.Itoa(m.n), nil
}

func TestCompletionHTTPClient_GetClassifiesNotFound(t *testing.T) {
	for _, tc := range []struct {
		name        string
		contentType string
		body        string
		wantAbsent  bool
	}{
		{"NotFound Status", "application/json", `{"kind":"Status","apiVersion":"v1","status":"Failure","reason":"NotFound","code":404}`, true},
		{"structural plain 404", "text/plain", "404 page not found", false},
		{"Status without NotFound", "application/json", `{"kind":"Status","reason":"Gone","code":404}`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", tc.contentType)
				w.WriteHeader(http.StatusNotFound)
				_, _ = io.WriteString(w, tc.body)
			}))
			defer srv.Close()
			c := newCompletionHTTPClient(srv.URL, &countingMinter{}, "id", log.DefaultLogger)

			got, err := c.Get(context.Background(), testNamespace, "completion-x")

			if tc.wantAbsent {
				if err != nil || got != nil {
					t.Fatalf("got (%v, %v), want (nil, nil)", got, err)
				}
				return
			}
			if status, ok := upstreamStatusOf(err); !ok || status != http.StatusNotFound {
				t.Fatalf("err = %v, want a structural 404 error", err)
			}
		})
	}
}

func TestCompletionHTTPClient_UpsertSharesOneTokenAndStripsManagedFields(t *testing.T) {
	var gotTokens []string
	var putBody map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotTokens = append(gotTokens, r.Header.Get("X-Access-Token"))
		switch r.Method {
		case http.MethodGet:
			_, _ = io.WriteString(w, `{"apiVersion":"pathfinderbackend.ext.grafana.app/v1alpha1","kind":"CompletionRecord",
				"metadata":{"name":"completion-x","resourceVersion":"2107502075172921344","managedFields":[{"manager":"x"}],"annotations":{"keep":"me"}},
				"spec":{"userId":"user:abc","guideSource":"bundled","guideId":"g","completionPercent":40,"orgId":9007199254740993,"futureField":"kept"}}`)
		case http.MethodPut:
			if !strings.HasSuffix(r.URL.Path, "/completionrecords/completion-x") {
				t.Errorf("PUT path = %s", r.URL.Path)
			}
			dec := json.NewDecoder(r.Body)
			dec.UseNumber()
			_ = dec.Decode(&putBody)
			w.WriteHeader(http.StatusOK)
		}
	}))
	defer srv.Close()
	minter := &countingMinter{}
	c := newCompletionHTTPClient(srv.URL, minter, "id", log.DefaultLogger)

	stored, err := c.Get(context.Background(), testNamespace, "completion-x")
	if err != nil || stored == nil {
		t.Fatalf("get: %v", err)
	}
	if stored.Spec.CompletionPercent != 40 || stored.Spec.UserID != "user:abc" {
		t.Fatalf("decoded spec = %+v", stored.Spec)
	}
	if err := c.Replace(context.Background(), testNamespace, "completion-x", mergeAttemptUpdate(stored, completionRecordWriteSpec{CompletionPercent: 70})); err != nil {
		t.Fatalf("replace: %v", err)
	}

	if minter.n != 1 || len(gotTokens) != 2 || gotTokens[0] != gotTokens[1] {
		t.Fatalf("mints=%d tokens=%v, want one token shared by GET and PUT", minter.n, gotTokens)
	}
	meta := putBody["metadata"].(map[string]any)
	if _, has := meta["managedFields"]; has {
		t.Error("PUT must not echo managedFields")
	}
	if meta["resourceVersion"] != "2107502075172921344" || meta["annotations"].(map[string]any)["keep"] != "me" {
		t.Errorf("metadata not preserved: %+v", meta)
	}
	spec := putBody["spec"].(map[string]any)
	if spec["orgId"] != json.Number("9007199254740993") || spec["futureField"] != "kept" {
		t.Errorf("unknown or large fields not preserved: orgId=%v futureField=%v", spec["orgId"], spec["futureField"])
	}
	if spec["completionPercent"] != json.Number("70") {
		t.Errorf("percent = %v", spec["completionPercent"])
	}
}

// --- Read path: annotations, collation, inProgress --------------------------

func TestCompletionList_LastUpdatedPrefersAnnotation(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, `{"metadata":{},"items":[
			{"metadata":{"name":"a","annotations":{"grafana.app/updatedTimestamp":"2026-10-06T16:03:49Z"}},"spec":{"userId":"u","recordedAt":"2026-10-06T16:00:00Z"}},
			{"metadata":{"name":"b"},"spec":{"userId":"u","recordedAt":"2026-10-06T16:00:00Z"}},
			{"metadata":{"name":"c","annotations":{"grafana.app/updatedTimestamp":"garbage"}},"spec":{"userId":"u","recordedAt":"2026-10-06T15:00:00Z"}}
		]}`)
	}))
	defer srv.Close()
	c := newCompletionHTTPClient(srv.URL, &countingMinter{}, "id", log.DefaultLogger)

	page, err := c.ListPage(context.Background(), testNamespace, "")
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"2026-10-06T16:03:49Z", "2026-10-06T16:00:00Z", "2026-10-06T15:00:00Z"}
	for i, r := range page.Records {
		if r.LastUpdatedAt != want[i] {
			t.Errorf("record %d lastUpdatedAt = %q, want %q", i, r.LastUpdatedAt, want[i])
		}
	}
}

func partialRec(guideID string, percent int64, updated string) completionRecordSpec {
	r := rec("user:1", "bundled", guideID, guideID, "interactive", "", "objectives", "", percent)
	r.LastUpdatedAt = updated
	return r
}

func doneRec(guideID, completedAt string) completionRecordSpec {
	r := rec("user:1", "bundled", guideID, guideID, "interactive", "", "objectives", completedAt, 100)
	r.LastUpdatedAt = completedAt
	return r
}

func TestCollation_PartialsAreNotCompletions(t *testing.T) {
	byUser, inProgress := collateCompletions([]completionRecordSpec{
		doneRec("g", "2026-10-01T10:00:00Z"),
		partialRec("g", 40, "2026-09-30T10:00:00Z"), // older than the completion: hidden
		partialRec("h", 30, "2026-10-02T10:00:00Z"), // never completed: shown
	})

	if len(byUser["user:1"]) != 1 || byUser["user:1"][0].GuideID != "g" || byUser["user:1"][0].Count != 1 {
		t.Fatalf("completions = %+v, want g counted once", byUser["user:1"])
	}
	got := inProgress["user:1"]
	if len(got) != 1 || got[0].GuideID != "h" || got[0].CompletionPercent != 30 {
		t.Fatalf("inProgress = %+v, want only h", got)
	}
}

func TestCollation_PartialNewerThanCompletionShows(t *testing.T) {
	_, inProgress := collateCompletions([]completionRecordSpec{
		doneRec("g", "2026-10-01T10:00:00Z"),
		partialRec("g", 20, "2026-10-03T10:00:00Z"),
		partialRec("g", 60, "2026-10-05T10:00:00Z"), // latest partial wins
	})
	got := inProgress["user:1"]
	if len(got) != 1 || got[0].CompletionPercent != 60 || got[0].LastUpdatedAt != "2026-10-05T10:00:00Z" {
		t.Fatalf("inProgress = %+v, want the latest partial (60)", got)
	}
}

func TestCollation_AmbiguousPartialTimeRemainsHidden(t *testing.T) {
	for _, updated := range []string{"2026-10-01T10:00:00Z", "invalid", ""} {
		_, inProgress := collateCompletions([]completionRecordSpec{
			doneRec("g", "2026-10-01T10:00:00Z"), partialRec("g", 40, updated),
		})
		if len(inProgress["user:1"]) != 0 {
			t.Fatalf("updated=%q: %+v", updated, inProgress)
		}
	}
}

func TestCollation_OnlyPartialsGivesNoCompletionsEntry(t *testing.T) {
	byUser, inProgress := collateCompletions([]completionRecordSpec{partialRec("g", 20, "2026-10-03T10:00:00Z")})
	if len(byUser["user:1"]) != 0 || len(inProgress["user:1"]) != 1 {
		t.Fatalf("byUser=%+v inProgress=%+v", byUser, inProgress)
	}
}

func TestMyCompletions_InProgressAlwaysPresent(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	withLister(t, singlePageLister(doneRec("g", "2026-10-01T10:00:00Z")))

	_, body := doMyCompletions(t, "/completion-records/my", "user:1")

	if body.InProgress == nil {
		t.Fatal("inProgress must be [] not null")
	}
	if !body.Capability.ProgressRecords {
		t.Error("capability.progressRecords must be true when available")
	}
}
