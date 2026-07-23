package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	sdkconfig "github.com/grafana/grafana-plugin-sdk-go/config"
	"github.com/grafana/grafana-plugin-sdk-go/experimental/featuretoggles"
)

const testNamespace = "stacks-1"

// withFrozenTime (defined in package_recommendations_test.go) pins timeNow to
// `base` and returns a function that advances the frozen clock by a duration.

// fakeLister is an injectable completionRecordLister. respond maps an incoming
// continue token to a page or error; calls counts invocations.
type fakeLister struct {
	respond func(token string) (*completionRecordPage, error)
	calls   int32
}

func (f *fakeLister) ListPage(_ context.Context, _ string, token string) (*completionRecordPage, error) {
	atomic.AddInt32(&f.calls, 1)
	return f.respond(token)
}

func (f *fakeLister) callCount() int { return int(atomic.LoadInt32(&f.calls)) }

// singlePageLister serves all records in one page.
func singlePageLister(records ...completionRecordSpec) *fakeLister {
	return &fakeLister{respond: func(token string) (*completionRecordPage, error) {
		return &completionRecordPage{Records: records, Continue: ""}, nil
	}}
}

func withLister(t *testing.T, l completionRecordLister) {
	t.Helper()
	resetCompletionRecordsCache()
	prev := completionListerOverride
	completionListerOverride = l
	t.Cleanup(func() {
		completionListerOverride = prev
		resetCompletionRecordsCache()
	})
}

func rec(userID, guideSource, guideID, title, category, pathID, source, completedAt string, percent int64) completionRecordSpec {
	return completionRecordSpec{
		UserID:            userID,
		GuideID:           guideID,
		GuideSource:       guideSource,
		GuideTitle:        title,
		GuideCategory:     category,
		PathID:            pathID,
		Source:            source,
		CompletedAt:       completedAt,
		CompletionPercent: percent,
	}
}

// testGrafanaConfig is the healthy config: aggregation toggle on, app URL set.
func testGrafanaConfig() map[string]string {
	return map[string]string{
		featuretoggles.EnabledFeatures: pathfinderBackendAggregationToggle,
		sdkconfig.AppURL:               "http://grafana.example",
	}
}

// completionRequestWithConfig builds a GET request carrying an ID-token
// identity (with a valid future exp), a namespace in the plugin context, and
// the given Grafana config.
func completionRequestWithConfig(t *testing.T, target, sub string, cfg map[string]string) *http.Request {
	t.Helper()
	r, _ := http.NewRequest(http.MethodGet, target, nil)
	if sub != "" {
		r.Header.Set(backend.GrafanaUserSignInTokenHeaderName, makeIDToken(t, sub, timeNow().Add(time.Hour).Unix()))
	}
	ctx := backend.WithPluginContext(r.Context(), backend.PluginContext{Namespace: testNamespace})
	ctx = sdkconfig.WithGrafanaConfig(ctx, sdkconfig.NewGrafanaCfg(cfg))
	return r.WithContext(ctx)
}

func completionRequest(t *testing.T, target, sub string) *http.Request {
	t.Helper()
	return completionRequestWithConfig(t, target, sub, testGrafanaConfig())
}

func doMyCompletions(t *testing.T, target, sub string) (*httptest.ResponseRecorder, myCompletionsResponse) {
	t.Helper()
	return doMyCompletionsReq(t, completionRequest(t, target, sub))
}

func doMyCompletionsReq(t *testing.T, r *http.Request) (*httptest.ResponseRecorder, myCompletionsResponse) {
	t.Helper()
	app := newTestApp(t)
	rec := httptest.NewRecorder()
	app.handleMyCompletions(rec, r)
	var body myCompletionsResponse
	if rec.Body.Len() > 0 {
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode body: %v (raw: %s)", err, rec.Body.String())
		}
	}
	return rec, body
}

// --- Collation ---------------------------------------------------------------

