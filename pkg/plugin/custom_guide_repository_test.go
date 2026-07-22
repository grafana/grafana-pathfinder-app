package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	sdkconfig "github.com/grafana/grafana-plugin-sdk-go/config"
	"github.com/grafana/grafana-plugin-sdk-go/experimental/featuretoggles"
)

// Shared test helpers reused from the package: withFrozenTime
// (package_recommendations_test.go), makeIDToken (app_platform_identity_test.go),
// testNamespace + testGrafanaConfig (completion_records_test.go), newTestApp
// (helpers_test.go).

// fakeGuideLister is an injectable customGuideLister. respond maps an incoming
// continue token to a page or error; calls counts invocations.
type fakeGuideLister struct {
	respond func(token string) (*customGuidePage, error)
	calls   int32
}

func (f *fakeGuideLister) ListPage(_ context.Context, _ string, token string) (*customGuidePage, error) {
	atomic.AddInt32(&f.calls, 1)
	return f.respond(token)
}

func (f *fakeGuideLister) callCount() int { return int(atomic.LoadInt32(&f.calls)) }

func guideEntry(id, title, status, manifestType string) customGuideRepositoryEntry {
	e := customGuideRepositoryEntry{ID: id, Title: title, Status: status}
	if manifestType != "" {
		e.Manifest = &customGuideManifest{Type: manifestType, Repository: "app-platform"}
	}
	return e
}

// singlePageGuideLister serves all entries in one page.
func singlePageGuideLister(entries ...customGuideRepositoryEntry) *fakeGuideLister {
	return &fakeGuideLister{respond: func(string) (*customGuidePage, error) {
		return &customGuidePage{Entries: entries, Continue: ""}, nil
	}}
}

func withGuideLister(t *testing.T, l customGuideLister) {
	t.Helper()
	resetCustomGuideRepositoryCache()
	prev := customGuideListerOverride
	customGuideListerOverride = l
	t.Cleanup(func() {
		customGuideListerOverride = prev
		resetCustomGuideRepositoryCache()
	})
}

// customGuideRequestWithConfig builds a GET request carrying an ID-token
// identity (valid future exp), a namespace in the plugin context, and the given
// Grafana config. `sub` may be empty: the catalogue only structurally validates
// the token, so a subjectless-but-valid token is still authorized.
func customGuideRequestWithConfig(t *testing.T, target, sub string, cfg map[string]string) *http.Request {
	t.Helper()
	r, _ := http.NewRequest(http.MethodGet, target, nil)
	r.Header.Set(backend.GrafanaUserSignInTokenHeaderName, makeIDToken(t, sub, timeNow().Add(time.Hour).Unix()))
	ctx := backend.WithPluginContext(r.Context(), backend.PluginContext{Namespace: testNamespace})
	ctx = sdkconfig.WithGrafanaConfig(ctx, sdkconfig.NewGrafanaCfg(cfg))
	return r.WithContext(ctx)
}

func customGuideRequest(t *testing.T, target, sub string) *http.Request {
	t.Helper()
	return customGuideRequestWithConfig(t, target, sub, testGrafanaConfig())
}

func doCustomGuideReq(t *testing.T, r *http.Request) (*httptest.ResponseRecorder, customGuideRepositoryResponse) {
	t.Helper()
	app := newTestApp(t)
	rec := httptest.NewRecorder()
	app.handleCustomGuideRepository(rec, r)
	var body customGuideRepositoryResponse
	if rec.Body.Len() > 0 {
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode body: %v (raw: %s)", err, rec.Body.String())
		}
	}
	return rec, body
}

func doCustomGuide(t *testing.T, target, sub string) (*httptest.ResponseRecorder, customGuideRepositoryResponse) {
	t.Helper()
	return doCustomGuideReq(t, customGuideRequest(t, target, sub))
}

// --- Happy path / shaping ----------------------------------------------------

