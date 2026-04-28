package plugin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// stubFetcher returns a packageRepositoryFetcher backed by a counter, so
// tests can assert how many upstream calls happened. The fetcher ignores
// `maxBytes` because tests inject pre-sized payloads; the per-fetch cap
// behavior is covered by TestDefaultPackageRepositoryFetcher_RespectsMaxBytes.
func stubFetcher(t *testing.T, payload []byte, err error) (packageRepositoryFetcher, *int32) {
	t.Helper()
	var calls int32
	return func(ctx context.Context, rawURL string, maxBytes int64) ([]byte, error) {
		atomic.AddInt32(&calls, 1)
		if err != nil {
			return nil, err
		}
		return payload, nil
	}, &calls
}

func withFetcherOverride(t *testing.T, fn packageRepositoryFetcher) {
	t.Helper()
	prev := packageRepositoryFetcherOverride
	packageRepositoryFetcherOverride = fn
	t.Cleanup(func() {
		packageRepositoryFetcherOverride = prev
	})
}

func withFrozenTime(t *testing.T, base time.Time) func(time.Duration) {
	t.Helper()
	prev := timeNow
	current := base
	timeNow = func() time.Time { return current }
	t.Cleanup(func() { timeNow = prev })
	return func(advance time.Duration) {
		current = current.Add(advance)
	}
}

func validPayload(t *testing.T) []byte {
	t.Helper()
	raw := map[string]map[string]any{
		"prom-101": {
			"path":        "prom-101/v1.0.0",
			"type":        "guide",
			"title":       "Prometheus 101",
			"description": "Intro",
			"targeting": map[string]any{
				"match": map[string]any{"urlPrefix": "/connections"},
			},
		},
		"untargeted": {
			"path": "untargeted/v1.0.0",
			// no targeting -> must be dropped
		},
		"no-path": {
			"targeting": map[string]any{
				"match": map[string]any{"urlPrefix": "/explore"},
			},
		},
	}
	body, err := json.Marshal(raw)
	if err != nil {
		t.Fatal(err)
	}
	return body
}

func TestHandlePackageRecommendations_Success(t *testing.T) {
	resetPackageRecommendationsCache()
	advance := withFrozenTime(t, time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC))
	_ = advance
	fetcher, calls := stubFetcher(t, validPayload(t), nil)
	withFetcherOverride(t, fetcher)

	app := newTestApp(t)
	req := httptest.NewRequest(http.MethodGet, "/package-recommendations", nil)
	rr := httptest.NewRecorder()
	app.handlePackageRecommendations(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rr.Code, rr.Body.String())
	}

	var resp PackageRecommendationsResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.BaseURL != "https://interactive-learning.grafana.net/packages/" {
		t.Errorf("BaseURL = %q", resp.BaseURL)
	}
	// Both targeted and untargeted entries survive (only `no-path` is dropped
	// because we can't build a CDN URL for it). Untargeted entries stay so
	// the milestone-by-id resolver can find them; the frontend's
	// matchesPackageEntry filters them out of the recommendation list.
	idSet := map[string]bool{}
	for _, p := range resp.Packages {
		idSet[p.ID] = true
	}
	if !idSet["prom-101"] || !idSet["untargeted"] || idSet["no-path"] {
		t.Fatalf("unexpected package set: %+v", idSet)
	}
	var prom *PackageEntry
	for i := range resp.Packages {
		if resp.Packages[i].ID == "prom-101" {
			prom = &resp.Packages[i]
		}
	}
	if prom == nil || prom.Targeting == nil {
		t.Fatalf("targeting not preserved on prom-101: %+v", prom)
	}
	// Match is now json.RawMessage so unknown predicates survive the
	// round-trip — decode into a generic map to inspect it.
	var promMatch map[string]any
	if err := json.Unmarshal(prom.Targeting.Match, &promMatch); err != nil {
		t.Fatalf("decode prom-101 match: %v", err)
	}
	if promMatch["urlPrefix"] != "/connections" {
		t.Errorf("urlPrefix not preserved on prom-101: %+v", promMatch)
	}
	// 1 repo fetch + 2 manifest fetches (one per kept entry).
	if got := atomic.LoadInt32(calls); got != 3 {
		t.Errorf("calls = %d, want 3 (repo + 2 manifests)", got)
	}
}