func TestCollation_MultipleRecordsSameGuide(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	withLister(t, singlePageLister(
		rec("user:1", "bundled", "linux", "Linux Server Integration", "interactive", "", "objectives", "2026-07-19T10:00:00Z", 80),
		rec("user:1", "bundled", "linux", "Linux Server Integration", "interactive", "", "manual", "2026-07-20T14:02:11Z", 100),
		rec("user:1", "bundled", "linux", "Linux Server Integration", "interactive", "", "objectives", "2026-07-18T09:00:00Z", 60),
	))

	_, body := doMyCompletions(t, "/completion-records/my", "user:1")

	if !body.Capability.Available {
		t.Fatalf("expected capability available, got %+v", body.Capability)
	}
	if len(body.Completions) != 1 {
		t.Fatalf("expected 1 collated entry, got %d", len(body.Completions))
	}
	e := body.Completions[0]
	if e.Count != 3 {
		t.Errorf("count = %d, want 3", e.Count)
	}
	if e.LatestCompletedAt != "2026-07-20T14:02:11Z" {
		t.Errorf("latestCompletedAt = %q, want the newest record", e.LatestCompletedAt)
	}
	if e.LatestSource != "manual" {
		t.Errorf("latestSource = %q, want manual (source of the latest record)", e.LatestSource)
	}
	if e.MaxCompletionPercent != 100 {
		t.Errorf("maxCompletionPercent = %d, want 100", e.MaxCompletionPercent)
	}
	if e.GuideTitle != "Linux Server Integration" {
		t.Errorf("guideTitle = %q", e.GuideTitle)
	}
}

func TestCollation_DistinctGuidesSortedByLatestDescending(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	withLister(t, singlePageLister(
		rec("user:1", "bundled", "older", "Older", "interactive", "", "objectives", "2026-07-10T00:00:00Z", 100),
		rec("user:1", "app-platform", "newer", "Newer", "documentation", "path-1", "manual", "2026-07-21T00:00:00Z", 50),
	))

	_, body := doMyCompletions(t, "/completion-records/my", "user:1")

	if len(body.Completions) != 2 {
		t.Fatalf("expected 2 entries, got %d", len(body.Completions))
	}
	if body.Completions[0].GuideID != "newer" {
		t.Errorf("expected newest guide first, got %q", body.Completions[0].GuideID)
	}
	if body.Completions[0].PathID != "path-1" {
		t.Errorf("pathId snapshot = %q, want path-1", body.Completions[0].PathID)
	}
}

// Same guideId under different guideSource must NOT collapse — the durable
// identity is the (guideSource, guideId) pair.
func TestCollation_SameIdDifferentSourceNotMerged(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	withLister(t, singlePageLister(
		rec("user:1", "bundled", "x", "Bundled X", "interactive", "", "objectives", "2026-07-10T00:00:00Z", 100),
		rec("user:1", "remote-repo:acme", "x", "Remote X", "interactive", "", "objectives", "2026-07-11T00:00:00Z", 100),
	))

	_, body := doMyCompletions(t, "/completion-records/my", "user:1")
	if len(body.Completions) != 2 {
		t.Fatalf("expected 2 distinct entries by (source,id), got %d", len(body.Completions))
	}
}

func TestCollation_CrossUserIsolation(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	withLister(t, singlePageLister(
		rec("user:1", "bundled", "a", "A", "interactive", "", "objectives", "2026-07-10T00:00:00Z", 100),
		rec("user:2", "bundled", "b", "B", "interactive", "", "objectives", "2026-07-11T00:00:00Z", 100),
		rec("user:2", "bundled", "c", "C", "interactive", "", "objectives", "2026-07-12T00:00:00Z", 100),
	))

	_, body1 := doMyCompletions(t, "/completion-records/my", "user:1")
	if len(body1.Completions) != 1 || body1.Completions[0].GuideID != "a" {
		t.Fatalf("user:1 should see only its own record, got %+v", body1.Completions)
	}
	if body1.UserID != "user:1" {
		t.Errorf("userId echoed = %q, want user:1", body1.UserID)
	}

	_, body2 := doMyCompletions(t, "/completion-records/my", "user:2")
	if len(body2.Completions) != 2 {
		t.Fatalf("user:2 should see 2 records, got %d", len(body2.Completions))
	}
	for _, e := range body2.Completions {
		if e.GuideID == "a" {
			t.Fatalf("user:2 leaked user:1's record")
		}
	}
}