func TestCustomGuide_ServesShapedCatalogue(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	withGuideLister(t, singlePageGuideLister(
		guideEntry("fe-alerting-path", "Alerting enablement", "published", "path"),
		guideEntry("fe-alerting-01", "Alerting module 1", "published", "guide"),
	))

	rr, body := doCustomGuide(t, "/custom-guide-repository", "user:1")

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	if !body.Capability.Available {
		t.Fatalf("expected capability available, got %+v", body.Capability)
	}
	if len(body.Guides) != 2 {
		t.Fatalf("expected 2 guides, got %d", len(body.Guides))
	}
	if body.Guides[0].ID != "fe-alerting-path" || body.Guides[0].Manifest == nil || body.Guides[0].Manifest.Type != "path" {
		t.Errorf("first guide not shaped as expected: %+v", body.Guides[0])
	}
	if body.AsOf == "" {
		t.Error("expected asOf to be set on a successful serve")
	}
}

// A structurally valid token with no `sub` claim is still authorized: the
// catalogue is namespace-global and must not depend on subject extraction.
func TestCustomGuide_SubjectlessTokenStillServes(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	withGuideLister(t, singlePageGuideLister(guideEntry("fe-01", "One", "published", "guide")))

	rr, body := doCustomGuide(t, "/custom-guide-repository", "")

	if rr.Code != http.StatusOK || !body.Capability.Available {
		t.Fatalf("subjectless-but-valid token should serve; status=%d cap=%+v", rr.Code, body.Capability)
	}
	if len(body.Guides) != 1 {
		t.Fatalf("expected 1 guide, got %d", len(body.Guides))
	}
}

// Two different callers share one upstream LIST — the shared-blob model: the
// catalogue is identity-invariant, so a warm entry serves every authorized
// caller in the namespace.
func TestCustomGuide_SharedBlobServesAllCallers(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	l := singlePageGuideLister(guideEntry("fe-01", "One", "published", "guide"))
	withGuideLister(t, l)

	_, b1 := doCustomGuide(t, "/custom-guide-repository", "user:1")
	_, b2 := doCustomGuide(t, "/custom-guide-repository", "user:2")

	if len(b1.Guides) != 1 || len(b2.Guides) != 1 {
		t.Fatalf("both callers should see the catalogue; got %d and %d", len(b1.Guides), len(b2.Guides))
	}
	if l.callCount() != 1 {
		t.Errorf("expected one shared upstream LIST for two callers, got %d", l.callCount())
	}
}

func TestCustomGuide_EmptyNamespaceIsAvailableNotUnavailable(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	withGuideLister(t, singlePageGuideLister())

	_, body := doCustomGuide(t, "/custom-guide-repository", "user:1")

	if !body.Capability.Available {
		t.Fatalf("empty result must still be available=true, got %+v", body.Capability)
	}
	if body.Guides == nil {
		t.Error("guides must serialize as [] not null")
	}
	if len(body.Guides) != 0 {
		t.Errorf("expected 0 guides, got %d", len(body.Guides))
	}
}

// --- Pagination --------------------------------------------------------------

func TestCustomGuide_PaginationDrainsAllPages(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	l := &fakeGuideLister{respond: func(token string) (*customGuidePage, error) {
		switch token {
		case "":
			return &customGuidePage{Entries: []customGuideRepositoryEntry{guideEntry("a", "A", "published", "guide")}, Continue: "tok-2"}, nil
		case "tok-2":
			return &customGuidePage{Entries: []customGuideRepositoryEntry{guideEntry("b", "B", "published", "guide")}, Continue: "tok-3"}, nil
		default:
			return &customGuidePage{Entries: []customGuideRepositoryEntry{guideEntry("c", "C", "published", "guide")}, Continue: ""}, nil
		}
	}}
	withGuideLister(t, l)

	_, body := doCustomGuide(t, "/custom-guide-repository", "user:1")

	if len(body.Guides) != 3 {
		t.Fatalf("expected 3 guides drained across pages, got %d", len(body.Guides))
	}
	if l.callCount() != 3 {
		t.Errorf("expected 3 page fetches, got %d", l.callCount())
	}
}

