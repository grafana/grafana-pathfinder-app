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
// idempotencyKey is required, so a well-formed body always carries one; tests
// that exercise the key contract override or delete it.
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
		"idempotencyKey":    "evt-default",
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

// writeRequestWithUser is writeRequest plus a trusted PluginContext.User (the
// SDK's authenticated session), the profile-snapshot fallback source when the
// ID token carries no username/name claim. It overlays the user onto the plugin
// context; the Grafana config from writeRequest survives (different context key).
func writeRequestWithUser(t *testing.T, sub string, body map[string]any, cfg map[string]string, login, name string) *http.Request {
	t.Helper()
	r := writeRequest(t, sub, body, cfg)
	ctx := backend.WithPluginContext(r.Context(), backend.PluginContext{
		Namespace: testNamespace,
		OrgID:     testOrgID,
		User:      &backend.User{Login: login, Name: name},
	})
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

	r := writeRequestWithUser(t, "user:abc", validWriteBody(), testGrafanaConfig(), "alice", "")
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
		t.Errorf("userLogin = %q, want alice (from trusted PluginContext.User)", s.UserLogin)
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

// Distinct completion events (distinct keys) from the same user derive distinct
// record names, so separate completions never collapse into one object.
func TestCompletionWrite_DistinctKeysDistinctNames(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	creator := &fakeCreator{}
	withCreator(t, creator)

	body1 := validWriteBody()
	body1["idempotencyKey"] = "event-1"
	rec1 := doWrite(t, nil, writeRequest(t, "user:abc", body1, testGrafanaConfig()))
	name1 := creator.last.Metadata.Name

	body2 := validWriteBody()
	body2["idempotencyKey"] = "event-2"
	rec2 := doWrite(t, nil, writeRequest(t, "user:abc", body2, testGrafanaConfig()))
	name2 := creator.last.Metadata.Name

	if rec1.Code != http.StatusCreated || rec2.Code != http.StatusCreated {
		t.Fatalf("both writes should succeed: %d, %d", rec1.Code, rec2.Code)
	}
	if name1 == "" || name1 == name2 {
		t.Fatalf("distinct keys must derive non-empty, distinct names: %q, %q", name1, name2)
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

// durationMs has a bounded domain (D6): negatives and values above the 24h
// ceiling are producer bugs, rejected as terminal 400 rather than coerced; the
// ceiling itself is accepted.
func TestCompletionWrite_DurationDomain(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))

	t.Run("negative rejected", func(t *testing.T) {
		creator := &fakeCreator{}
		withCreator(t, creator)
		body := validWriteBody()
		body["durationMs"] = -1
		rec := doWrite(t, nil, writeRequest(t, "user:abc", body, testGrafanaConfig()))
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400 (negative durationMs)", rec.Code)
		}
		if creator.n != 0 {
			t.Fatalf("must not reach upstream on invalid duration")
		}
	})

	t.Run("above ceiling rejected", func(t *testing.T) {
		creator := &fakeCreator{}
		withCreator(t, creator)
		body := validWriteBody()
		body["durationMs"] = completionMaxDurationMs + 1
		rec := doWrite(t, nil, writeRequest(t, "user:abc", body, testGrafanaConfig()))
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400 (durationMs over ceiling)", rec.Code)
		}
		if creator.n != 0 {
			t.Fatalf("must not reach upstream on invalid duration")
		}
	})

	t.Run("ceiling accepted", func(t *testing.T) {
		creator := &fakeCreator{}
		withCreator(t, creator)
		body := validWriteBody()
		body["durationMs"] = completionMaxDurationMs
		rec := doWrite(t, nil, writeRequest(t, "user:abc", body, testGrafanaConfig()))
		if rec.Code != http.StatusCreated {
			t.Fatalf("status = %d, want 201 (exactly the ceiling is valid)", rec.Code)
		}
		if got := creator.last.Spec.DurationSeconds; got != completionMaxDurationMs/1000 {
			t.Fatalf("durationSeconds = %d, want %d", got, completionMaxDurationMs/1000)
		}
	})
}

// --- Profile snapshot identity (token claims → trusted PluginContext) --------

