package plugin

import (
	"context"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/grafana/grafana-plugin-sdk-go/config"
)

// Custom guide repository catalogue proxy (docs/design/BACKEND_PROXY_PATTERN.md).
//
// The Custom Guides sidebar and My Learning surfaces need a slim catalogue of a
// stack's private InteractiveGuide packages. The aggregated LIST returns
// full-fidelity guides (spec.blocks and all), so this proxy drains the
// namespace LIST once, strips each guide to a slim entry, and serves the shaped
// catalogue from a short-lived in-process cache. Unlike completion records this
// is a SHARED-BLOB catalogue, not per-user (see the identity-invariance note on
// the cache below).

const (
	// customGuideCacheTTL is short because App Platform guides are an
	// edited-in-place repository — an author publishes a guide and expects it to
	// appear promptly. 30s absorbs the near-simultaneous Custom Guides + My
	// Learning reads on a page load without serving meaningfully stale data.
	customGuideCacheTTL = 30 * time.Second

	// customGuideForcedRefreshInterval rate-limits ?refresh=1 (used by the
	// author flow: publish a guide, immediately re-list) to at most one forced
	// upstream LIST per namespace per window, so it can't become a load lever.
	customGuideForcedRefreshInterval = 30 * time.Second

	// customGuideFailureCooldown is a negative-cache window, deliberately a
	// separate constant from the success TTL: after an upstream refresh fails,
	// TTL-expired re-attempts are suppressed for this long so a sustained outage
	// doesn't re-trigger a full-namespace LIST on every sequential request.
	// Identity-scoped (401/403) failures never enter this shared negative cache.
	customGuideFailureCooldown = 30 * time.Second

	// customGuideRetryAfterSeconds is the Retry-After hint on a cold 503.
	customGuideRetryAfterSeconds = 30

	// customGuideAggregateDeadline bounds a whole multi-page drain. The refresh
	// runs detached from the request (context.WithoutCancel), so without this an
	// N-page drain would be bounded only by N × per-page timeout — detached must
	// not mean unkillable.
	customGuideAggregateDeadline = 60 * time.Second
)

// customGuideListMaxTotalEntries is the aggregate budget across all LIST pages
// of one drain (the per-page byte cap alone does not bound total memory). When
// the budget trips, the drain stops and logs the truncation — never silently.
// A var so tests can exercise the budget path.
var customGuideListMaxTotalEntries = 50_000

// customGuideCapability is the availability signal the front-end gates the
// Custom Guides / My Learning surfaces on. `available` is read-derived: it
// measures identity presence plus read-path reachability of the
// interactiveguides API on this stack. Reasons use the shared machine tokens
// reasonIdentityUnavailable / reasonBackendUnavailable (completion_records.go).
type customGuideCapability struct {
	Available bool   `json:"available"`
	Reason    string `json:"reason,omitempty"`
}

// customGuideRepositoryResponse is the GET /custom-guide-repository envelope
// (BACKEND_PROXY_PATTERN.md §6): a capability object, the always-non-null data
// array, and asOf — the staleness contract telling the front-end when the
// underlying LIST completed.
type customGuideRepositoryResponse struct {
	Capability customGuideCapability        `json:"capability"`
	Guides     []customGuideRepositoryEntry `json:"guides"`
	AsOf       string                       `json:"asOf,omitempty"`
}

// customGuideIndex is the shaped, block-stripped catalogue for a namespace.
//
// SHARED-BLOB identity model (BACKEND_PROXY_PATTERN.md §4): authorization is
// enforced at cache-fill (the LIST rides the filling caller's forwarded
// identity) and the result is shared for the TTL across every authorized
// caller in the namespace. This is sound ONLY because the upstream LIST is
// identity-invariant here: Kubernetes list RBAC on interactiveguides is
// namespace-scoped, not object-scoped, so any caller permitted to list sees
// the same full set — no caller's richer view can leak to another. The cache
// is not partitioned by user because there is nothing per-user to partition.
type customGuideIndex struct {
	entries []customGuideRepositoryEntry
	asOf    time.Time
}