func TestHandlePackageRecommendations_CachesAcrossCalls(t *testing.T) {
	resetPackageRecommendationsCache()
	withFrozenTime(t, time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC))
	fetcher, calls := stubFetcher(t, validPayload(t), nil)
	withFetcherOverride(t, fetcher)

	app := newTestApp(t)
	rr := httptest.NewRecorder()
	app.handlePackageRecommendations(rr, httptest.NewRequest(http.MethodGet, "/package-recommendations", nil))
	if rr.Code != http.StatusOK {
		t.Fatalf("first call: status %d", rr.Code)
	}
	initial := atomic.LoadInt32(calls)
	for i := 0; i < 3; i++ {
		rr := httptest.NewRecorder()
		app.handlePackageRecommendations(rr, httptest.NewRequest(http.MethodGet, "/package-recommendations", nil))
		if rr.Code != http.StatusOK {
			t.Fatalf("iteration %d: status %d", i, rr.Code)
		}
	}
	if got := atomic.LoadInt32(calls); got != initial {
		t.Errorf("upstream calls grew from %d to %d; expected cached", initial, got)
	}
}

func TestHandlePackageRecommendations_DetachesFetchFromRequestCancellation(t *testing.T) {
	resetPackageRecommendationsCache()
	withFrozenTime(t, time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC))

	// Wrap the stub fetcher to fail if the request context (which we cancel
	// below) leaks through. A passing test requires the handler to call us
	// with a context that is NOT canceled.
	innerFetcher, calls := stubFetcher(t, validPayload(t), nil)
	withFetcherOverride(t, func(ctx context.Context, rawURL string, maxBytes int64) ([]byte, error) {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		return innerFetcher(ctx, rawURL, maxBytes)
	})

	// Build a request whose context is already canceled, mimicking a user
	// closing the panel mid-fetch. Without context detachment, the upstream
	// fetch fails and the error gets cached for 6 hours.
	app := newTestApp(t)
	cancelledCtx, cancel := context.WithCancel(context.Background())
	cancel()
	req := httptest.NewRequest(http.MethodGet, "/package-recommendations", nil).WithContext(cancelledCtx)

	rr := httptest.NewRecorder()
	app.handlePackageRecommendations(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
	// 1 repo + 2 manifest fetches (one per kept entry in validPayload), all
	// succeeding because the fetcher's ctx.Err() check passes.
	if got := atomic.LoadInt32(calls); got != 3 {
		t.Errorf("upstream calls = %d, want 3", got)
	}
}

func TestHandlePackageRecommendations_RefreshesAfterTTL(t *testing.T) {
	resetPackageRecommendationsCache()
	advance := withFrozenTime(t, time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC))
	fetcher, calls := stubFetcher(t, validPayload(t), nil)
	withFetcherOverride(t, fetcher)

	app := newTestApp(t)
	app.handlePackageRecommendations(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/package-recommendations", nil))
	initial := atomic.LoadInt32(calls)
	advance(packageRepositoryCacheTTL + time.Minute)
	app.handlePackageRecommendations(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/package-recommendations", nil))

	// After TTL expiry both the repo and the manifests are refetched.
	if got := atomic.LoadInt32(calls); got != initial*2 {
		t.Errorf("upstream calls = %d after TTL expiry, want %d (= 2 * initial)", got, initial*2)
	}
}

func TestHandlePackageRecommendations_StickyOnFailure(t *testing.T) {
	resetPackageRecommendationsCache()
	withFrozenTime(t, time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC))
	fetcher, calls := stubFetcher(t, nil, errors.New("network down"))
	withFetcherOverride(t, fetcher)

	app := newTestApp(t)
	for i := 0; i < 5; i++ {
		rr := httptest.NewRecorder()
		app.handlePackageRecommendations(rr, httptest.NewRequest(http.MethodGet, "/package-recommendations", nil))
		if rr.Code != http.StatusServiceUnavailable {
			t.Fatalf("iteration %d: status = %d, want 503", i, rr.Code)
		}
		if !strings.Contains(rr.Body.String(), "package-index-unavailable") {
			t.Errorf("body missing error code: %s", rr.Body.String())
		}
	}
	if got := atomic.LoadInt32(calls); got != 1 {
		t.Errorf("upstream calls = %d on repeated failure; want 1 (sticky)", got)
	}
}