// The durable login/display-name snapshots prefer the ID-token username/name
// claims; when both are present, the trusted PluginContext.User must NOT override
// them (token claims win).
func TestCompletionWrite_ProfileFromTokenClaims(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	creator := &fakeCreator{}
	withCreator(t, creator)

	r := writeRequestWithUser(t, "user:abc", validWriteBody(), testGrafanaConfig(), "ctx-login", "Context Name")
	r.Header.Set(backend.GrafanaUserSignInTokenHeaderName,
		makeIDTokenWithProfile(t, "user:abc", timeNow().Add(time.Hour).Unix(), "token-login", "Token Name"))
	rec := doWrite(t, nil, r)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201", rec.Code)
	}
	s := creator.last.Spec
	if s.UserLogin != "token-login" {
		t.Errorf("userLogin = %q, want token-login (token claim wins over PluginContext)", s.UserLogin)
	}
	if s.UserDisplayName != "Token Name" {
		t.Errorf("userDisplayName = %q, want Token Name", s.UserDisplayName)
	}
}

// When the token carries no username/name claims, the snapshots fall back to the
// trusted PluginContext.User (never the spoofable raw X-Grafana-User header).
func TestCompletionWrite_ProfileFallsBackToTrustedContext(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	creator := &fakeCreator{}
	withCreator(t, creator)

	// The test token from writeRequest carries only sub/exp — no profile claims.
	// A raw X-Grafana-User header must be ignored; only PluginContext.User counts.
	r := writeRequestWithUser(t, "user:abc", validWriteBody(), testGrafanaConfig(), "ctx-login", "Context Name")
	r.Header.Set("X-Grafana-User", "spoofed")
	rec := doWrite(t, nil, r)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201", rec.Code)
	}
	s := creator.last.Spec
	if s.UserLogin != "ctx-login" {
		t.Errorf("userLogin = %q, want ctx-login (trusted PluginContext, not X-Grafana-User)", s.UserLogin)
	}
	if s.UserDisplayName != "Context Name" {
		t.Errorf("userDisplayName = %q, want Context Name", s.UserDisplayName)
	}
}