func TestMyCompletions_UnknownUserEmptyList(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	withLister(t, singlePageLister(
		rec("user:1", "bundled", "a", "A", "interactive", "", "objectives", "2026-07-10T00:00:00Z", 100),
	))
	rr, body := doMyCompletions(t, "/completion-records/my", "user:nobody")
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	if !body.Capability.Available {
		t.Errorf("capability should be available even with no records")
	}
	if body.Completions == nil {
		t.Errorf("completions must serialize as [], not null")
	}
	if len(body.Completions) != 0 {
		t.Errorf("expected empty completions, got %d", len(body.Completions))
	}
}

// --- Pagination --------------------------------------------------------------

func TestPagination_DrainsAllPages(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	pages := map[string]*completionRecordPage{
		"": {Records: []completionRecordSpec{
			rec("user:1", "bundled", "g1", "G1", "interactive", "", "objectives", "2026-07-10T00:00:00Z", 100),
		}, Continue: "tok-2"},
		"tok-2": {Records: []completionRecordSpec{
			rec("user:1", "bundled", "g2", "G2", "interactive", "", "objectives", "2026-07-11T00:00:00Z", 100),
		}, Continue: "tok-3"},
		"tok-3": {Records: []completionRecordSpec{
			rec("user:1", "bundled", "g3", "G3", "interactive", "", "objectives", "2026-07-12T00:00:00Z", 100),
		}, Continue: ""},
	}
	l := &fakeLister{respond: func(token string) (*completionRecordPage, error) {
		p, ok := pages[token]
		if !ok {
			return nil, fmt.Errorf("unexpected continue token %q", token)
		}
		return p, nil
	}}
	withLister(t, l)

	_, body := doMyCompletions(t, "/completion-records/my", "user:1")
	if len(body.Completions) != 3 {
		t.Fatalf("expected 3 entries drained across pages, got %d", len(body.Completions))
	}
	if l.callCount() != 3 {
		t.Errorf("expected 3 ListPage calls, got %d", l.callCount())
	}
}

// The aggregate budget bounds a drain across pages — the per-page byte cap
// alone does not bound total memory. Truncation stops the drain (loudly, via
// a Warn log) instead of listing forever.
func TestPagination_AggregateBudgetStopsDrain(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	prevMax := completionListMaxTotalRecords
	completionListMaxTotalRecords = 2
	t.Cleanup(func() { completionListMaxTotalRecords = prevMax })

	page := 0
	l := &fakeLister{respond: func(token string) (*completionRecordPage, error) {
		page++
		return &completionRecordPage{
			Records: []completionRecordSpec{
				rec("user:1", "bundled", fmt.Sprintf("g%d", page), "G", "interactive", "", "objectives", "2026-07-10T00:00:00Z", 100),
			},
			Continue: fmt.Sprintf("tok-%d", page+1), // never drains naturally
		}, nil
	}}
	withLister(t, l)

	_, body := doMyCompletions(t, "/completion-records/my", "user:1")
	if l.callCount() != 2 {
		t.Fatalf("expected the drain to stop at the aggregate budget (2 pages), got %d calls", l.callCount())
	}
	if len(body.Completions) != 2 {
		t.Fatalf("expected the truncated index to serve 2 entries, got %d", len(body.Completions))
	}
}

// --- Cache -------------------------------------------------------------------

func TestCache_WithinTTLServesFromCacheNoUpstream(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	l := singlePageLister(rec("user:1", "bundled", "a", "A", "interactive", "", "objectives", "2026-07-10T00:00:00Z", 100))
	withLister(t, l)

	doMyCompletions(t, "/completion-records/my", "user:1")
	doMyCompletions(t, "/completion-records/my", "user:1")
	doMyCompletions(t, "/completion-records/my", "user:2")

	if l.callCount() != 1 {
		t.Fatalf("expected single upstream LIST within TTL, got %d", l.callCount())
	}
}