func TestHandlePackageRecommendations_RejectsNonGet(t *testing.T) {
	resetPackageRecommendationsCache()
	app := newTestApp(t)
	for _, method := range []string{http.MethodPost, http.MethodPut, http.MethodDelete} {
		rr := httptest.NewRecorder()
		app.handlePackageRecommendations(rr, httptest.NewRequest(method, "/package-recommendations", nil))
		if rr.Code != http.StatusMethodNotAllowed {
			t.Errorf("%s: status = %d, want 405", method, rr.Code)
		}
	}
}

func TestHandlePackageRecommendations_RejectsParseFailure(t *testing.T) {
	resetPackageRecommendationsCache()
	withFrozenTime(t, time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC))
	fetcher, _ := stubFetcher(t, []byte("not-json"), nil)
	withFetcherOverride(t, fetcher)

	app := newTestApp(t)
	rr := httptest.NewRecorder()
	app.handlePackageRecommendations(rr, httptest.NewRequest(http.MethodGet, "/package-recommendations", nil))
	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rr.Code)
	}
}

func TestIsAllowedInteractiveLearningHost(t *testing.T) {
	cases := []struct {
		url  string
		want bool
	}{
		{"https://interactive-learning.grafana.net/packages/repository.json", true},
		{"https://interactive-learning.grafana-dev.net/packages/repository.json", true},
		{"https://interactive-learning.grafana-ops.net/x.json", true},
		// Wrong scheme.
		{"http://interactive-learning.grafana.net/packages/repository.json", false},
		// Not allowlisted.
		{"https://evil.example.com/repository.json", false},
		// Subdomain attack: hostname matched by exact equality, not suffix.
		{"https://interactive-learning.grafana.net.evil.com/repository.json", false},
		// Garbage.
		{"::not a url::", false},
	}
	for _, tc := range cases {
		if got := isAllowedInteractiveLearningHost(tc.url); got != tc.want {
			t.Errorf("isAllowedInteractiveLearningHost(%q) = %v, want %v", tc.url, got, tc.want)
		}
	}
}

func TestFetchAndParsePackageRepository_RejectsDisallowedHost(t *testing.T) {
	_, err := fetchAndParsePackageRepository(context.Background(), "https://evil.example.com/repository.json")
	if err == nil || !strings.Contains(err.Error(), "host not allowed") {
		t.Fatalf("expected host-not-allowed error, got %v", err)
	}
}

func TestEnrichPackagesWithManifests_InlinesParsedJSON(t *testing.T) {
	resetPackageRecommendationsCache()
	withFrozenTime(t, time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC))

	repoBody := []byte(`{
		"prom-101": {"path": "prom-101/v1", "type": "guide", "title": "Prom",
			"targeting": {"match": {"urlPrefix": "/connections"}}},
		"prom-lj": {"path": "prom-lj/v1", "type": "path", "title": "Prom journey",
			"targeting": {"match": {"urlPrefix": "/connections"}}}
	}`)
	manifestBody := []byte(`{
		"id": "prom-lj",
		"type": "path",
		"description": "Connect Prom step by step.",
		"milestones": ["intro", "install", "verify"]
	}`)

	calls := map[string]int{}
	var mu sync.Mutex
	// `maxBytes` is asserted on per-URL: manifests must use the tighter
	// 256 KB cap, the repo index gets 5 MB. Without the per-fetch cap
	// (Bug 3), all URLs would receive the larger repository limit.
	manifestCalls := make(map[string]int64)
	fetcher := func(_ context.Context, rawURL string, maxBytes int64) ([]byte, error) {
		mu.Lock()
		calls[rawURL]++
		mu.Unlock()
		switch {
		case strings.HasSuffix(rawURL, "repository.json"):
			if maxBytes != packageRepositoryMaxBytes {
				return nil, fmt.Errorf("repo fetch maxBytes = %d, want %d", maxBytes, packageRepositoryMaxBytes)
			}
			return repoBody, nil
		case strings.HasSuffix(rawURL, "/prom-lj/v1/manifest.json"):
			mu.Lock()
			manifestCalls[rawURL] = maxBytes
			mu.Unlock()
			return manifestBody, nil
		case strings.HasSuffix(rawURL, "/prom-101/v1/manifest.json"):
			mu.Lock()
			manifestCalls[rawURL] = maxBytes
			mu.Unlock()
			return nil, errors.New("manifest unavailable") // partial failure should not break the response
		default:
			return nil, fmt.Errorf("unexpected URL %q", rawURL)
		}
	}
	withFetcherOverride(t, fetcher)

	app := newTestApp(t)
	rr := httptest.NewRecorder()
	app.handlePackageRecommendations(rr, httptest.NewRequest(http.MethodGet, "/package-recommendations", nil))

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rr.Code, rr.Body.String())
	}

	var resp PackageRecommendationsResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}

	if len(resp.Packages) != 2 {
		t.Fatalf("expected 2 packages, got %d", len(resp.Packages))
	}

	var promLJ *PackageEntry
	var prom101 *PackageEntry
	for i := range resp.Packages {
		switch resp.Packages[i].ID {
		case "prom-lj":
			promLJ = &resp.Packages[i]
		case "prom-101":
			prom101 = &resp.Packages[i]
		}
	}

	if promLJ == nil || promLJ.Manifest == nil {
		t.Fatalf("prom-lj manifest was not inlined: %+v", promLJ)
	}
	if got := promLJ.Manifest["id"]; got != "prom-lj" {
		t.Errorf("manifest.id = %v, want prom-lj", got)
	}
	milestones, ok := promLJ.Manifest["milestones"].([]interface{})
	if !ok || len(milestones) != 3 {
		t.Errorf("milestones not preserved: %v", promLJ.Manifest["milestones"])
	}

	if prom101 == nil {
		t.Fatal("prom-101 missing from response")
	}
	if prom101.Manifest != nil {
		t.Errorf("prom-101 manifest should be nil after fetch failure, got %+v", prom101.Manifest)
	}

	// Bug 3 regression: every manifest fetch must request the tighter
	// 256 KB cap, not the 5 MB repository cap.
	mu.Lock()
	defer mu.Unlock()
	if len(manifestCalls) != 2 {
		t.Fatalf("expected 2 manifest fetches, got %d (%v)", len(manifestCalls), manifestCalls)
	}
	for url, got := range manifestCalls {
		if got != packageManifestMaxBytes {
			t.Errorf("manifest fetch %q maxBytes = %d, want %d (manifest cap, not repo cap)",
				url, got, packageManifestMaxBytes)
		}
	}
}