// Absent token claims and absent PluginContext.User yield empty snapshots — a
// valid, schema-permitted value. The raw header is never a fallback.
func TestCompletionWrite_ProfileEmptyWhenNoTrustedSource(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	creator := &fakeCreator{}
	withCreator(t, creator)

	r := writeRequest(t, "user:abc", validWriteBody(), testGrafanaConfig())
	r.Header.Set("X-Grafana-User", "spoofed")
	rec := doWrite(t, nil, r)

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201", rec.Code)
	}
	s := creator.last.Spec
	if s.UserLogin != "" || s.UserDisplayName != "" {
		t.Errorf("snapshots = (%q, %q), want empty (raw header is never trusted)", s.UserLogin, s.UserDisplayName)
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

	r := writeRequestWithUser(t, "user:good", body, testGrafanaConfig(), "good", "")
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
		{"missing idempotencyKey", func(b map[string]any) { delete(b, "idempotencyKey") }},
		{"blank idempotencyKey", func(b map[string]any) { b["idempotencyKey"] = "" }},
		{"whitespace idempotencyKey", func(b map[string]any) { b["idempotencyKey"] = "   " }},
		{"oversized idempotencyKey", func(b map[string]any) { b["idempotencyKey"] = strings.Repeat("a", completionMaxIDLen+1) }},
		{"invalid source", func(b map[string]any) { b["source"] = "teleport" }},
		{"invalid guideCategory", func(b map[string]any) { b["guideCategory"] = "podcast" }},
		{"invalid platform", func(b map[string]any) { b["platform"] = "mainframe" }},
		{"percent over 100", func(b map[string]any) { b["completionPercent"] = 101 }},
		{"percent negative", func(b map[string]any) { b["completionPercent"] = -1 }},
		{"oversized guideId", func(b map[string]any) { b["guideId"] = strings.Repeat("a", completionMaxIDLen+1) }},
		{"oversized guideSource", func(b map[string]any) { b["guideSource"] = strings.Repeat("a", completionMaxIDLen+1) }},
		{"oversized pathId", func(b map[string]any) { b["pathId"] = strings.Repeat("a", completionMaxIDLen+1) }},
		{"oversized guideTitle", func(b map[string]any) { b["guideTitle"] = strings.Repeat("a", completionMaxTitleLen+1) }},
		{"control characters in guideTitle", func(b map[string]any) { b["guideTitle"] = "First\x00dashboard" }},
		{"newline in guideId", func(b map[string]any) { b["guideId"] = "first\ndashboard" }},
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

// TestCompletionWrite_AcceptsEveryFrontendValue pins the FE↔BE value-domain
// contract: every enum value the frontend can emit (CompletionSource /
// CompletionCategory in src/completion-records/types.ts, CompletionPlatform in
// completion-write-client.ts) and its real millisecond-RFC3339 completedAt wire
// format must be accepted. Drift here fails silently in production — a value
// the backend rejects becomes a terminal 400 the retry queue drops.
func TestCompletionWrite_AcceptsEveryFrontendValue(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))

	frontendSources := []string{"objectives", "manual", "skipped"}
	frontendCategories := []string{"interactive", "documentation", "learning-journey"}
	frontendPlatforms := []string{"oss", "cloud"}

	for _, source := range frontendSources {
		for _, category := range frontendCategories {
			for _, platform := range frontendPlatforms {
				t.Run(source+"/"+category+"/"+platform, func(t *testing.T) {
					creator := &fakeCreator{}
					withCreator(t, creator)
					body := validWriteBody()
					body["source"] = source
					body["guideCategory"] = category
					body["platform"] = platform
					// The frontend sends new Date().toISOString() — millisecond precision.
					body["completedAt"] = timeNow().UTC().Format("2006-01-02T15:04:05.000Z07:00")
					rec := doWrite(t, nil, writeRequest(t, "user:abc", body, testGrafanaConfig()))
					if rec.Code != http.StatusCreated {
						t.Fatalf("status = %d, want 201 (body: %s)", rec.Code, rec.Body.String())
					}
				})
			}
		}
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

// --- Idempotency (finding 1) ------------------------------------------------

// A stable idempotencyKey must derive a DETERMINISTIC record name, so a retried
// POST targets the same object instead of minting a duplicate.
func TestCompletionWrite_IdempotencyKeyDeterministicName(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	creator := &fakeCreator{}
	withCreator(t, creator)

	body := validWriteBody()
	body["idempotencyKey"] = "event-123"
	doWrite(t, nil, writeRequest(t, "user:abc", body, testGrafanaConfig()))
	name1 := creator.last.Metadata.Name
	doWrite(t, nil, writeRequest(t, "user:abc", body, testGrafanaConfig()))
	name2 := creator.last.Metadata.Name

	if name1 == "" || name1 != name2 {
		t.Fatalf("same idempotencyKey must derive the same name: %q vs %q", name1, name2)
	}

	// A different key derives a different name; the key is never persisted.
	body["idempotencyKey"] = "event-456"
	doWrite(t, nil, writeRequest(t, "user:abc", body, testGrafanaConfig()))
	if creator.last.Metadata.Name == name1 {
		t.Fatalf("distinct idempotencyKey must derive a distinct name, both %q", name1)
	}
}

// An upstream "already exists" (409) on a deterministically-named retry means
// the write already committed — it must surface as success, not a failure.
func TestCompletionWrite_AlreadyExistsTreatedAsSuccess(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	creator := &fakeCreator{err: &appPlatformUpstreamError{status: http.StatusConflict, msg: "already exists"}}
	withCreator(t, creator)

	body := validWriteBody()
	body["idempotencyKey"] = "event-123"
	rec := doWrite(t, nil, writeRequest(t, "user:abc", body, testGrafanaConfig()))
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (409 is an idempotent success)", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "completion-") {
		t.Fatalf("expected the record name in the body, got %q", rec.Body.String())
	}
}

// Two users submitting the SAME idempotency key must target DIFFERENT records:
// the name is scoped to the trusted userID. This is the cross-user integrity
// invariant — user B can never receive a 409 for user A's record, so B is never
// falsely acknowledged as durable when nothing was written for B.
func TestCompletionWrite_CrossUserSameKeyDistinctRecords(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	creator := &fakeCreator{}
	withCreator(t, creator)

	body := validWriteBody()
	body["idempotencyKey"] = "shared-event-key"

	recA := doWrite(t, nil, writeRequest(t, "user:alice", body, testGrafanaConfig()))
	if recA.Code != http.StatusCreated {
		t.Fatalf("user A status = %d, want 201", recA.Code)
	}
	nameA, userA := creator.last.Metadata.Name, creator.last.Spec.UserID

	recB := doWrite(t, nil, writeRequest(t, "user:bob", body, testGrafanaConfig()))
	if recB.Code != http.StatusCreated {
		t.Fatalf("user B status = %d, want 201", recB.Code)
	}
	nameB, userB := creator.last.Metadata.Name, creator.last.Spec.UserID

	if userA != "user:alice" || userB != "user:bob" {
		t.Fatalf("identity not stamped per caller: %q, %q", userA, userB)
	}
	if nameA == nameB {
		t.Fatalf("same key from different users must derive DIFFERENT names, both %q", nameA)
	}
}