func TestCache_TTLExpiryTriggersRefresh(t *testing.T) {
	advance := withFrozenTime(t, time.Unix(1_700_000_000, 0))
	l := singlePageLister(rec("user:1", "bundled", "a", "A", "interactive", "", "objectives", "2026-07-10T00:00:00Z", 100))
	withLister(t, l)

	doMyCompletions(t, "/completion-records/my", "user:1")
	advance(completionCacheTTL + time.Second)
	doMyCompletions(t, "/completion-records/my", "user:1")

	if l.callCount() != 2 {
		t.Fatalf("expected refresh after TTL, got %d calls", l.callCount())
	}
}

func TestCache_Singleflight(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	started := make(chan struct{})
	release := make(chan struct{})
	var once sync.Once
	l := &fakeLister{respond: func(token string) (*completionRecordPage, error) {
		once.Do(func() { close(started) })
		<-release
		return &completionRecordPage{Records: []completionRecordSpec{
			rec("user:1", "bundled", "a", "A", "interactive", "", "objectives", "2026-07-10T00:00:00Z", 100),
		}}, nil
	}}
	withLister(t, l)

	const n = 8
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _ = getCompletionIndex(context.Background(), testNamespace, l, false, log.DefaultLogger)
		}()
	}
	<-started
	close(release)
	wg.Wait()

	if l.callCount() != 1 {
		t.Fatalf("singleflight should collapse %d concurrent misses to 1 LIST, got %d", n, l.callCount())
	}
}

func TestCache_InvalidationFencesInFlightRefresh(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	firstStarted := make(chan struct{})
	releaseFirst := make(chan struct{})
	var calls atomic.Int32
	l := &fakeLister{respond: func(token string) (*completionRecordPage, error) {
		if calls.Add(1) == 1 {
			close(firstStarted)
			<-releaseFirst
			return &completionRecordPage{Records: []completionRecordSpec{
				rec("user:1", "bundled", "old", "Old", "interactive", "", "objectives", "2026-07-10T00:00:00Z", 100),
			}}, nil
		}
		return &completionRecordPage{Records: []completionRecordSpec{
			rec("user:1", "bundled", "new", "New", "interactive", "", "objectives", "2026-07-10T01:00:00Z", 100),
		}}, nil
	}}
	resetCompletionRecordsCache()
	t.Cleanup(resetCompletionRecordsCache)

	firstDone := make(chan struct{})
	go func() {
		defer close(firstDone)
		_, _ = getCompletionIndex(context.Background(), testNamespace, l, false, log.DefaultLogger)
	}()
	<-firstStarted

	invalidateCompletionIndex(testNamespace)
	fresh, err := getCompletionIndex(context.Background(), testNamespace, l, false, log.DefaultLogger)
	if err != nil {
		t.Fatalf("post-invalidation refresh: %v", err)
	}
	if got := fresh.byUser["user:1"][0].GuideID; got != "new" {
		t.Fatalf("post-invalidation guide = %q, want new", got)
	}

	close(releaseFirst)
	<-firstDone

	cached, err := getCompletionIndex(context.Background(), testNamespace, l, false, log.DefaultLogger)
	if err != nil {
		t.Fatalf("cached read: %v", err)
	}
	if got := cached.byUser["user:1"][0].GuideID; got != "new" {
		t.Fatalf("stale in-flight refresh replaced the cache with %q", got)
	}
	if got := calls.Load(); got != 2 {
		t.Fatalf("LIST calls = %d, want 2", got)
	}
}