func TestCustomGuide_AggregateBudgetStopsDrain(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	prev := customGuideListMaxTotalEntries
	customGuideListMaxTotalEntries = 2
	t.Cleanup(func() { customGuideListMaxTotalEntries = prev })

	page := 0
	l := &fakeGuideLister{respond: func(string) (*customGuidePage, error) {
		page++
		return &customGuidePage{
			Entries:  []customGuideRepositoryEntry{guideEntry(fmt.Sprintf("g-%d", page), "G", "published", "guide")},
			Continue: fmt.Sprintf("tok-%d", page+1), // never drains naturally
		}, nil
	}}
	withGuideLister(t, l)

	_, body := doCustomGuide(t, "/custom-guide-repository", "user:1")

	if len(body.Guides) < 2 {
		t.Fatalf("expected the budget to stop the drain with >=2 entries, got %d", len(body.Guides))
	}
	if l.callCount() > 5 {
		t.Errorf("budget did not stop the drain: %d page fetches", l.callCount())
	}
}

// --- Cache -------------------------------------------------------------------

func TestCustomGuide_WithinTTLServesFromCache(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	l := singlePageGuideLister(guideEntry("a", "A", "published", "guide"))
	withGuideLister(t, l)

	doCustomGuide(t, "/custom-guide-repository", "user:1")
	doCustomGuide(t, "/custom-guide-repository", "user:1")

	if l.callCount() != 1 {
		t.Errorf("expected 1 upstream LIST within TTL, got %d", l.callCount())
	}
}

func TestCustomGuide_TTLExpiryTriggersRefresh(t *testing.T) {
	advance := withFrozenTime(t, time.Unix(1_700_000_000, 0))
	l := singlePageGuideLister(guideEntry("a", "A", "published", "guide"))
	withGuideLister(t, l)

	doCustomGuide(t, "/custom-guide-repository", "user:1")
	advance(customGuideCacheTTL + time.Second)
	doCustomGuide(t, "/custom-guide-repository", "user:1")

	if l.callCount() != 2 {
		t.Errorf("expected a refresh after TTL expiry, got %d LISTs", l.callCount())
	}
}

func TestCustomGuide_Singleflight(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	release := make(chan struct{})
	var calls int32
	l := &fakeGuideLister{respond: func(string) (*customGuidePage, error) {
		atomic.AddInt32(&calls, 1)
		<-release
		return &customGuidePage{Entries: []customGuideRepositoryEntry{guideEntry("a", "A", "published", "guide")}, Continue: ""}, nil
	}}
	withGuideLister(t, l)

	var wg sync.WaitGroup
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			doCustomGuide(t, "/custom-guide-repository", "user:1")
		}()
	}
	time.Sleep(50 * time.Millisecond)
	close(release)
	wg.Wait()

	if got := atomic.LoadInt32(&calls); got != 1 {
		t.Errorf("expected concurrent callers to single-flight one LIST, got %d", got)
	}
}

func TestCustomGuide_ForcedRefreshBypassAndRateLimit(t *testing.T) {
	advance := withFrozenTime(t, time.Unix(1_700_000_000, 0))
	l := singlePageGuideLister(guideEntry("a", "A", "published", "guide"))
	withGuideLister(t, l)

	doCustomGuide(t, "/custom-guide-repository", "user:1")           // 1: cold
	doCustomGuide(t, "/custom-guide-repository?refresh=1", "user:1") // 2: forced bypass
	if l.callCount() != 2 {
		t.Fatalf("refresh=1 should bypass the fresh cache; got %d LISTs", l.callCount())
	}
	// Second forced refresh within the rate-limit window is suppressed (cache hit).
	doCustomGuide(t, "/custom-guide-repository?refresh=1", "user:1")
	if l.callCount() != 2 {
		t.Errorf("forced refresh should be rate-limited within the window; got %d LISTs", l.callCount())
	}
	// After the window, a forced refresh is permitted again.
	advance(customGuideForcedRefreshInterval + time.Second)
	doCustomGuide(t, "/custom-guide-repository?refresh=1", "user:1")
	if l.callCount() != 3 {
		t.Errorf("forced refresh after the window should LIST again; got %d", l.callCount())
	}
}

