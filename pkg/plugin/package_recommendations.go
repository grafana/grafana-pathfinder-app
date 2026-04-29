package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
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

	// Per-manifest fetch limits — keep manifests small and the fan-out bounded
	// so a slow CDN can't stall the whole response or run us out of memory.
	packageManifestFetchTimeout = 5 * time.Second
	packageManifestMaxBytes     = 256 * 1024
	packageManifestConcurrency  = 8
)

// allowedPackageRepositoryHosts mirrors the frontend
// ALLOWED_INTERACTIVE_LEARNING_HOSTNAMES allowlist (exact match).
var allowedPackageRepositoryHosts = map[string]struct{}{
	"interactive-learning.grafana-dev.net": {},
	"interactive-learning.grafana.net":     {},
	"interactive-learning.grafana-ops.net": {},
}

// PackageTargeting wraps the match expression for a repository entry.
//
// Match is intentionally typed as json.RawMessage rather than a typed struct
// so unknown predicate keys (urlRegex, datasource, cohort, userRole, tag, …)
// survive the round-trip to the frontend. Decoding into a struct that only
// declares the supported predicates would silently drop the unknown keys and
// reserialize as an empty `{}`, which the frontend's lightweight matcher
// would then vacuously match against every page. Keeping the bytes as-is
// lets the frontend's `usesOnlySupportedMatchPredicates` see the original
// keys and fail closed.
type PackageTargeting struct {
	Match json.RawMessage `json:"match"`
}

