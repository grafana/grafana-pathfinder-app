package plugin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
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
	if len(resp.Packages) != 1 || resp.Packages[0].ID != "prom-101" {
		t.Fatalf("expected only prom-101 to survive filtering; got %+v", resp.Packages)
	}
	if resp.Packages[0].Targeting == nil ||
		resp.Packages[0].Targeting.Match.URLPrefix != "/connections" {
		t.Errorf("targeting not preserved: %+v", resp.Packages[0].Targeting)
	}
	if atomic.LoadInt32(calls) != 1 {
		t.Errorf("calls = %d, want 1", atomic.LoadInt32(calls))
	}
}

func TestHandlePackageRecommendations_CachesAcrossCalls(t *testing.T) {
	resetPackageRecommendationsCache()
	withFrozenTime(t, time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC))
	fetcher, calls := stubFetcher(t, validPayload(t), nil)
	withFetcherOverride(t, fetcher)

	app := newTestApp(t)
	for i := 0; i < 3; i++ {
		rr := httptest.NewRecorder()
		app.handlePackageRecommendations(rr, httptest.NewRequest(http.MethodGet, "/package-recommendations", nil))
		if rr.Code != http.StatusOK {
			t.Fatalf("iteration %d: status %d", i, rr.Code)
		}
	}
	if got := atomic.LoadInt32(calls); got != 1 {
		t.Errorf("upstream calls = %d, want 1 (cached)", got)
	}
}

func TestHandlePackageRecommendations_RefreshesAfterTTL(t *testing.T) {
	resetPackageRecommendationsCache()
	advance := withFrozenTime(t, time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC))
	fetcher, calls := stubFetcher(t, validPayload(t), nil)
	withFetcherOverride(t, fetcher)

	app := newTestApp(t)
	app.handlePackageRecommendations(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/package-recommendations", nil))
	advance(packageRepositoryCacheTTL + time.Minute)
	app.handlePackageRecommendations(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/package-recommendations", nil))

	if got := atomic.LoadInt32(calls); got != 2 {
		t.Errorf("upstream calls = %d, want 2 after TTL expiry", got)
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