// --- Failure matrix ----------------------------------------------------------

func TestCustomGuide_ColdTransientReturns503WithRetryAfter(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	withGuideLister(t, &fakeGuideLister{respond: func(string) (*customGuidePage, error) {
		return nil, &appPlatformUpstreamError{status: http.StatusServiceUnavailable, msg: "upstream 503"}
	}})

	rr, _ := doCustomGuide(t, "/custom-guide-repository", "user:1")

	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("cold transient failure = %d, want 503", rr.Code)
	}
	if rr.Header().Get("Retry-After") == "" {
		t.Error("expected Retry-After header on cold 503")
	}
}

func TestCustomGuide_ColdTerminalReturnsCapabilityFalse(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	withGuideLister(t, &fakeGuideLister{respond: func(string) (*customGuidePage, error) {
		return nil, &appPlatformUpstreamError{status: http.StatusForbidden, msg: "upstream 403"}
	}})

	rr, body := doCustomGuide(t, "/custom-guide-repository", "user:1")

	if rr.Code != http.StatusOK {
		t.Fatalf("cold terminal failure should be soft-200, got %d", rr.Code)
	}
	if body.Capability.Available || body.Capability.Reason != reasonBackendUnavailable {
		t.Errorf("expected capability false/backend-unavailable, got %+v", body.Capability)
	}
}

func TestCustomGuide_WarmCacheServesStaleOnUpstreamFailure(t *testing.T) {
	advance := withFrozenTime(t, time.Unix(1_700_000_000, 0))
	fail := false
	l := &fakeGuideLister{respond: func(string) (*customGuidePage, error) {
		if fail {
			return nil, &appPlatformUpstreamError{status: http.StatusServiceUnavailable, msg: "hiccup"}
		}
		return &customGuidePage{Entries: []customGuideRepositoryEntry{guideEntry("a", "A", "published", "guide")}, Continue: ""}, nil
	}}
	withGuideLister(t, l)

	_, warm := doCustomGuide(t, "/custom-guide-repository", "user:1")
	warmAsOf := warm.AsOf

	fail = true
	advance(customGuideCacheTTL + time.Second)
	rr, stale := doCustomGuide(t, "/custom-guide-repository", "user:1")

	if rr.Code != http.StatusOK || len(stale.Guides) != 1 {
		t.Fatalf("warm failure should serve stale 200 with data; got %d / %d guides", rr.Code, len(stale.Guides))
	}
	if stale.AsOf != warmAsOf {
		t.Errorf("stale serve asOf should reflect the original (stale) fill time: got %q want %q", stale.AsOf, warmAsOf)
	}
}

func TestCustomGuide_ColdOutageThrottledByCooldown(t *testing.T) {
	advance := withFrozenTime(t, time.Unix(1_700_000_000, 0))
	l := &fakeGuideLister{respond: func(string) (*customGuidePage, error) {
		return nil, &appPlatformUpstreamError{status: http.StatusServiceUnavailable, msg: "down"}
	}}
	withGuideLister(t, l)

	rr, _ := doCustomGuide(t, "/custom-guide-repository", "user:1")
	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("first cold failure = %d, want 503", rr.Code)
	}
	// Sequential requests INSIDE the cooldown window must not re-probe, yet
	// still return the sticky 503 so the client keeps its Retry-After semantics.
	for i := 0; i < 3; i++ {
		advance(time.Second)
		rr, _ := doCustomGuide(t, "/custom-guide-repository", "user:1")
		if rr.Code != http.StatusServiceUnavailable {
			t.Fatalf("throttled status = %d, want 503", rr.Code)
		}
	}
	if l.callCount() != 1 {
		t.Errorf("cooldown should suppress re-probes; got %d LISTs", l.callCount())
	}
	// After the cooldown, a re-probe is allowed.
	advance(customGuideFailureCooldown + time.Second)
	doCustomGuide(t, "/custom-guide-repository", "user:1")
	if l.callCount() != 2 {
		t.Errorf("expected a re-probe after the cooldown; got %d", l.callCount())
	}
}

