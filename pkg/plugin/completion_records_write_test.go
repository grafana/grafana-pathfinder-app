package plugin

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	sdkconfig "github.com/grafana/grafana-plugin-sdk-go/config"
)

const testOrgID = int64(7)

// fakeCreator is an injectable completionRecordCreator. It captures the last
// object it was asked to create and returns a configurable error.
type fakeCreator struct {
	err  error
	last *completionRecordObject
	n    int
}

func (f *fakeCreator) Create(_ context.Context, _ string, obj completionRecordObject) error {
	f.n++
	captured := obj
	f.last = &captured
	return f.err
}

func withCreator(t *testing.T, c completionRecordCreator) {
	t.Helper()
	prev := completionCreatorOverride
	completionCreatorOverride = c
	t.Cleanup(func() { completionCreatorOverride = prev })
}

// validWriteBody is a well-formed client fact (all CRD value domains satisfied).
func validWriteBody() map[string]any {
	return map[string]any{
		"guideSource":       "bundled",
		"guideId":           "first-dashboard",
		"guideTitle":        "First dashboard",
		"guideCategory":     "interactive",
		"pathId":            "",
		"completionPercent": 100,
		"source":            "objectives",
		"completedAt":       timeNow().UTC().Format(time.RFC3339),
		"platform":          "cloud",
	}
}

func writeRequest(t *testing.T, sub string, body map[string]any, cfg map[string]string) *http.Request {
	t.Helper()
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal body: %v", err)
	}
	r, _ := http.NewRequest(http.MethodPost, "/completion-records", bytes.NewReader(raw))
	if sub != "" {
		r.Header.Set(backend.GrafanaUserSignInTokenHeaderName, makeIDToken(t, sub, timeNow().Add(time.Hour).Unix()))
	}
	ctx := backend.WithPluginContext(r.Context(), backend.PluginContext{Namespace: testNamespace, OrgID: testOrgID})
	ctx = sdkconfig.WithGrafanaConfig(ctx, sdkconfig.NewGrafanaCfg(cfg))
	return r.WithContext(ctx)
}

func doWrite(t *testing.T, app *App, r *http.Request) *httptest.ResponseRecorder {
	t.Helper()
	if app == nil {
		app = newTestApp(t)
	}
	rec := httptest.NewRecorder()
	app.handleCreateCompletionRecord(rec, r)
	return rec
}

// --- Happy path & server-side stamping --------------------------------------

func TestCompletionWrite_Created_StampsServerFields(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	creator := &fakeCreator{}
	withCreator(t, creator)

	r := writeRequest(t, "user:abc", validWriteBody(), testGrafanaConfig())
	r.Header.Set("X-Grafana-User", "alice")
	rec := doWrite(t, nil, r)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (body: %s)", rec.Code, rec.Body.String())
	}
	if creator.n != 1 || creator.last == nil {
		t.Fatalf("expected exactly one create, got n=%d", creator.n)
	}
	obj := creator.last
	if obj.APIVersion != completionRecordsGroupVersion || obj.Kind != "CompletionRecord" {
		t.Fatalf("bad object coordinates: %+v", obj)
	}
	if obj.Metadata.Name == "" || obj.Metadata.Namespace != testNamespace {
		t.Fatalf("bad metadata: %+v", obj.Metadata)
	}
	s := obj.Spec
	if s.UserID != "user:abc" {
		t.Errorf("userId = %q, want user:abc", s.UserID)
	}
	if s.UserLogin != "alice" {
		t.Errorf("userLogin = %q, want alice (from X-Grafana-User)", s.UserLogin)
	}
	if s.UserDisplayName != "alice" {
		t.Errorf("userDisplayName = %q, want alice (falls back to login)", s.UserDisplayName)
	}
	if s.OrgID != testOrgID {
		t.Errorf("orgId = %d, want %d", s.OrgID, testOrgID)
	}
	if s.StackNamespace != testNamespace {
		t.Errorf("stackNamespace = %q, want %q", s.StackNamespace, testNamespace)
	}
	if s.SchemaVersion != completionWriteSchemaVersion {
		t.Errorf("schemaVersion = %d, want %d", s.SchemaVersion, completionWriteSchemaVersion)
	}
	if s.RecordedAt != timeNow().UTC().Format(time.RFC3339) {
		t.Errorf("recordedAt = %q, want server clock", s.RecordedAt)
	}
	if s.Platform != "cloud" {
		t.Errorf("platform = %q, want cloud (client-supplied, passed through)", s.Platform)
	}
	if s.GuideSource != "bundled" || s.GuideID != "first-dashboard" {
		t.Errorf("durable identity not carried: %+v", s)
	}
}

