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
// tests can assert how many upstream calls happened.
func stubFetcher(t *testing.T, payload []byte, err error) (packageRepositoryFetcher, *int32) {
	t.Helper()
	var calls int32
	return func(ctx context.Context, rawURL string) ([]byte, error) {
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
	if prom == nil || prom.Targeting == nil ||
		prom.Targeting.Match.URLPrefix != "/connections" {
		t.Errorf("targeting not preserved on prom-101: %+v", prom)
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
	withFetcherOverride(t, func(ctx context.Context, rawURL string) ([]byte, error) {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		return innerFetcher(ctx, rawURL)
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
	fetcher := func(_ context.Context, rawURL string) ([]byte, error) {
		mu.Lock()
		calls[rawURL]++
		mu.Unlock()
		switch {
		case strings.HasSuffix(rawURL, "repository.json"):
			return repoBody, nil
		case strings.HasSuffix(rawURL, "/prom-lj/v1/manifest.json"):
			return manifestBody, nil
		case strings.HasSuffix(rawURL, "/prom-101/v1/manifest.json"):
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
	body, err := defaultPackageRepositoryFetcher(context.Background(), srv.URL)
	if err == nil {
		t.Fatalf("expected size-limit error, got nil; body len = %d", len(body))
	}
	if !strings.Contains(err.Error(), fmt.Sprintf("%d bytes", packageRepositoryMaxBytes)) {
		t.Errorf("error missing size info: %v", err)
	}
}