type customGuideCacheEntry struct {
	index *customGuideIndex
}

// customGuideFailure records the most recent namespace-global upstream refresh
// failure so the cooldown can suppress re-probes and cold callers can still
// distinguish terminal from transient while throttled.
type customGuideFailure struct {
	at  time.Time
	err error
}

// customGuideRefreshFlight is a single-flight handle: concurrent cache-miss
// callers for a namespace wait on `done` and share one upstream LIST.
type customGuideRefreshFlight struct {
	done  chan struct{}
	index *customGuideIndex
	err   error
}

// customGuideCacheStats are per-namespace vital signs, included in refresh-time
// structured logs so the cache is diagnosable on-call.
type customGuideCacheStats struct {
	hits            int
	misses          int
	staleServes     int
	refreshes       int
	refreshFailures int
}

// All maps below are keyed by the trusted-context namespace (never
// caller-supplied — see resolveCustomGuideBackend), so on hosted Grafana the
// key space is one entry per process; the maps need no eviction.
var (
	customGuideCacheMu      sync.Mutex
	customGuideCacheEntries map[string]*customGuideCacheEntry
	customGuideFlights      map[string]*customGuideRefreshFlight
	customGuideLastForced   map[string]time.Time
	customGuideLastFailure  map[string]customGuideFailure
	customGuideStats        map[string]*customGuideCacheStats

	// customGuideListerOverride injects a fake lister in tests. nil selects the
	// real per-request HTTP client. Config resolution (feature toggle, app URL,
	// namespace) is checked BEFORE this override so the structural-
	// unavailability path stays testable.
	customGuideListerOverride customGuideLister
)

func customGuideCacheInit() {
	if customGuideCacheEntries == nil {
		customGuideCacheEntries = map[string]*customGuideCacheEntry{}
	}
	if customGuideFlights == nil {
		customGuideFlights = map[string]*customGuideRefreshFlight{}
	}
	if customGuideLastForced == nil {
		customGuideLastForced = map[string]time.Time{}
	}
	if customGuideLastFailure == nil {
		customGuideLastFailure = map[string]customGuideFailure{}
	}
	if customGuideStats == nil {
		customGuideStats = map[string]*customGuideCacheStats{}
	}
}

func customGuideStatsFor(namespace string) *customGuideCacheStats {
	s := customGuideStats[namespace]
	if s == nil {
		s = &customGuideCacheStats{}
		customGuideStats[namespace] = s
	}
	return s
}

// resetCustomGuideRepositoryCache clears all cached state. Test-only.
func resetCustomGuideRepositoryCache() {
	customGuideCacheMu.Lock()
	defer customGuideCacheMu.Unlock()
	customGuideCacheEntries = nil
	customGuideFlights = nil
	customGuideLastForced = nil
	customGuideLastFailure = nil
	customGuideStats = nil
}