func TestCompletionWrite_GeneratesUniqueNames(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	creator := &fakeCreator{}
	withCreator(t, creator)

	rec1 := doWrite(t, nil, writeRequest(t, "user:abc", validWriteBody(), testGrafanaConfig()))
	name1 := creator.last.Metadata.Name
	rec2 := doWrite(t, nil, writeRequest(t, "user:abc", validWriteBody(), testGrafanaConfig()))
	name2 := creator.last.Metadata.Name

	if rec1.Code != http.StatusCreated || rec2.Code != http.StatusCreated {
		t.Fatalf("both writes should succeed: %d, %d", rec1.Code, rec2.Code)
	}
	if name1 == "" || name1 == name2 {
		t.Fatalf("names must be non-empty and unique: %q, %q", name1, name2)
	}
}

func TestCompletionWrite_DurationMsConvertedToSeconds(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	creator := &fakeCreator{}
	withCreator(t, creator)

	body := validWriteBody()
	body["durationMs"] = 4200
	doWrite(t, nil, writeRequest(t, "user:abc", body, testGrafanaConfig()))

	if got := creator.last.Spec.DurationSeconds; got != 4 {
		t.Fatalf("durationSeconds = %d, want 4 (4200ms floored)", got)
	}
}

// --- Body identity is never trusted -----------------------------------------

func TestCompletionWrite_BodyIdentityRejected(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	creator := &fakeCreator{}
	withCreator(t, creator)

	body := validWriteBody()
	body["userId"] = "user:evil"
	body["userLogin"] = "evil"
	body["userDisplayName"] = "Evil"
	body["orgId"] = 9999
	body["stackNamespace"] = "stacks-evil"
	body["recordedAt"] = "2000-01-01T00:00:00Z"
	body["schemaVersion"] = 999

	r := writeRequest(t, "user:good", body, testGrafanaConfig())
	r.Header.Set("X-Grafana-User", "good")
	rec := doWrite(t, nil, r)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201", rec.Code)
	}
	s := creator.last.Spec
	if s.UserID != "user:good" || s.UserLogin != "good" {
		t.Errorf("identity not overridden: userId=%q userLogin=%q", s.UserID, s.UserLogin)
	}
	if s.OrgID != testOrgID || s.StackNamespace != testNamespace {
		t.Errorf("org/stack not overridden: orgId=%d ns=%q", s.OrgID, s.StackNamespace)
	}
	if s.SchemaVersion != completionWriteSchemaVersion {
		t.Errorf("schemaVersion not overridden: %d", s.SchemaVersion)
	}
	if s.RecordedAt == "2000-01-01T00:00:00Z" {
		t.Errorf("recordedAt honored body value; must be server clock")
	}
}

// --- Auth & method ----------------------------------------------------------

func TestCompletionWrite_Unauthenticated(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	creator := &fakeCreator{}
	withCreator(t, creator)

	rec := doWrite(t, nil, writeRequest(t, "", validWriteBody(), testGrafanaConfig()))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
	if creator.n != 0 {
		t.Fatalf("must not reach upstream on auth failure")
	}
}

func TestCompletionWrite_MethodNotAllowed(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	r := writeRequest(t, "user:abc", validWriteBody(), testGrafanaConfig())
	r.Method = http.MethodGet
	rec := doWrite(t, nil, r)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want 405", rec.Code)
	}
}

func TestCompletionWrite_StructurallyUnavailableIsTerminal(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	creator := &fakeCreator{}
	withCreator(t, creator)

	// Feature toggle absent → structurally unavailable.
	cfg := map[string]string{sdkconfig.AppURL: "http://grafana.example"}
	rec := doWrite(t, nil, writeRequest(t, "user:abc", validWriteBody(), cfg))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 terminal", rec.Code)
	}
	if creator.n != 0 {
		t.Fatalf("must not reach upstream when unavailable")
	}
}