// An identity-scoped (401/403) failure must NOT enter the shared negative
// cache: the next request still attempts upstream rather than replaying a
// sticky error that belongs to one caller's token.
func TestCustomGuide_IdentityScopedFailureNotCachedShared(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	var calls int32
	l := &fakeGuideLister{respond: func(string) (*customGuidePage, error) {
		n := atomic.AddInt32(&calls, 1)
		if n == 1 {
			return nil, &appPlatformUpstreamError{status: http.StatusForbidden, msg: "403 for this caller"}
		}
		return &customGuidePage{Entries: []customGuideRepositoryEntry{guideEntry("a", "A", "published", "guide")}, Continue: ""}, nil
	}}
	withGuideLister(t, l)

	doCustomGuide(t, "/custom-guide-repository", "user:1") // 403, must not be cached
	_, body := doCustomGuide(t, "/custom-guide-repository", "user:2")

	if !body.Capability.Available || len(body.Guides) != 1 {
		t.Fatalf("second caller should get a fresh attempt, not a cached 403; cap=%+v guides=%d", body.Capability, len(body.Guides))
	}
	if atomic.LoadInt32(&calls) != 2 {
		t.Errorf("expected the second request to re-attempt upstream, got %d LISTs", calls)
	}
}

// --- Identity + config gates -------------------------------------------------

func TestCustomGuide_MissingIdentityEnvelope(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	withGuideLister(t, singlePageGuideLister())

	r, _ := http.NewRequest(http.MethodGet, "/custom-guide-repository", nil) // no ID token
	ctx := backend.WithPluginContext(r.Context(), backend.PluginContext{Namespace: testNamespace})
	ctx = sdkconfig.WithGrafanaConfig(ctx, sdkconfig.NewGrafanaCfg(testGrafanaConfig()))
	rr, body := doCustomGuideReq(t, r.WithContext(ctx))

	if rr.Code != http.StatusOK {
		t.Fatalf("missing identity on a GET read should be soft-200, got %d", rr.Code)
	}
	if body.Capability.Available || body.Capability.Reason != reasonIdentityUnavailable {
		t.Errorf("expected capability false/identity-unavailable, got %+v", body.Capability)
	}
}

func TestCustomGuide_ExpiredOrExplessTokenRejected(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	withGuideLister(t, singlePageGuideLister(guideEntry("a", "A", "published", "guide")))
	app := newTestApp(t)

	cases := map[string]string{
		"no exp claim":  makeIDToken(t, "user:1", 0),
		"expired token": makeIDToken(t, "user:1", timeNow().Add(-time.Hour).Unix()),
	}
	for name, token := range cases {
		t.Run(name, func(t *testing.T) {
			r, _ := http.NewRequest(http.MethodGet, "/custom-guide-repository", nil)
			r.Header.Set(backend.GrafanaUserSignInTokenHeaderName, token)
			ctx := backend.WithPluginContext(r.Context(), backend.PluginContext{Namespace: testNamespace})
			ctx = sdkconfig.WithGrafanaConfig(ctx, sdkconfig.NewGrafanaCfg(testGrafanaConfig()))
			rec := httptest.NewRecorder()
			app.handleCustomGuideRepository(rec, r.WithContext(ctx))
			var body customGuideRepositoryResponse
			_ = json.Unmarshal(rec.Body.Bytes(), &body)
			if body.Capability.Available || body.Capability.Reason != reasonIdentityUnavailable {
				t.Errorf("%s: expected identity-unavailable, got %+v", name, body.Capability)
			}
		})
	}
}