// getCustomGuideIndex returns the shaped catalogue for a namespace, refreshing
// at most once per TTL (or immediately for a rate-limit-permitted forced
// refresh). On refresh failure it serves a warm (stale) index when one exists;
// a cold failure returns (nil, err). After a namespace-global failure a short
// cooldown suppresses TTL-driven re-attempts; identity-scoped (401/403)
// failures are per-request and never enter that shared negative cache — caller
// A's denied token must not become a cached error served to caller B.
// Concurrent refreshes single-flight.
func getCustomGuideIndex(ctx context.Context, namespace string, lister customGuideLister, forced bool, logger log.Logger) (*customGuideIndex, error) {
	customGuideCacheMu.Lock()
	customGuideCacheInit()

	entry := customGuideCacheEntries[namespace]
	stats := customGuideStatsFor(namespace)

	effectiveForced := false
	if forced {
		last, seen := customGuideLastForced[namespace]
		if !seen || timeNow().Sub(last) >= customGuideForcedRefreshInterval {
			effectiveForced = true
			customGuideLastForced[namespace] = timeNow()
		}
	}

	if entry != nil && !effectiveForced && timeNow().Sub(entry.index.asOf) < customGuideCacheTTL {
		stats.hits++
		idx := entry.index
		customGuideCacheMu.Unlock()
		return idx, nil
	}
	stats.misses++

	// Negative-cache cooldown: after a recent namespace-global refresh failure,
	// don't re-probe a struggling upstream on every TTL-expired request. Serve
	// the stale index when warm, or replay the sticky error when cold, until the
	// cooldown elapses. A rate-limit-permitted ?refresh=1 bypasses this.
	if !effectiveForced {
		if fail, ok := customGuideLastFailure[namespace]; ok && timeNow().Sub(fail.at) < customGuideFailureCooldown {
			if entry != nil {
				stats.staleServes++
				idx := entry.index
				customGuideCacheMu.Unlock()
				return idx, nil
			}
			err := fail.err
			customGuideCacheMu.Unlock()
			return nil, err
		}
	}

	if fl := customGuideFlights[namespace]; fl != nil {
		customGuideCacheMu.Unlock()
		select {
		case <-fl.done:
			return fl.index, fl.err
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}

	fl := &customGuideRefreshFlight{done: make(chan struct{})}
	customGuideFlights[namespace] = fl
	customGuideCacheMu.Unlock()

	// Detach from the caller's cancellation so a canceled request (panel closed
	// mid-flight) doesn't abort a refresh other waiters depend on, bounded by
	// the aggregate deadline so detached never means unkillable.
	fetchCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), customGuideAggregateDeadline)
	idx, pages, err := buildCustomGuideIndex(fetchCtx, namespace, lister, logger)
	cancel()

	customGuideCacheMu.Lock()
	stats = customGuideStatsFor(namespace)
	if err == nil {
		stats.refreshes++
		if _, hadFailure := customGuideLastFailure[namespace]; hadFailure {
			logger.Info("custom guide catalogue recovered", "namespace", namespace)
		}
		customGuideCacheEntries[namespace] = &customGuideCacheEntry{index: idx}
		delete(customGuideLastFailure, namespace)
		fl.index = idx
		logger.Debug("custom guide catalogue refreshed",
			"namespace", namespace, "pages", pages, "guides", len(idx.entries),
			"hits", stats.hits, "misses", stats.misses,
			"staleServes", stats.staleServes, "refreshFailures", stats.refreshFailures)
	} else {
		stats.refreshFailures++
		identityScoped := isIdentityScopedUpstreamError(err)
		if !identityScoped {
			customGuideLastFailure[namespace] = customGuideFailure{at: timeNow(), err: err}
		}
		// Refresh attempts are throttled by TTL + cooldown, so this logs state
		// transitions, not every request.
		logger.Info("custom guide catalogue refresh failed",
			"namespace", namespace, "error", err,
			"identityScoped", identityScoped, "servingStale", entry != nil,
			"refreshFailures", stats.refreshFailures)
		if entry != nil {
			// Warm cache + upstream failure: serve stale. asOf reflects true age.
			stats.staleServes++
			fl.index = entry.index
			fl.err = err
		} else {
			fl.err = err
		}
	}
	delete(customGuideFlights, namespace)
	customGuideCacheMu.Unlock()
	close(fl.done)

	return fl.index, fl.err
}

// buildCustomGuideIndex drains the namespace LIST across pages — up to the
// aggregate entry budget — and shapes the guides into the catalogue index.
func buildCustomGuideIndex(ctx context.Context, namespace string, lister customGuideLister, logger log.Logger) (*customGuideIndex, int, error) {
	var entries []customGuideRepositoryEntry
	continueToken := ""
	pages := 0
	for {
		page, err := lister.ListPage(ctx, namespace, continueToken)
		if err != nil {
			return nil, pages, err
		}
		pages++
		entries = append(entries, page.Entries...)
		if len(entries) >= customGuideListMaxTotalEntries && page.Continue != "" {
			logger.Warn("custom guide catalogue LIST truncated at aggregate budget",
				"namespace", namespace, "maxTotalEntries", customGuideListMaxTotalEntries, "pages", pages)
			break
		}
		if page.Continue == "" {
			break
		}
		continueToken = page.Continue
	}

	if entries == nil {
		entries = []customGuideRepositoryEntry{}
	}
	return &customGuideIndex{entries: entries, asOf: timeNow()}, pages, nil
}