// A keyless request is a terminal 400 BEFORE any upstream work, so a keyless
// caller never reaches the create path and can never have an upstream 409
// blindly acknowledged as success — even when the upstream would report one.
func TestCompletionWrite_KeylessNeverReachesUpstream(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	creator := &fakeCreator{err: &appPlatformUpstreamError{status: http.StatusConflict, msg: "already exists"}}
	withCreator(t, creator)

	body := validWriteBody()
	delete(body, "idempotencyKey")
	rec := doWrite(t, nil, writeRequest(t, "user:abc", body, testGrafanaConfig()))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (keyless is terminal, never a 409-ack)", rec.Code)
	}
	if creator.n != 0 {
		t.Fatalf("keyless request must not reach upstream")
	}
}

// Same user replaying the SAME key with the SAME payload is idempotent: the
// derived name is stable, and an upstream 409 on the replay surfaces as success
// (201) — no duplicate, no false failure.
func TestCompletionWrite_SameUserReplayIdempotent(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	creator := &fakeCreator{}
	withCreator(t, creator)

	body := validWriteBody()
	body["idempotencyKey"] = "event-replay"

	rec1 := doWrite(t, nil, writeRequest(t, "user:abc", body, testGrafanaConfig()))
	if rec1.Code != http.StatusCreated {
		t.Fatalf("first write status = %d, want 201", rec1.Code)
	}
	name1 := creator.last.Metadata.Name

	// The replay now finds the record already committed upstream.
	creator.err = &appPlatformUpstreamError{status: http.StatusConflict, msg: "already exists"}
	rec2 := doWrite(t, nil, writeRequest(t, "user:abc", body, testGrafanaConfig()))
	if rec2.Code != http.StatusCreated {
		t.Fatalf("replay status = %d, want 201 (idempotent success)", rec2.Code)
	}
	if creator.last.Metadata.Name != name1 {
		t.Fatalf("replay name = %q, want stable %q", creator.last.Metadata.Name, name1)
	}
}

// --- Durable display-identity bounds (finding 6) ----------------------------

