package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sync"
	"time"
)

// packageRepositoryURL is the public CDN-hosted repository index used by the
// online package recommendations feature for OSS Pathfinder users.
//
// Hardcoded: this feature is auto-disabled when the online recommender is
// enabled, and the recommender already covers configurable endpoints. Keeping
// the URL fixed lets us pair it with a strict host allowlist.
const packageRepositoryURL = "https://interactive-learning.grafana.net/packages/repository.json"

const (
	packageRepositoryFetchTimeout = 5 * time.Second
	packageRepositoryMaxBytes     = 5 * 1024 * 1024
	packageRepositoryCacheTTL     = 6 * time.Hour
)

// allowedPackageRepositoryHosts mirrors the frontend
// ALLOWED_INTERACTIVE_LEARNING_HOSTNAMES allowlist (exact match).
var allowedPackageRepositoryHosts = map[string]struct{}{
	"interactive-learning.grafana-dev.net": {},
	"interactive-learning.grafana.net":     {},
	"interactive-learning.grafana-ops.net": {},
}

// PackageMatchExpr is the subset of the recommender's MatchExpr that
// Pathfinder's lightweight bundled matcher already understands. We
// deliberately drop datasource/source/cohort/role/tag predicates.
type PackageMatchExpr struct {
	URLPrefix      string             `json:"urlPrefix,omitempty"`
	URLPrefixIn    []string           `json:"urlPrefixIn,omitempty"`
	TargetPlatform string             `json:"targetPlatform,omitempty"`
	And            []PackageMatchExpr `json:"and,omitempty"`
	Or             []PackageMatchExpr `json:"or,omitempty"`
}

// PackageTargeting wraps the match expression for a repository entry.
type PackageTargeting struct {
	Match PackageMatchExpr `json:"match"`
}

// PackageEntry is the slim view of a repository entry sent to the frontend.
// We strip recommender-only fields (depends, conflicts, milestones, etc.)
// because the OSS discovery path doesn't use them.
type PackageEntry struct {
	ID          string            `json:"id"`
	Path        string            `json:"path"`
	Title       string            `json:"title,omitempty"`
	Description string            `json:"description,omitempty"`
	Type        string            `json:"type,omitempty"`
	Targeting   *PackageTargeting `json:"targeting,omitempty"`
}

// PackageRecommendationsResponse is the JSON returned to the frontend.
type PackageRecommendationsResponse struct {
	BaseURL  string         `json:"baseUrl"`
	Packages []PackageEntry `json:"packages"`
}

// rawRepositoryEntry mirrors the upstream repository.json schema. We only
// decode the fields used by the lightweight matcher; unknown fields are
// ignored by encoding/json.
type rawRepositoryEntry struct {
	Path        string            `json:"path"`
	Type        string            `json:"type,omitempty"`
	Title       string            `json:"title,omitempty"`
	Description string            `json:"description,omitempty"`
	Targeting   *PackageTargeting `json:"targeting,omitempty"`
}

// packageRepositoryFetcher abstracts the HTTP fetch so tests can inject a
// fake without spinning up an httptest server when convenient.
type packageRepositoryFetcher func(ctx context.Context, rawURL string) ([]byte, error)

type packageCacheEntry struct {
	resp      *PackageRecommendationsResponse
	err       error
	fetchedAt time.Time
}

var (
	packageCacheMu sync.Mutex
	packageCache   *packageCacheEntry

	// Test-only override. nil falls back to the real HTTP fetcher.
	packageRepositoryFetcherOverride packageRepositoryFetcher

	// timeNow is overridable for tests.
	timeNow = time.Now
)

// isAllowedInteractiveLearningHost reports whether rawURL points at a trusted
// interactive-learning host over HTTPS. Mirrors the frontend allowlist.
func isAllowedInteractiveLearningHost(rawURL string) bool {
	u, err := url.Parse(rawURL)
	if err != nil {
		return false
	}
	if u.Scheme != "https" {
		return false
	}
	_, ok := allowedPackageRepositoryHosts[u.Hostname()]
	return ok
}