func TestCustomGuide_ToggleOffStructurallyUnavailable(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	l := singlePageGuideLister()
	withGuideLister(t, l)

	cfg := map[string]string{sdkconfig.AppURL: "http://grafana.example"} // toggle absent
	rr, body := doCustomGuideReq(t, customGuideRequestWithConfig(t, "/custom-guide-repository", "user:1", cfg))

	if rr.Code != http.StatusOK {
		t.Fatalf("toggle-off should be soft-200, got %d", rr.Code)
	}
	if body.Capability.Available || body.Capability.Reason != reasonBackendUnavailable {
		t.Errorf("expected backend-unavailable, got %+v", body.Capability)
	}
	if l.callCount() != 0 {
		t.Errorf("structurally unavailable must not hit upstream; got %d LISTs", l.callCount())
	}
}

func TestCustomGuide_NoAppURLStructurallyUnavailable(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	l := singlePageGuideLister()
	withGuideLister(t, l)

	cfg := map[string]string{featuretoggles.EnabledFeatures: pathfinderBackendAggregationToggle} // no app URL
	_, body := doCustomGuideReq(t, customGuideRequestWithConfig(t, "/custom-guide-repository", "user:1", cfg))

	if body.Capability.Available || body.Capability.Reason != reasonBackendUnavailable {
		t.Errorf("expected backend-unavailable with no app URL, got %+v", body.Capability)
	}
	if l.callCount() != 0 {
		t.Errorf("structurally unavailable must not hit upstream; got %d LISTs", l.callCount())
	}
}

func TestCustomGuide_MethodNotAllowed(t *testing.T) {
	app := newTestApp(t)
	r, _ := http.NewRequest(http.MethodPost, "/custom-guide-repository", nil)
	rec := httptest.NewRecorder()
	app.handleCustomGuideRepository(rec, r)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("POST should be 405, got %d", rec.Code)
	}
}

// --- HTTP-level shaping (block-stripping through the real client) ------------

// Proves the headline behavior end-to-end through customGuideHTTPClient: full
// InteractiveGuide specs on the wire (blocks included) are shaped to slim
// entries with blocks dropped and the manifest (incl. depends) preserved.
func TestCustomGuideHTTPClient_StripsBlocksPreservesManifest(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"metadata": map[string]any{"continue": ""},
			"items": []map[string]any{
				{"spec": map[string]any{
					"id":     "fe-alerting-path",
					"title":  "Alerting enablement",
					"status": "published",
					"blocks": []map[string]any{{"type": "markdown", "content": "a very large cover body"}},
					"manifest": map[string]any{
						"type":       "path",
						"repository": "app-platform",
						"milestones": []string{"fe-alerting-01", "fe-alerting-02"},
						"depends":    []any{[]string{"fe-intro"}},
					},
				}},
			},
		})
	}))
	defer srv.Close()

	c := newCustomGuideHTTPClient(srv.URL, "id-token-abc", log.DefaultLogger)
	page, err := c.ListPage(context.Background(), testNamespace, "")
	if err != nil {
		t.Fatalf("ListPage: %v", err)
	}
	if len(page.Entries) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(page.Entries))
	}
	e := page.Entries[0]
	if e.ID != "fe-alerting-path" || e.Title != "Alerting enablement" || e.Status != "published" {
		t.Errorf("entry core fields not shaped: %+v", e)
	}
	if e.Manifest == nil || e.Manifest.Type != "path" || len(e.Manifest.Milestones) != 2 || len(e.Manifest.Depends) != 1 {
		t.Errorf("manifest not preserved through shaping: %+v", e.Manifest)
	}

	// The block content must not appear anywhere in the shaped, re-serialized entry.
	raw, _ := json.Marshal(e)
	if strings.Contains(string(raw), "a very large cover body") {
		t.Errorf("blocks leaked into the shaped entry: %s", raw)
	}
}