func TestCompletionWrite_DisplayIdentityBounded(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	creator := &fakeCreator{}
	withCreator(t, creator)

	// A hostile / oversized identity-provider value arrives via the trusted
	// PluginContext.User (no username/name claims in the test token, so login
	// falls back to it). Control characters appear BEFORE the truncation boundary
	// so stripping is exercised independently of the length cap, not merely
	// truncated away.
	hostile := "\x00\x07" + strings.Repeat("a", 10) + "\x01" + strings.Repeat("b", completionMaxDisplayLen+50) + "tail"
	r := writeRequestWithUser(t, "user:abc", validWriteBody(), testGrafanaConfig(), hostile, "")
	rec := doWrite(t, nil, r)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (odd identity is sanitized, not rejected)", rec.Code)
	}
	s := creator.last.Spec
	if len(s.UserLogin) > completionMaxDisplayLen {
		t.Errorf("userLogin len = %d, want <= %d", len(s.UserLogin), completionMaxDisplayLen)
	}
	for _, ru := range s.UserLogin + s.UserDisplayName {
		if ru < 0x20 || ru == 0x7f {
			t.Fatalf("control character survived normalization in %q / %q", s.UserLogin, s.UserDisplayName)
		}
	}
	if len(s.UserDisplayName) > completionMaxDisplayLen {
		t.Errorf("userDisplayName len = %d, want <= %d", len(s.UserDisplayName), completionMaxDisplayLen)
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
		{"transient 408 request timeout", &appPlatformUpstreamError{status: 408, msg: "request timeout"}, http.StatusRequestTimeout, ""},
		{"terminal 400 schema", &appPlatformUpstreamError{status: 400, msg: "bad spec"}, http.StatusBadRequest, "-"},
		{"terminal 422 schema", &appPlatformUpstreamError{status: 422, msg: "unprocessable"}, 422, "-"},
		{"collection 404 preserved as structural disarm signal", &appPlatformUpstreamError{status: 404, msg: "not found"}, http.StatusNotFound, "-"},
		{"identity-scoped 401 echoed for client-side re-auth retry", &appPlatformUpstreamError{status: 401, msg: "unauthorized"}, http.StatusUnauthorized, "-"},
		{"identity-scoped 403 is terminal", &appPlatformUpstreamError{status: 403, msg: "forbidden"}, http.StatusForbidden, "-"},
		{"unexpected success status", &appPlatformUpstreamError{status: 202, msg: "not created"}, http.StatusBadGateway, ""},
		{"unfollowed redirect mapped to retryable 502", &appPlatformUpstreamError{status: 302, msg: "moved"}, http.StatusBadGateway, ""},
		{"network error is transient", fmt.Errorf("dial tcp: connection refused"), http.StatusServiceUnavailable, ""},
		// A token exchange that fails at RUNTIME (the credential IS provisioned) is
		// an auth-api blip, not a structural absence: retryable, so the queued fact
		// survives. Structural absence takes the separate obo-unavailable → 404 path
		// (TestCompletionWriteHandler_UnprovisionedStackReturns404) and must never
		// land here, or an unprovisioned stack would retry until the 30-day horizon.
		{"token exchange failure is transient", &tokenExchangeError{err: fmt.Errorf("auth-api unavailable")}, http.StatusServiceUnavailable, ""},
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

// An upstream 403 is TERMINAL and drops the completion (write-403-policy): it is
// echoed verbatim so the front-end classifier drops it, carries no Retry-After
// (no retry), and never reaches the create-success path. A 403 is not treated as
// transient — a systemic RBAC/grant denial will not fix itself by retrying.
func TestCompletionWrite_Forbidden403IsTerminalDrop(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	creator := &fakeCreator{err: &appPlatformUpstreamError{status: http.StatusForbidden, msg: "forbidden"}}
	withCreator(t, creator)

	rec := doWrite(t, nil, writeRequest(t, "user:abc", validWriteBody(), testGrafanaConfig()))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 (terminal, dropped)", rec.Code)
	}
	if ra := rec.Header().Get("Retry-After"); ra != "" {
		t.Errorf("Retry-After = %q, want absent (403 is terminal, no retry)", ra)
	}
	if isTransientUpstreamStatus(http.StatusForbidden) {
		t.Errorf("403 must not be classified transient")
	}
}

// A runtime token-exchange failure is retryable, but it must not be silent. The
// one bad shape it can hide — a provisioned credential in an environment whose
// delegated-permissions grant is missing — retries every queued write until the
// 30-day retention horizon, so it is logged at warn (the same Faro-visible bar
// as the terminal-403 decision), never at debug alongside ordinary network blips.
func TestCompletionWrite_TokenExchangeFailureIsLoudAndRetryable(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	withCreator(t, &fakeCreator{err: &tokenExchangeError{err: fmt.Errorf("auth-api unavailable")}})

	logger := newCapturingLogger()
	app := newTestApp(t)
	app.logger = logger

	rec := doWrite(t, app, writeRequest(t, "user:abc", validWriteBody(), testGrafanaConfig()))
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503 (transient — a brief auth-api blip must recover)", rec.Code)
	}
	if rec.Header().Get("Retry-After") == "" {
		t.Error("Retry-After missing: an exchange failure must be retried, not dropped")
	}
	if !logger.warnedWith("token exchange") {
		t.Errorf("exchange failure must be logged at warn (Faro-visible), got %+v", *logger.lines)
	}

	// An ordinary network failure stays at debug — only the exchange case is loud,
	// or the signal drowns.
	quiet := newCapturingLogger()
	app.logger = quiet
	withCreator(t, &fakeCreator{err: fmt.Errorf("dial tcp: connection refused")})
	doWrite(t, app, writeRequest(t, "user:abc", validWriteBody(), testGrafanaConfig()))
	if quiet.warnedWith("token exchange") {
		t.Error("a plain network failure must not be reported as a token-exchange failure")
	}
}