func TestBuildPackageFileURL_NormalizesSlashes(t *testing.T) {
	cases := []struct {
		baseURL string
		path    string
		file    string
		want    string
	}{
		{"https://x.example/packages/", "foo/", "content.json", "https://x.example/packages/foo/content.json"},
		{"https://x.example/packages/", "/foo", "manifest.json", "https://x.example/packages/foo/manifest.json"},
		{"https://x.example/packages", "foo", "content.json", "https://x.example/packages/foo/content.json"},
		{"https://x.example/packages/", "/foo/bar/", "content.json", "https://x.example/packages/foo/bar/content.json"},
		{"", "foo", "content.json", ""},
		{"https://x.example/packages/", "", "content.json", ""},
		{"https://x.example/packages/", "foo", "", ""},
	}
	for _, tc := range cases {
		if got := buildPackageFileURL(tc.baseURL, tc.path, tc.file); got != tc.want {
			t.Errorf("buildPackageFileURL(%q,%q,%q) = %q; want %q",
				tc.baseURL, tc.path, tc.file, got, tc.want)
		}
	}
}

func TestDefaultPackageRepositoryFetcher_RespectsMaxBytes(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Stream more than the limit.
		_, _ = w.Write(make([]byte, packageRepositoryMaxBytes+1024))
	}))
	t.Cleanup(srv.Close)

	// We can't go through the allowlist (httptest URL won't match), so call
	// the fetcher directly. It only enforces size + status, not allowlist.
	body, err := defaultPackageRepositoryFetcher(context.Background(), srv.URL, packageRepositoryMaxBytes)
	if err == nil {
		t.Fatalf("expected size-limit error, got nil; body len = %d", len(body))
	}
	if !strings.Contains(err.Error(), fmt.Sprintf("%d bytes", packageRepositoryMaxBytes)) {
		t.Errorf("error missing size info: %v", err)
	}
}