func TestCache_ForcedRefreshBypassAndRateLimit(t *testing.T) {
	advance := withFrozenTime(t, time.Unix(1_700_000_000, 0))
	l := singlePageLister(rec("user:1", "bundled", "a", "A", "interactive", "", "objectives", "2026-07-10T00:00:00Z", 100))
	withLister(t, l)

	// Warm the cache.
	doMyCompletions(t, "/completion-records/my", "user:1")
	if l.callCount() != 1 {
		t.Fatalf("warm-up expected 1 call, got %d", l.callCount())
	}

	// ?refresh=1 bypasses the fresh cache → second LIST.
	doMyCompletions(t, "/completion-records/my?refresh=1", "user:1")
	if l.callCount() != 2 {
		t.Fatalf("forced refresh should bypass cache, got %d calls", l.callCount())
	}

	// A second forced refresh within the rate-limit window is ignored (served
	// from the still-fresh cache) → no new LIST.
	doMyCompletions(t, "/completion-records/my?refresh=1", "user:1")
	if l.callCount() != 2 {
		t.Fatalf("forced refresh rate limit should hold within window, got %d calls", l.callCount())
	}

	// After the window, a forced refresh is honoured again.
	advance(completionForcedRefreshInterval + time.Second)
	doMyCompletions(t, "/completion-records/my?refresh=1", "user:1")
	if l.callCount() != 3 {
		t.Fatalf("forced refresh should be allowed after the window, got %d calls", l.callCount())
	}
}

// --- Error paths -------------------------------------------------------------

func TestErrors_ColdTransientReturns503WithRetryAfter(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	l := &fakeLister{respond: func(token string) (*completionRecordPage, error) {
		return nil, &appPlatformUpstreamError{status: http.StatusServiceUnavailable, msg: "upstream 503"}
	}}
	withLister(t, l)

	rr, _ := doMyCompletions(t, "/completion-records/my", "user:1")
	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rr.Code)
	}
	if rr.Header().Get("Retry-After") == "" {
		t.Errorf("expected Retry-After header on cold 503")
	}
}

func TestErrors_ColdTerminalReturnsCapabilityFalse(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	l := &fakeLister{respond: func(token string) (*completionRecordPage, error) {
		return nil, &appPlatformUpstreamError{status: http.StatusForbidden, msg: "upstream 403"}
	}}
	withLister(t, l)

	rr, body := doMyCompletions(t, "/completion-records/my", "user:1")
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 for terminal cold error", rr.Code)
	}
	if body.Capability.Available {
		t.Errorf("expected capability false for terminal cold error")
	}
	if body.Capability.Reason != reasonBackendUnavailable {
		t.Errorf("reason = %q, want %q", body.Capability.Reason, reasonBackendUnavailable)
	}
}

func TestErrors_WarmCacheServesStaleOnUpstreamFailure(t *testing.T) {
	advance := withFrozenTime(t, time.Unix(1_700_000_000, 0))
	var fail atomic.Bool
	l := &fakeLister{respond: func(token string) (*completionRecordPage, error) {
		if fail.Load() {
			return nil, &appPlatformUpstreamError{status: http.StatusServiceUnavailable, msg: "hiccup"}
		}
		return &completionRecordPage{Records: []completionRecordSpec{
			rec("user:1", "bundled", "a", "A", "interactive", "", "objectives", "2026-07-10T00:00:00Z", 100),
		}}, nil
	}}
	withLister(t, l)

	// Warm the cache successfully.
	_, warm := doMyCompletions(t, "/completion-records/my", "user:1")
	warmAsOf := warm.AsOf
	if len(warm.Completions) != 1 {
		t.Fatalf("warm-up expected 1 entry, got %d", len(warm.Completions))
	}

	// Expire the cache, then make the upstream fail. Stale index should serve.
	fail.Store(true)
	advance(completionCacheTTL + time.Second)

	rr, stale := doMyCompletions(t, "/completion-records/my", "user:1")
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (stale serve)", rr.Code)
	}
	if !stale.Capability.Available {
		t.Errorf("stale serve should still report capability available")
	}
	if len(stale.Completions) != 1 {
		t.Fatalf("stale serve should return cached entries, got %d", len(stale.Completions))
	}
	if stale.AsOf != warmAsOf {
		t.Errorf("asOf should reflect true (stale) age %q, got %q", warmAsOf, stale.AsOf)
	}
}