// The stamped subject comes from the INBOUND ID token, and only from there. The
// outbound credential changed from the ID token to a minted on-behalf-of access
// token; this pins that the change did not — and a future outbound refactor
// cannot silently — move identity onto the minted token instead.
func TestCompletionWrite_SubjectComesFromInboundIDToken(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	creator := &fakeCreator{}
	withCreator(t, creator)

	// A plain numeric subject, matching what a real stack forwards; the format
	// follows the identity provider, so nothing may depend on its shape.
	const inboundSubject = "user:27"
	rec := doWrite(t, nil, writeRequest(t, inboundSubject, validWriteBody(), testGrafanaConfig()))
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (body: %s)", rec.Code, rec.Body.String())
	}
	if creator.last.Spec.UserID != inboundSubject {
		t.Errorf("stamped userId = %q, want the inbound ID token's sub %q", creator.last.Spec.UserID, inboundSubject)
	}
	// The record name is derived from the same trusted subject, so it must track
	// the inbound token too.
	if want := completionRecordName(inboundSubject, "evt-default"); creator.last.Metadata.Name != want {
		t.Errorf("record name = %q, want %q (derived from the inbound subject)", creator.last.Metadata.Name, want)
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

// The limiter reads the package-wide timeNow seam (finding 7), so freezing then
// advancing the clock drives refill deterministically: exhaust the burst → 429
// with a Retry-After, advance past one refill interval → the next request is
// admitted again.
func TestCompletionWrite_RateLimitRefillsAfterClockAdvance(t *testing.T) {
	advance := withFrozenTime(t, time.Unix(1_700_000_000, 0))
	withCreator(t, &fakeCreator{})
	app := &App{logger: log.DefaultLogger, completionWriteRateLimiter: newCompletionWriteRateLimiter()}

	// Drain the whole burst, then one more to hit the limit.
	for i := 0; i < int(completionWriteRateBurst); i++ {
		if rec := doWrite(t, app, writeRequest(t, "user:flood", validWriteBody(), testGrafanaConfig())); rec.Code != http.StatusCreated {
			t.Fatalf("request %d within burst got %d, want 201", i, rec.Code)
		}
	}
	rec := doWrite(t, app, writeRequest(t, "user:flood", validWriteBody(), testGrafanaConfig()))
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("over-budget request got %d, want 429", rec.Code)
	}
	if rec.Header().Get("Retry-After") == "" {
		t.Fatalf("429 must carry a Retry-After hint")
	}

	// Without advancing the clock, still limited.
	if rec := doWrite(t, app, writeRequest(t, "user:flood", validWriteBody(), testGrafanaConfig())); rec.Code != http.StatusTooManyRequests {
		t.Fatalf("still-exhausted request got %d, want 429", rec.Code)
	}

	// Advance past one refill interval (1/refillPerSec seconds) → one token back.
	advance(time.Duration(float64(time.Second) / completionWriteRateRefillPerSec))
	if rec := doWrite(t, app, writeRequest(t, "user:flood", validWriteBody(), testGrafanaConfig())); rec.Code != http.StatusCreated {
		t.Fatalf("after clock advance got %d, want 201 (token refilled)", rec.Code)
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

func TestCompletionWrite_ClearsFailureCooldown(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	fail := true
	lister := &fakeLister{respond: func(string) (*completionRecordPage, error) {
		if fail {
			return nil, fmt.Errorf("upstream down")
		}
		return &completionRecordPage{Records: []completionRecordSpec{
			rec("user:abc", "bundled", "linux", "Linux", "interactive", "", "objectives", "2026-07-20T10:00:00Z", 100),
		}}, nil
	}}
	withLister(t, lister)
	withCreator(t, &fakeCreator{})

	// A cold read fails and stamps the failure cooldown.
	doMyCompletions(t, "/completion-records/my", "user:abc")
	if lister.callCount() != 1 {
		t.Fatalf("expected 1 LIST after failing read, got %d", lister.callCount())
	}

	// Upstream recovers and a write succeeds inside the cooldown window. The
	// invalidation must clear the cooldown so the post-write read refreshes
	// instead of replaying the stale error.
	fail = false
	if rec := doWrite(t, nil, writeRequest(t, "user:abc", validWriteBody(), testGrafanaConfig())); rec.Code != http.StatusCreated {
		t.Fatalf("write status = %d, want 201", rec.Code)
	}
	rr, body := doMyCompletions(t, "/completion-records/my", "user:abc")
	if lister.callCount() != 2 {
		t.Fatalf("expected post-write read to refresh (2 LISTs), got %d", lister.callCount())
	}
	if rr.Code != http.StatusOK || len(body.Completions) != 1 {
		t.Fatalf("post-write read = %d with %d completions, want 200 with 1", rr.Code, len(body.Completions))
	}
}