// --- Validation (all → terminal 400) ----------------------------------------

func TestCompletionWrite_Validation(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))

	cases := []struct {
		name   string
		mutate func(map[string]any)
	}{
		{"missing guideId", func(b map[string]any) { delete(b, "guideId") }},
		{"missing guideSource", func(b map[string]any) { delete(b, "guideSource") }},
		{"invalid source", func(b map[string]any) { b["source"] = "teleport" }},
		{"invalid guideCategory", func(b map[string]any) { b["guideCategory"] = "podcast" }},
		{"invalid platform", func(b map[string]any) { b["platform"] = "mainframe" }},
		{"percent over 100", func(b map[string]any) { b["completionPercent"] = 101 }},
		{"percent negative", func(b map[string]any) { b["completionPercent"] = -1 }},
		{"malformed completedAt", func(b map[string]any) { b["completedAt"] = "last tuesday" }},
		{"future completedAt", func(b map[string]any) {
			b["completedAt"] = timeNow().Add(time.Hour).UTC().Format(time.RFC3339)
		}},
		{"grossly backdated completedAt", func(b map[string]any) {
			b["completedAt"] = timeNow().Add(-completionMaxBackdate - 24*time.Hour).UTC().Format(time.RFC3339)
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			creator := &fakeCreator{}
			withCreator(t, creator)
			body := validWriteBody()
			tc.mutate(body)
			rec := doWrite(t, nil, writeRequest(t, "user:abc", body, testGrafanaConfig()))
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (body: %s)", rec.Code, rec.Body.String())
			}
			if creator.n != 0 {
				t.Fatalf("must not reach upstream on validation failure")
			}
		})
	}
}

func TestDecodeCompletionWriteRequest_RejectsTrailingAndOversizedBodies(t *testing.T) {
	tests := []struct {
		name string
		body string
	}{
		{"trailing JSON value", `{"guideId":"a"} {"guideId":"b"}`},
		{"oversized", `{"guideTitle":"` + strings.Repeat("x", completionWriteMaxBodyBytes) + `"}`},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodPost, "/completion-records", strings.NewReader(tc.body))
			if _, err := decodeCompletionWriteRequest(httptest.NewRecorder(), r); err == nil {
				t.Fatal("expected invalid request body")
			}
		})
	}
}

// completedAt legitimately delayed by days (offline queue) must be accepted.
func TestCompletionWrite_ToleratesDelayedOfflineRetry(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	creator := &fakeCreator{}
	withCreator(t, creator)

	body := validWriteBody()
	body["completedAt"] = timeNow().Add(-5 * 24 * time.Hour).UTC().Format(time.RFC3339)
	rec := doWrite(t, nil, writeRequest(t, "user:abc", body, testGrafanaConfig()))
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (5-day-old completion is a valid queued retry)", rec.Code)
	}
}

// --- Upstream error taxonomy ------------------------------------------------