func TestErrors_ColdOutageThrottledByCooldown(t *testing.T) {
	advance := withFrozenTime(t, time.Unix(1_700_000_000, 0))
	l := &fakeLister{respond: func(token string) (*completionRecordPage, error) {
		return nil, &appPlatformUpstreamError{status: http.StatusServiceUnavailable, msg: "down"}
	}}
	withLister(t, l)

	// First cold request probes upstream and 503s.
	rr, _ := doMyCompletions(t, "/completion-records/my", "user:1")
	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("first status = %d, want 503", rr.Code)
	}
	if l.callCount() != 1 {
		t.Fatalf("expected 1 upstream LIST, got %d", l.callCount())
	}

	// Sequential requests inside the cooldown must NOT re-probe upstream, yet
	// still return 503 (the sticky transient error) so the client keeps its
	// Retry-After semantics.
	for i := 0; i < 3; i++ {
		advance(time.Second)
		rr, _ := doMyCompletions(t, "/completion-records/my", "user:1")
		if rr.Code != http.StatusServiceUnavailable {
			t.Fatalf("throttled status = %d, want 503", rr.Code)
		}
	}
	if l.callCount() != 1 {
		t.Fatalf("cooldown should suppress re-probes, got %d LIST calls", l.callCount())
	}

	// After the cooldown elapses, the next request probes again.
	advance(completionFailureCooldown + time.Second)
	doMyCompletions(t, "/completion-records/my", "user:1")
	if l.callCount() != 2 {
		t.Fatalf("expected a re-probe after cooldown, got %d LIST calls", l.callCount())
	}
}

// A namespace-global terminal error (404: the kind isn't served here) IS
// eligible for the shared cooldown — unlike identity-scoped 401/403.
func TestErrors_ColdTerminalThrottledStaysCapabilityFalse(t *testing.T) {
	advance := withFrozenTime(t, time.Unix(1_700_000_000, 0))
	l := &fakeLister{respond: func(token string) (*completionRecordPage, error) {
		return nil, &appPlatformUpstreamError{status: http.StatusNotFound, msg: "404"}
	}}
	withLister(t, l)

	rr, body := doMyCompletions(t, "/completion-records/my", "user:1")
	if rr.Code != http.StatusOK || body.Capability.Available {
		t.Fatalf("first terminal cold error should yield capability=false 200, got %d %+v", rr.Code, body.Capability)
	}

	// A throttled re-request must replay the terminal error (capability=false),
	// not degrade to a transient 503, and must not re-probe upstream.
	advance(time.Second)
	rr, body = doMyCompletions(t, "/completion-records/my", "user:1")
	if rr.Code != http.StatusOK || body.Capability.Available {
		t.Fatalf("throttled terminal error should stay capability=false 200, got %d %+v", rr.Code, body.Capability)
	}
	if body.Capability.Reason != reasonBackendUnavailable {
		t.Errorf("reason = %q, want %q", body.Capability.Reason, reasonBackendUnavailable)
	}
	if l.callCount() != 1 {
		t.Fatalf("cooldown should suppress re-probes, got %d LIST calls", l.callCount())
	}
}

// An identity-scoped failure (401/403 for one caller's forwarded token) must
// never enter the shared negative cache: caller A's denied token must not
// become a cached error served to caller B (or throttle B's own probe).
func TestErrors_IdentityScopedFailureNotCachedShared(t *testing.T) {
	advance := withFrozenTime(t, time.Unix(1_700_000_000, 0))
	l := &fakeLister{respond: func(token string) (*completionRecordPage, error) {
		return nil, &appPlatformUpstreamError{status: http.StatusForbidden, msg: "403 for this caller"}
	}}
	withLister(t, l)

	rr, body := doMyCompletions(t, "/completion-records/my", "user:a")
	if rr.Code != http.StatusOK || body.Capability.Available {
		t.Fatalf("caller A: expected capability=false 200, got %d %+v", rr.Code, body.Capability)
	}
	if l.callCount() != 1 {
		t.Fatalf("expected 1 upstream LIST, got %d", l.callCount())
	}

	// Caller B one second later: the 403 was per-request, so B gets its own
	// upstream probe rather than A's cached denial.
	advance(time.Second)
	rr, body = doMyCompletions(t, "/completion-records/my", "user:b")
	if rr.Code != http.StatusOK || body.Capability.Available {
		t.Fatalf("caller B: expected capability=false 200, got %d %+v", rr.Code, body.Capability)
	}
	if l.callCount() != 2 {
		t.Fatalf("identity-scoped failure must not be cached shared: expected a fresh probe for caller B, got %d LIST calls", l.callCount())
	}
}