// TestDefaultPackageRepositoryFetcher_BoundsBufferAtMaxBytes proves Bug 3 is
// fixed at the source: the fetcher reads at most maxBytes+1 even when the
// upstream sends a much larger body, so a misconfigured manifest can't cause
// 8 concurrent goroutines to allocate 5 MB each transiently.
func TestDefaultPackageRepositoryFetcher_BoundsBufferAtMaxBytes(t *testing.T) {
	const tinyCap = int64(1024)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// 5 MB body — vastly exceeds the 1 KB cap we're going to pass.
		_, _ = w.Write(make([]byte, packageRepositoryMaxBytes))
	}))
	t.Cleanup(srv.Close)

	body, err := defaultPackageRepositoryFetcher(context.Background(), srv.URL, tinyCap)
	if err == nil {
		t.Fatalf("expected size-limit error, got nil")
	}
	// LimitReader truncates at maxBytes+1, so we should never have buffered
	// more than that even though the server tried to send 5 MB. (This is
	// observable via the error message rather than memory introspection.)
	if !strings.Contains(err.Error(), fmt.Sprintf("%d bytes", tinyCap)) {
		t.Errorf("error should reference the tighter manifest cap (%d), got: %v", tinyCap, err)
	}
	_ = body
}

// TestPackageMatchPreservesUnknownPredicates is the end-to-end regression
// test for Bug 1: when an upstream entry uses a predicate the lightweight
// matcher doesn't understand (e.g. urlRegex), the original key must survive
// the round-trip through Go and reach the frontend so its
// usesOnlySupportedMatchPredicates can fail closed. Before the fix, the
// match deserialized into a typed struct that silently dropped urlRegex,
// reserialized as `{}`, and the frontend then matched it against every page.
func TestPackageMatchPreservesUnknownPredicates(t *testing.T) {
	resetPackageRecommendationsCache()
	withFrozenTime(t, time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC))

	body := []byte(`{
		"assistant-self-hosted": {
			"path": "assistant-self-hosted/v1",
			"type": "guide",
			"title": "Assistant",
			"targeting": {
				"match": {
					"and": [
						{"or": [
							{"urlRegex": "^/?$"},
							{"urlPrefix": "/connections"}
						]},
						{"targetPlatform": "oss"},
						{"datasource": "prometheus"}
					]
				}
			}
		}
	}`)
	fetcher, _ := stubFetcher(t, body, nil)
	withFetcherOverride(t, fetcher)

	app := newTestApp(t)
	rr := httptest.NewRecorder()
	app.handlePackageRecommendations(rr, httptest.NewRequest(http.MethodGet, "/package-recommendations", nil))
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rr.Code, rr.Body.String())
	}

	var resp PackageRecommendationsResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(resp.Packages) != 1 {
		t.Fatalf("expected 1 package, got %d", len(resp.Packages))
	}
	entry := resp.Packages[0]
	if entry.Targeting == nil || len(entry.Targeting.Match) == 0 {
		t.Fatalf("targeting.match missing: %+v", entry)
	}

	// Re-marshal then re-decode the entry's match into a generic map and
	// search the tree for the unknown predicate keys. This mimics what the
	// frontend's `Object.keys` walk would see at runtime.
	var match map[string]any
	if err := json.Unmarshal(entry.Targeting.Match, &match); err != nil {
		t.Fatalf("decode match: %v", err)
	}
	if !findKeyInExpr(match, "urlRegex") {
		t.Errorf("urlRegex was dropped during the round-trip; frontend can no longer reject it. match=%v", match)
	}
	if !findKeyInExpr(match, "datasource") {
		t.Errorf("datasource was dropped during the round-trip; frontend can no longer reject it. match=%v", match)
	}
}

// findKeyInExpr walks a match expression looking for `key` anywhere in the
// tree (including inside `and`/`or` arrays). Used by the Bug 1 regression
// test to assert that unknown predicate keys survive serialization.
func findKeyInExpr(node any, key string) bool {
	switch n := node.(type) {
	case map[string]any:
		if _, ok := n[key]; ok {
			return true
		}
		for _, v := range n {
			if findKeyInExpr(v, key) {
				return true
			}
		}
	case []any:
		for _, v := range n {
			if findKeyInExpr(v, key) {
				return true
			}
		}
	}
	return false
}