// baseURLFromRepositoryURL strips the trailing "repository.json" so the
// frontend can build "<baseURL><entry.path>/content.json" URLs.
func baseURLFromRepositoryURL(rawURL string) string {
	if len(rawURL) >= len("repository.json") &&
		rawURL[len(rawURL)-len("repository.json"):] == "repository.json" {
		return rawURL[:len(rawURL)-len("repository.json")]
	}
	return rawURL
}

// handlePackageRecommendations serves the cached package index. It returns
// 503 once and stays 503 for the rest of the cache TTL on any failure, so
// air-gapped or restricted networks aren't repeatedly probed.
func (a *App) handlePackageRecommendations(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	resp, err := a.getCachedPackageRecommendations(r.Context())
	if err != nil {
		a.ctxLogger(r.Context()).Debug("package recommendations unavailable", "error", err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "package-index-unavailable"})
		return
	}

	// Grafana overrides Cache-Control to "no-store" on plugin resource
	// responses, so we rely on the in-process cache (packageRepositoryCacheTTL)
	// rather than HTTP caching for repeat-call dedupe.
	a.writeJSON(w, resp, http.StatusOK)
}

// getCachedPackageRecommendations returns the cached index, refreshing it at
// most once per packageRepositoryCacheTTL window. Both successful and failed
// fetches are cached; a sticky failure prevents repeat upstream hits.
func (a *App) getCachedPackageRecommendations(ctx context.Context) (*PackageRecommendationsResponse, error) {
	packageCacheMu.Lock()
	defer packageCacheMu.Unlock()

	if packageCache != nil && timeNow().Sub(packageCache.fetchedAt) < packageRepositoryCacheTTL {
		return packageCache.resp, packageCache.err
	}

	resp, err := fetchAndParsePackageRepository(ctx, packageRepositoryURL)
	packageCache = &packageCacheEntry{
		resp:      resp,
		err:       err,
		fetchedAt: timeNow(),
	}
	return resp, err
}

// fetchAndParsePackageRepository performs the network fetch and trims the
// response to the slim shape the frontend consumes.
func fetchAndParsePackageRepository(ctx context.Context, rawURL string) (*PackageRecommendationsResponse, error) {
	if !isAllowedInteractiveLearningHost(rawURL) {
		return nil, fmt.Errorf("package repository host not allowed")
	}

	fetch := packageRepositoryFetcherOverride
	if fetch == nil {
		fetch = defaultPackageRepositoryFetcher
	}

	body, err := fetch(ctx, rawURL)
	if err != nil {
		return nil, err
	}

	var index map[string]rawRepositoryEntry
	if err := json.Unmarshal(body, &index); err != nil {
		return nil, fmt.Errorf("parse repository.json: %w", err)
	}

	packages := make([]PackageEntry, 0, len(index))
	for id, entry := range index {
		// Skip entries we can't resolve content for or can't filter on.
		// Without targeting, the lightweight matcher would treat the entry
		// as universal — which would surface unrelated guides on every page.
		if entry.Path == "" || entry.Targeting == nil {
			continue
		}
		packages = append(packages, PackageEntry{
			ID:          id,
			Path:        entry.Path,
			Title:       entry.Title,
			Description: entry.Description,
			Type:        entry.Type,
			Targeting:   entry.Targeting,
		})
	}

	return &PackageRecommendationsResponse{
		BaseURL:  baseURLFromRepositoryURL(rawURL),
		Packages: packages,
	}, nil
}

// defaultPackageRepositoryFetcher is the real-network HTTP fetcher.
func defaultPackageRepositoryFetcher(ctx context.Context, rawURL string) ([]byte, error) {
	fetchCtx, cancel := context.WithTimeout(ctx, packageRepositoryFetchTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(fetchCtx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}

	client := &http.Client{Timeout: packageRepositoryFetchTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch %s: %w", rawURL, err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, packageRepositoryMaxBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}
	if int64(len(body)) > packageRepositoryMaxBytes {
		return nil, fmt.Errorf("response exceeded %d bytes", packageRepositoryMaxBytes)
	}
	return body, nil
}

// resetPackageRecommendationsCache clears the cache. Test-only.
func resetPackageRecommendationsCache() {
	packageCacheMu.Lock()
	defer packageCacheMu.Unlock()
	packageCache = nil
}