func TestCompletionWrite_UpstreamErrorTaxonomy(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))

	cases := []struct {
		name           string
		err            error
		wantStatus     int
		wantRetryAfter string // "" means: header must be present (transient) but value unchecked; "-" means absent
	}{
		{"transient 503", &appPlatformUpstreamError{status: 503, msg: "boom"}, http.StatusServiceUnavailable, ""},
		{"transient 429 echoes retry-after", &appPlatformUpstreamError{status: 429, retryAfter: "12", msg: "slow down"}, http.StatusTooManyRequests, "12"},
		{"terminal 400 schema", &appPlatformUpstreamError{status: 400, msg: "bad spec"}, http.StatusBadRequest, "-"},
		{"terminal 422 schema", &appPlatformUpstreamError{status: 422, msg: "unprocessable"}, 422, "-"},
		{"upstream 404 remapped off the disarm signal", &appPlatformUpstreamError{status: 404, msg: "not found"}, http.StatusUnprocessableEntity, "-"},
		{"identity-scoped 403", &appPlatformUpstreamError{status: 403, msg: "forbidden"}, http.StatusForbidden, "-"},
		{"unexpected success status", &appPlatformUpstreamError{status: 202, msg: "not created"}, http.StatusBadGateway, ""},
		{"network error is transient", fmt.Errorf("dial tcp: connection refused"), http.StatusServiceUnavailable, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			creator := &fakeCreator{err: tc.err}
			withCreator(t, creator)
			rec := doWrite(t, nil, writeRequest(t, "user:abc", validWriteBody(), testGrafanaConfig()))
			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d", rec.Code, tc.wantStatus)
			}
			ra := rec.Header().Get("Retry-After")
			switch tc.wantRetryAfter {
			case "-":
				if ra != "" {
					t.Errorf("Retry-After = %q, want absent on terminal", ra)
				}
			case "":
				if ra == "" {
					t.Errorf("Retry-After missing on transient")
				}
			default:
				if ra != tc.wantRetryAfter {
					t.Errorf("Retry-After = %q, want %q", ra, tc.wantRetryAfter)
				}
			}
		})
	}
}

// --- Rate limit -------------------------------------------------------------

func TestCompletionWrite_RateLimited(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	creator := &fakeCreator{}
	withCreator(t, creator)

	app := &App{logger: log.DefaultLogger, completionWriteRateLimiter: newCompletionWriteRateLimiter()}

	var last int
	// Burst is completionWriteRateBurst; the next request over budget is 429.
	for i := 0; i < int(completionWriteRateBurst)+1; i++ {
		rec := doWrite(t, app, writeRequest(t, "user:flood", validWriteBody(), testGrafanaConfig()))
		last = rec.Code
		if i < int(completionWriteRateBurst) && rec.Code != http.StatusCreated {
			t.Fatalf("request %d within burst got %d, want 201", i, rec.Code)
		}
	}
	if last != http.StatusTooManyRequests {
		t.Fatalf("over-budget request got %d, want 429", last)
	}
}

func TestCompletionWrite_RateLimitIsPerUser(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	creator := &fakeCreator{}
	withCreator(t, creator)
	app := &App{logger: log.DefaultLogger, completionWriteRateLimiter: newCompletionWriteRateLimiter()}

	// Exhaust user A's burst.
	for i := 0; i < int(completionWriteRateBurst)+1; i++ {
		doWrite(t, app, writeRequest(t, "user:a", validWriteBody(), testGrafanaConfig()))
	}
	// User B is unaffected.
	rec := doWrite(t, app, writeRequest(t, "user:b", validWriteBody(), testGrafanaConfig()))
	if rec.Code != http.StatusCreated {
		t.Fatalf("user B got %d, want 201 (rate limit must be per-user)", rec.Code)
	}
}

// --- Read-cache invalidation on create --------------------------------------

func TestCompletionWrite_InvalidatesReadCache(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	lister := singlePageLister(
		rec("user:abc", "bundled", "linux", "Linux", "interactive", "", "objectives", "2026-07-20T10:00:00Z", 100),
	)
	withLister(t, lister)
	creator := &fakeCreator{}
	withCreator(t, creator)

	// Prime the read cache (1 upstream LIST).
	doMyCompletions(t, "/completion-records/my", "user:abc")
	if lister.callCount() != 1 {
		t.Fatalf("expected 1 LIST after first read, got %d", lister.callCount())
	}
	// A second read within TTL is a cache hit (still 1 LIST).
	doMyCompletions(t, "/completion-records/my", "user:abc")
	if lister.callCount() != 1 {
		t.Fatalf("expected cache hit (1 LIST), got %d", lister.callCount())
	}

	// A successful write must invalidate the namespace index.
	if rec := doWrite(t, nil, writeRequest(t, "user:abc", validWriteBody(), testGrafanaConfig())); rec.Code != http.StatusCreated {
		t.Fatalf("write status = %d, want 201", rec.Code)
	}

	// The next read refreshes (LIST count advances).
	doMyCompletions(t, "/completion-records/my", "user:abc")
	if lister.callCount() != 2 {
		t.Fatalf("expected a refresh after invalidation (2 LISTs), got %d", lister.callCount())
	}
}