// handleCustomGuideRepository serves GET /custom-guide-repository.
func (a *App) handleCustomGuideRepository(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Identity gate first — cache hit or miss, warm bytes are never served to an
	// unauthenticated caller. This is a namespace-global catalogue, so we only
	// STRUCTURALLY validate the ID token (validIDToken); there is no per-user
	// need, so we deliberately do not extract `sub`. Missing/invalid identity on
	// a GET read is a soft-200 capability envelope (not 401): these routes gate
	// whether a feature renders at all, and a bare error status conflates "never
	// works here" with a transient blip (BACKEND_PROXY_PATTERN.md §3, §7).
	if !validIDToken(r) {
		a.writeJSON(w, customGuideRepositoryResponse{
			Capability: customGuideCapability{Available: false, Reason: reasonIdentityUnavailable},
			Guides:     []customGuideRepositoryEntry{},
		}, http.StatusOK)
		return
	}

	lister, namespace, available, reason := a.resolveCustomGuideBackend(r)
	if !available {
		a.writeJSON(w, customGuideRepositoryResponse{
			Capability: customGuideCapability{Available: false, Reason: reason},
			Guides:     []customGuideRepositoryEntry{},
		}, http.StatusOK)
		return
	}

	forced := r.URL.Query().Get("refresh") == "1"
	idx, err := getCustomGuideIndex(r.Context(), namespace, lister, forced, a.ctxLogger(r.Context()))
	if idx == nil {
		// Cold failure: no cache to fall back on.
		if isTerminalUpstreamError(err) {
			// Structurally can't serve for this caller ("never works here").
			a.writeJSON(w, customGuideRepositoryResponse{
				Capability: customGuideCapability{Available: false, Reason: reasonBackendUnavailable},
				Guides:     []customGuideRepositoryEntry{},
			}, http.StatusOK)
			return
		}
		a.ctxLogger(r.Context()).Debug("custom guide catalogue unavailable (cold)", "error", err)
		w.Header().Set("Retry-After", strconv.Itoa(customGuideRetryAfterSeconds))
		a.writeError(w, "custom-guide-repository-unavailable", http.StatusServiceUnavailable)
		return
	}

	a.writeJSON(w, customGuideRepositoryResponse{
		Capability: customGuideCapability{Available: true},
		Guides:     idx.entries,
		AsOf:       idx.asOf.UTC().Format(time.RFC3339),
	}, http.StatusOK)
}

// resolveCustomGuideBackend determines whether the aggregated CRUD API is
// structurally reachable for this request and returns a lister to use.
// "Structurally unavailable" (feature toggle off, no app URL, no namespace) is
// a "never works here" condition surfaced as capability=false, distinct from a
// transient LIST failure. The namespace comes from the trusted plugin context,
// never from a query parameter. Config resolution runs before the test-only
// lister override so the structural-unavailability branch stays testable.
func (a *App) resolveCustomGuideBackend(r *http.Request) (lister customGuideLister, namespace string, available bool, reason string) {
	namespace = backend.PluginConfigFromContext(r.Context()).Namespace

	cfg := config.GrafanaConfigFromContext(r.Context())
	if cfg == nil {
		return nil, namespace, false, reasonBackendUnavailable
	}
	if !cfg.FeatureToggles().IsEnabled(pathfinderBackendAggregationToggle) {
		return nil, namespace, false, reasonBackendUnavailable
	}
	appURL, err := cfg.AppURL()
	if err != nil || appURL == "" || namespace == "" {
		return nil, namespace, false, reasonBackendUnavailable
	}

	if customGuideListerOverride != nil {
		return customGuideListerOverride, namespace, true, ""
	}

	idToken := r.Header.Get(backend.GrafanaUserSignInTokenHeaderName)
	return newCustomGuideHTTPClient(appURL, idToken, a.ctxLogger(r.Context())), namespace, true, ""
}