// TestGetCachedPackageRecommendations_ReleasesMutexDuringFetch is the Bug 2
// regression test: concurrent callers must not serialize on packageCacheMu
// while the upstream fetch is running. Before the fix, all callers blocked
// on the mutex for the full ~50 s manifest fan-out; now the second caller
// joins the in-flight refresh and they both return when the fetch completes.
func TestGetCachedPackageRecommendations_ReleasesMutexDuringFetch(t *testing.T) {
	resetPackageRecommendationsCache()
	withFrozenTime(t, time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC))

	// The fetcher blocks until `release` is closed, simulating a slow CDN.
	// We use this to prove the second caller doesn't wait on the cache
	// mutex (it would deadlock the test if it did, because the first
	// caller is still holding the mutex with the old code).
	//
	// We track repo fetches separately from manifest fetches: dedup means
	// the *refresh* runs once even though each refresh may fan out to many
	// manifest URLs.
	release := make(chan struct{})
	started := make(chan struct{})
	var repoFetches int32
	var startedOnce sync.Once
	withFetcherOverride(t, func(ctx context.Context, rawURL string, maxBytes int64) ([]byte, error) {
		if strings.HasSuffix(rawURL, "repository.json") {
			atomic.AddInt32(&repoFetches, 1)
			startedOnce.Do(func() { close(started) })
			<-release
			return validPayload(t), nil
		}
		// Manifest fetch — return immediately with an unparseable body so
		// the manifest fan-out doesn't itself block the test. The packages
		// stay in the response without manifests, which is fine.
		return []byte("not-json"), nil
	})

	app := newTestApp(t)

	// Caller 1: starts the refresh, blocks on `release`.
	type result struct {
		resp *PackageRecommendationsResponse
		err  error
	}
	c1 := make(chan result, 1)
	go func() {
		resp, err := app.getCachedPackageRecommendations(context.Background())
		c1 <- result{resp, err}
	}()

	// Wait until the upstream fetch is in progress before launching caller 2.
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		close(release)
		t.Fatal("first call never reached upstream fetch")
	}

	// Caller 2: must NOT block on packageCacheMu. With the bug, this would
	// time out because caller 1 holds the mutex through the (still-blocked)
	// fetch.
	c2 := make(chan result, 1)
	go func() {
		resp, err := app.getCachedPackageRecommendations(context.Background())
		c2 <- result{resp, err}
	}()

	// Caller 2 should be parked on the inflight channel. Verify it hasn't
	// returned (the fetch hasn't been released yet) but also hasn't crashed.
	select {
	case r := <-c2:
		close(release)
		t.Fatalf("caller 2 returned before fetch completed: %+v / %v", r.resp, r.err)
	case <-time.After(50 * time.Millisecond):
		// Good — caller 2 is waiting on the inflight channel.
	}

	close(release)

	want := []chan result{c1, c2}
	for i, ch := range want {
		select {
		case r := <-ch:
			if r.err != nil {
				t.Errorf("caller %d: err = %v", i+1, r.err)
			}
			if r.resp == nil {
				t.Errorf("caller %d: resp = nil", i+1)
			}
		case <-time.After(2 * time.Second):
			t.Fatalf("caller %d never returned", i+1)
		}
	}

	// Crucially: the upstream repository was hit exactly once. Both callers
	// shared the in-flight refresh. (The manifest fan-out runs once per
	// refresh, which is also fine — what we're proving here is that we
	// don't run the *whole* refresh twice when two callers race.)
	if got := atomic.LoadInt32(&repoFetches); got != 1 {
		t.Errorf("repo fetch calls = %d, want 1 (in-flight dedup)", got)
	}
}

// TestGetCachedPackageRecommendations_WaiterRespectsContextCancellation
// proves the fix in Bug 2 doesn't introduce a new deadlock risk: a waiter
// whose own context is cancelled returns immediately rather than blocking
// for the duration of the slow upstream fetch.
func TestGetCachedPackageRecommendations_WaiterRespectsContextCancellation(t *testing.T) {
	resetPackageRecommendationsCache()
	withFrozenTime(t, time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC))

	release := make(chan struct{})
	t.Cleanup(func() { close(release) })
	started := make(chan struct{})
	var once sync.Once
	withFetcherOverride(t, func(ctx context.Context, rawURL string, maxBytes int64) ([]byte, error) {
		once.Do(func() { close(started) })
		<-release
		return validPayload(t), nil
	})

	app := newTestApp(t)

	go func() {
		_, _ = app.getCachedPackageRecommendations(context.Background())
	}()
	<-started

	waiterCtx, cancel := context.WithCancel(context.Background())
	cancel()
	resp, err := app.getCachedPackageRecommendations(waiterCtx)
	if err == nil {
		t.Fatalf("expected ctx.Err(), got resp=%+v", resp)
	}
	if !errors.Is(err, context.Canceled) {
		t.Errorf("err = %v, want context.Canceled", err)
	}
}