// PackageEntry is the slim view of a repository entry sent to the frontend.
// `Manifest` is the parsed contents of the entry's manifest.json (when the
// backend successfully fetched it). The frontend needs manifest fields like
// `milestones`, `recommends`, and `suggests` for the rich learning-journey
// rendering — without them, the cards lack milestone counts, deferred nav
// links, and the right "Start" CTA wiring.
type PackageEntry struct {
	ID          string                 `json:"id"`
	Path        string                 `json:"path"`
	Title       string                 `json:"title,omitempty"`
	Description string                 `json:"description,omitempty"`
	Type        string                 `json:"type,omitempty"`
	Targeting   *PackageTargeting      `json:"targeting,omitempty"`
	Manifest    map[string]interface{} `json:"manifest,omitempty"`
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
//
// `maxBytes` lets the caller bound the in-memory buffer per request — the
// repository index gets 5 MB while individual manifests get 256 KB. Without
// this, a manifest fetch would inherit the larger repository cap and could
// transiently allocate up to (concurrency × repo cap) — ~40 MB at 8-way
// parallelism — before the post-read cap rejected the body.
type packageRepositoryFetcher func(ctx context.Context, rawURL string, maxBytes int64) ([]byte, error)

type packageCacheEntry struct {
	resp      *PackageRecommendationsResponse
	err       error
	fetchedAt time.Time
}

// packageRefreshFlight is a single-flight handle for an active refresh.
// Concurrent callers wait on `done` instead of serializing on `packageCacheMu`
// for the duration of the upstream fetch (which can be 5 s for the index
// plus several seconds for the manifest fan-out).
type packageRefreshFlight struct {
	done chan struct{}
	resp *PackageRecommendationsResponse
	err  error
}

var (
	packageCacheMu      sync.Mutex
	packageCache        *packageCacheEntry
	packageActiveFlight *packageRefreshFlight

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
//
// The mutex is held only for cache lookup and inflight-slot management — the
// upstream fetch runs unlocked. Concurrent callers that arrive during a
// refresh wait on the inflight channel instead of serializing on the mutex
// (which would block them for the full ~50 s manifest fan-out window).
func (a *App) getCachedPackageRecommendations(ctx context.Context) (*PackageRecommendationsResponse, error) {
	packageCacheMu.Lock()
	if packageCache != nil && timeNow().Sub(packageCache.fetchedAt) < packageRepositoryCacheTTL {
		resp, err := packageCache.resp, packageCache.err
		packageCacheMu.Unlock()
		return resp, err
	}

	if existing := packageActiveFlight; existing != nil {
		packageCacheMu.Unlock()
		// Wait for the in-flight refresh to publish its result. Honour the
		// caller's context so a cancelled request can return immediately
		// instead of blocking on a slow CDN.
		select {
		case <-existing.done:
			return existing.resp, existing.err
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}

	flight := &packageRefreshFlight{done: make(chan struct{})}
	packageActiveFlight = flight
	packageCacheMu.Unlock()

	// Detach the upstream fetch from the request's cancellation: a canceled
	// request (browser closed, panel collapsed mid-flight) must not poison
	// the 6-hour cache with a "context canceled" error. The per-fetch
	// timeouts inside fetchAndParsePackageRepository / enrichPackagesWithManifests
	// still apply because they're added with their own context.WithTimeout.
	resp, err := fetchAndParsePackageRepository(context.WithoutCancel(ctx), packageRepositoryURL)

	packageCacheMu.Lock()
	packageCache = &packageCacheEntry{
		resp:      resp,
		err:       err,
		fetchedAt: timeNow(),
	}
	flight.resp = resp
	flight.err = err
	packageActiveFlight = nil
	packageCacheMu.Unlock()
	close(flight.done)

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

	body, err := fetch(ctx, rawURL, packageRepositoryMaxBytes)
	if err != nil {
		return nil, err
	}

	var index map[string]rawRepositoryEntry
	if err := json.Unmarshal(body, &index); err != nil {
		return nil, fmt.Errorf("parse repository.json: %w", err)
	}

	baseURL := baseURLFromRepositoryURL(rawURL)
	packages := make([]PackageEntry, 0, len(index))
	for id, entry := range index {
		// Skip only entries we can't build a CDN URL for. Untargeted entries
		// stay in the response — they're how milestone / recommends / suggests
		// IDs from learning paths get resolved by OnlineCdnPackageResolver.
		// The frontend's matchesPackageEntry drops them from the recommendation
		// list (no targeting → no match), matching how the upstream recommender
		// builds virtual rules only for targeted entries.
		if entry.Path == "" {
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

	enrichPackagesWithManifests(ctx, baseURL, packages, fetch)

	return &PackageRecommendationsResponse{
		BaseURL:  baseURL,
		Packages: packages,
	}, nil
}

// enrichPackagesWithManifests fetches every package's manifest.json in parallel
// (bounded concurrency) and inlines it into each PackageEntry. Per-package
// failures are silently skipped — the entry stays in the response without a
// manifest, so the frontend still gets discovery + a working "Start" button
// even when one package's manifest is unavailable.
func enrichPackagesWithManifests(
	ctx context.Context,
	baseURL string,
	packages []PackageEntry,
	fetch packageRepositoryFetcher,
) {
	if baseURL == "" || len(packages) == 0 {
		return
	}

	sem := make(chan struct{}, packageManifestConcurrency)
	var wg sync.WaitGroup

	for i := range packages {
		entry := &packages[i]
		manifestURL := buildPackageFileURL(baseURL, entry.Path, "manifest.json")
		if manifestURL == "" {
			continue
		}
		// Defensive: only fetch from the same allowlisted host as the index.
		if !isAllowedInteractiveLearningHost(manifestURL) {
			continue
		}

		wg.Add(1)
		sem <- struct{}{}
		go func(target *PackageEntry, url string) {
			defer wg.Done()
			defer func() { <-sem }()

			fetchCtx, cancel := context.WithTimeout(ctx, packageManifestFetchTimeout)
			defer cancel()

			// Pass the manifest cap directly so the body is bounded at read
			// time. Without this, a misconfigured 4 MB manifest would be
			// fully buffered before the post-read check rejected it,
			// transiently allocating ~32 MB across 8 in-flight goroutines.
			body, err := fetch(fetchCtx, url, packageManifestMaxBytes)
			if err != nil {
				return
			}
			var parsed map[string]interface{}
			if err := json.Unmarshal(body, &parsed); err != nil {
				return
			}
			target.Manifest = parsed
		}(entry, manifestURL)
	}
	wg.Wait()
}

// buildPackageFileURL joins the CDN base, the entry path, and a file name
// while collapsing duplicate slashes that would otherwise produce URLs like
// ".../packages/some-id//manifest.json".
//
// Mirrors `buildPackageFileUrl` in
// src/lib/package-recommendations-client.ts; keep the two in sync.
func buildPackageFileURL(baseURL, entryPath, fileName string) string {
	trimmedBase := strings.TrimRight(baseURL, "/")
	cleanPath := strings.Trim(entryPath, "/")
	if trimmedBase == "" || cleanPath == "" || fileName == "" {
		return ""
	}
	return trimmedBase + "/" + cleanPath + "/" + fileName
}

// defaultPackageRepositoryFetcher is the real-network HTTP fetcher. The
// `maxBytes` cap is enforced at read time (LimitReader) so we never buffer
// more than `maxBytes + 1` even when the upstream sends a much larger body.
func defaultPackageRepositoryFetcher(ctx context.Context, rawURL string, maxBytes int64) ([]byte, error) {
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

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}
	if int64(len(body)) > maxBytes {
		return nil, fmt.Errorf("response exceeded %d bytes", maxBytes)
	}
	return body, nil
}

// resetPackageRecommendationsCache clears the cache. Test-only.
func resetPackageRecommendationsCache() {
	packageCacheMu.Lock()
	defer packageCacheMu.Unlock()
	packageCache = nil
	packageActiveFlight = nil
}