func TestErrors_WarmStaleOutageThrottledByCooldown(t *testing.T) {
	advance := withFrozenTime(t, time.Unix(1_700_000_000, 0))
	var fail atomic.Bool
	l := &fakeLister{respond: func(token string) (*completionRecordPage, error) {
		if fail.Load() {
			return nil, &appPlatformUpstreamError{status: http.StatusServiceUnavailable, msg: "hiccup"}
		}
		return &completionRecordPage{Records: []completionRecordSpec{
			rec("user:1", "bundled", "a", "A", "interactive", "", "objectives", "2026-07-10T00:00:00Z", 100),
		}}, nil
	}}
	withLister(t, l)

	// Warm the cache, then expire it and start the outage.
	doMyCompletions(t, "/completion-records/my", "user:1")
	if l.callCount() != 1 {
		t.Fatalf("warm-up expected 1 call, got %d", l.callCount())
	}
	fail.Store(true)
	advance(completionCacheTTL + time.Second)

	// First expired request probes once, fails, and serves stale.
	_, stale := doMyCompletions(t, "/completion-records/my", "user:1")
	if len(stale.Completions) != 1 {
		t.Fatalf("expected stale serve of 1 entry, got %d", len(stale.Completions))
	}
	if l.callCount() != 2 {
		t.Fatalf("expected the outage probe, got %d LIST calls", l.callCount())
	}

	// Subsequent requests inside the cooldown keep serving stale without
	// re-probing the struggling upstream.
	for i := 0; i < 3; i++ {
		advance(time.Second)
		_, s := doMyCompletions(t, "/completion-records/my", "user:1")
		if len(s.Completions) != 1 {
			t.Fatalf("throttled stale serve should return cached entries, got %d", len(s.Completions))
		}
	}
	if l.callCount() != 2 {
		t.Fatalf("cooldown should suppress re-probes during a warm outage, got %d LIST calls", l.callCount())
	}

	// Once the cooldown elapses and upstream recovers, a normal refresh resumes.
	fail.Store(false)
	advance(completionFailureCooldown + time.Second)
	doMyCompletions(t, "/completion-records/my", "user:1")
	if l.callCount() != 3 {
		t.Fatalf("expected a successful refresh after cooldown, got %d LIST calls", l.callCount())
	}
}

// --- Identity at the route level --------------------------------------------

func TestMyCompletions_IdentityUnavailableEnvelope(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	withLister(t, singlePageLister())

	rr, body := doMyCompletions(t, "/completion-records/my", "") // no ID token
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	if body.Capability.Available {
		t.Errorf("expected capability false with no identity")
	}
	if body.Capability.Reason != reasonIdentityUnavailable {
		t.Errorf("reason = %q, want %q", body.Capability.Reason, reasonIdentityUnavailable)
	}
	if body.UserID != "" {
		t.Errorf("userId must be absent when identity unavailable, got %q", body.UserID)
	}
	if body.Completions == nil {
		t.Errorf("completions must serialize as []")
	}
}

// --- Config resolution (structural unavailability) ---------------------------

// The feature toggle and app URL are resolved BEFORE the test-only lister
// override, so these branches stay real: toggle off / missing app URL is a
// structural "never works here", served in-band with no upstream call.
func TestMyCompletions_ToggleOffStructurallyUnavailable(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	l := singlePageLister()
	withLister(t, l)

	cfg := map[string]string{sdkconfig.AppURL: "http://grafana.example"} // toggle absent
	rr, body := doMyCompletionsReq(t, completionRequestWithConfig(t, "/completion-records/my", "user:1", cfg))
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	if body.Capability.Available || body.Capability.Reason != reasonBackendUnavailable {
		t.Fatalf("expected capability=false %q, got %+v", reasonBackendUnavailable, body.Capability)
	}
	if l.callCount() != 0 {
		t.Fatalf("structural unavailability must not hit upstream, got %d calls", l.callCount())
	}
}

func TestMyCompletions_NoAppURLStructurallyUnavailable(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	l := singlePageLister()
	withLister(t, l)

	cfg := map[string]string{featuretoggles.EnabledFeatures: pathfinderBackendAggregationToggle} // no app URL
	rr, body := doMyCompletionsReq(t, completionRequestWithConfig(t, "/completion-records/my", "user:1", cfg))
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	if body.Capability.Available || body.Capability.Reason != reasonBackendUnavailable {
		t.Fatalf("expected capability=false %q, got %+v", reasonBackendUnavailable, body.Capability)
	}
	if l.callCount() != 0 {
		t.Fatalf("structural unavailability must not hit upstream, got %d calls", l.callCount())
	}
}

// --- Capability probe --------------------------------------------------------

func doCapability(t *testing.T, sub string) (*httptest.ResponseRecorder, completionCapability) {
	t.Helper()
	app := newTestApp(t)
	rr := httptest.NewRecorder()
	app.handleCompletionCapability(rr, completionRequest(t, "/completion-records/capability", sub))
	var cap completionCapability
	if rr.Body.Len() > 0 && rr.Code == http.StatusOK {
		if err := json.Unmarshal(rr.Body.Bytes(), &cap); err != nil {
			t.Fatalf("decode: %v (raw %s)", err, rr.Body.String())
		}
	}
	return rr, cap
}

func TestCapability_AvailableWhenUpstreamAnswers(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	withLister(t, singlePageLister())
	rr, cap := doCapability(t, "user:1")
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	if !cap.Available {
		t.Errorf("expected available, got %+v", cap)
	}
}

func TestCapability_IdentityUnavailable(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	withLister(t, singlePageLister())
	_, cap := doCapability(t, "")
	if cap.Available {
		t.Errorf("expected unavailable with no identity")
	}
	if cap.Reason != reasonIdentityUnavailable {
		t.Errorf("reason = %q, want %q", cap.Reason, reasonIdentityUnavailable)
	}
}

// The probe makes the same transient/terminal distinction as the data route:
// a cold transient blip is a 503 hiccup, NOT available=false — otherwise a
// 30-second hiccup would grey out the feature for everyone.
func TestCapability_ColdTransientFailureIs503NotUnavailable(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	l := &fakeLister{respond: func(token string) (*completionRecordPage, error) {
		return nil, &appPlatformUpstreamError{status: http.StatusServiceUnavailable, msg: "down"}
	}}
	withLister(t, l)
	rr, _ := doCapability(t, "user:1")
	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503 for a cold transient blip", rr.Code)
	}
	if rr.Header().Get("Retry-After") == "" {
		t.Errorf("expected Retry-After header on transient probe failure")
	}
}

func TestCapability_ColdTerminalFailureUnavailable(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	l := &fakeLister{respond: func(token string) (*completionRecordPage, error) {
		return nil, &appPlatformUpstreamError{status: http.StatusNotFound, msg: "not served here"}
	}}
	withLister(t, l)
	rr, cap := doCapability(t, "user:1")
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 for terminal probe failure", rr.Code)
	}
	if cap.Available {
		t.Errorf("expected unavailable when upstream terminally fails")
	}
	if cap.Reason != reasonBackendUnavailable {
		t.Errorf("reason = %q, want %q", cap.Reason, reasonBackendUnavailable)
	}
}
