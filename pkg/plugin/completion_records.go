package plugin

import (
	"context"
	"errors"
	"net/http"
	"sort"
	"strconv"
	"sync"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/grafana/grafana-plugin-sdk-go/config"
)

// Completion Records read proxy (docs/design/BACKEND_PROXY_PATTERN.md).
//
// Two routes answer "what has this user completed?" cheaply and repeatedly, so
// completion records can follow a user around (epic PR 7 attaches them to
// recommender context). The backend CRD store does no per-user filtering — a
// namespace LIST returns every record — so this proxy LISTs the whole
// namespace once, collates it per user, and serves the collated index from a
// short-lived in-memory cache. See design doc `be-read-my-completions`.

const (
	// completionCacheTTL is how long a collated index serves before a refresh
	// is triggered. Recommender context tolerates minutes of staleness.
	completionCacheTTL = 5 * time.Minute

	// completionForcedRefreshInterval rate-limits ?refresh=1 to at most one
	// forced upstream LIST per namespace per window, so the param can't become
	// a load lever.
	completionForcedRefreshInterval = 30 * time.Second

	// completionFailureCooldown is a negative-cache window, deliberately a
	// separate constant from the success TTL: after an upstream refresh fails,
	// TTL-expired re-attempts are suppressed for this long so a sustained
	// outage doesn't re-trigger a full-namespace LIST on every sequential
	// request. Identity-scoped (401/403) failures never enter this shared
	// negative cache — see getCompletionIndex.
	completionFailureCooldown = 30 * time.Second

	// completionRetryAfterSeconds is the Retry-After hint on a cold 503.
	completionRetryAfterSeconds = 30

	// completionAggregateDeadline bounds a whole multi-page drain. The refresh
	// runs detached from the request (context.WithoutCancel), so without this
	// an N-page drain would be bounded only by N × per-page timeout — detached
	// must not mean unkillable.
	completionAggregateDeadline = 60 * time.Second

	reasonIdentityUnavailable = "identity-unavailable"
	reasonBackendUnavailable  = "backend-unavailable"
)

// completionListMaxTotalRecords is the aggregate budget across all LIST pages
// of one drain (the per-page byte cap alone does not bound total memory).
// When the budget trips, the drain stops and logs the truncation — never
// silently. A var so tests can exercise the budget path.
var completionListMaxTotalRecords = 50_000

// deriveCompletionUserID is the canonical identity contract for the whole
// Completion Records epic: the caller's ID-token `sub` claim VERBATIM, typed
// prefix included (e.g. "user:abc123"). Reads and writes must join on the
// same key — epic PR 4's write hook MUST stamp `spec.userId` with this exact
// helper. Fail closed with no login/numeric fallback; see
// app_platform_identity.go and the trust boundary in docs/developer/CODA.md.
func deriveCompletionUserID(r *http.Request) (string, bool) {
	return subjectFromIDToken(r)
}

// completionCapability is the availability signal the front-end and epic PRs
// 4/5 gate UX on. `available` is read-derived — it measures identity presence
// plus read-path reachability of the completionrecords API on this stack; it
// does not verify write permission (the write hook must not treat it as a
// write guarantee).
type completionCapability struct {
	Available bool   `json:"available"`
	Reason    string `json:"reason,omitempty"`
}

// collatedCompletion is one entry per (guideSource, guideId) for a single user.
type collatedCompletion struct {
	GuideSource          string `json:"guideSource"`
	GuideID              string `json:"guideId"`
	GuideTitle           string `json:"guideTitle"`
	GuideCategory        string `json:"guideCategory"`
	PathID               string `json:"pathId"`
	Count                int    `json:"count"`
	LatestCompletedAt    string `json:"latestCompletedAt"`
	LatestSource         string `json:"latestSource"`
	MaxCompletionPercent int64  `json:"maxCompletionPercent"`
}

// myCompletionsResponse is the GET /completion-records/my envelope.
type myCompletionsResponse struct {
	Capability  completionCapability `json:"capability"`
	UserID      string               `json:"userId,omitempty"`
	Completions []collatedCompletion `json:"completions"`
	AsOf        string               `json:"asOf,omitempty"`
}

// completionIndex is the collated, per-user view of a namespace's records.
// Raw records are dropped after collation, so the footprint is bounded by
// distinct (user, guide) pairs, not completion volume. Serving reads only
// idx.byUser[caller] — a cache hit is structurally incapable of exposing
// another user's slice.
type completionIndex struct {
	byUser map[string][]collatedCompletion
	asOf   time.Time
}

type completionCacheEntry struct {
	index *completionIndex
}

// completionFailure records the most recent namespace-global upstream refresh
// failure so the cooldown can suppress re-probes and cold callers can still
// distinguish a terminal (4xx) from a transient error while throttled.
type completionFailure struct {
	at  time.Time
	err error
}

// completionRefreshFlight is a single-flight handle: concurrent cache-miss
// callers for a namespace wait on `done` and share one upstream LIST.
type completionRefreshFlight struct {
	done  chan struct{}
	index *completionIndex
	err   error
}

// completionCacheStats are per-namespace vital signs, included in refresh-time
// structured logs so the cache is diagnosable on-call.
type completionCacheStats struct {
	hits            int
	misses          int
	staleServes     int
	refreshes       int
	refreshFailures int
}

// All maps below are keyed by the trusted-context namespace (never
// caller-supplied), so on hosted Grafana the key space is one entry per
// process — the maps need no eviction.
var (
	completionCacheMu      sync.Mutex
	completionCacheEntries map[string]*completionCacheEntry
	completionFlights      map[string]*completionRefreshFlight
	completionLastForced   map[string]time.Time
	completionLastFailure  map[string]completionFailure
	completionStats        map[string]*completionCacheStats

	// completionListerOverride injects a fake lister in tests. nil selects the
	// real per-request HTTP client. Config resolution (feature toggle, app
	// URL, namespace) is checked BEFORE this override so the structural-
	// unavailability path stays testable.
	completionListerOverride completionRecordLister
)

func completionCacheInit() {
	if completionCacheEntries == nil {
		completionCacheEntries = map[string]*completionCacheEntry{}
	}
	if completionFlights == nil {
		completionFlights = map[string]*completionRefreshFlight{}
	}
	if completionLastForced == nil {
		completionLastForced = map[string]time.Time{}
	}
	if completionLastFailure == nil {
		completionLastFailure = map[string]completionFailure{}
	}
	if completionStats == nil {
		completionStats = map[string]*completionCacheStats{}
	}
}

func completionStatsFor(namespace string) *completionCacheStats {
	s := completionStats[namespace]
	if s == nil {
		s = &completionCacheStats{}
		completionStats[namespace] = s
	}
	return s
}

// resetCompletionRecordsCache clears all cached state. Test-only.
func resetCompletionRecordsCache() {
	completionCacheMu.Lock()
	defer completionCacheMu.Unlock()
	completionCacheEntries = nil
	completionFlights = nil
	completionLastForced = nil
	completionLastFailure = nil
	completionStats = nil
}

// getCompletionIndex returns the collated index for a namespace, refreshing at
// most once per TTL (or immediately when a rate-limit-permitted forced refresh
// is requested). On refresh failure it serves a warm (stale) index when one
// exists; a cold failure returns (nil, err). After a namespace-global failure
// a short cooldown suppresses TTL-driven re-attempts; identity-scoped (401/403)
// failures are per-request and never enter that shared negative cache — caller
// A's denied token must not become a cached error served to caller B.
// Concurrent refreshes single-flight.
func getCompletionIndex(ctx context.Context, namespace string, lister completionRecordLister, forced bool, logger log.Logger) (*completionIndex, error) {
	completionCacheMu.Lock()
	completionCacheInit()

	entry := completionCacheEntries[namespace]
	stats := completionStatsFor(namespace)

	effectiveForced := false
	if forced {
		last, seen := completionLastForced[namespace]
		if !seen || timeNow().Sub(last) >= completionForcedRefreshInterval {
			effectiveForced = true
			completionLastForced[namespace] = timeNow()
		}
	}

	if entry != nil && !effectiveForced && timeNow().Sub(entry.index.asOf) < completionCacheTTL {
		stats.hits++
		idx := entry.index
		completionCacheMu.Unlock()
		return idx, nil
	}
	stats.misses++

	// Negative-cache cooldown: after a recent namespace-global refresh failure,
	// don't re-probe a struggling upstream on every TTL-expired request. Serve
	// the stale index when warm, or replay the sticky error when cold, until
	// the cooldown elapses. A rate-limit-permitted ?refresh=1 bypasses this.
	if !effectiveForced {
		if fail, ok := completionLastFailure[namespace]; ok && timeNow().Sub(fail.at) < completionFailureCooldown {
			if entry != nil {
				stats.staleServes++
				idx := entry.index
				completionCacheMu.Unlock()
				return idx, nil
			}
			err := fail.err
			completionCacheMu.Unlock()
			return nil, err
		}
	}

	if fl := completionFlights[namespace]; fl != nil {
		completionCacheMu.Unlock()
		select {
		case <-fl.done:
			return fl.index, fl.err
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}

	fl := &completionRefreshFlight{done: make(chan struct{})}
	completionFlights[namespace] = fl
	completionCacheMu.Unlock()

	// Detach from the caller's cancellation so a canceled request (panel
	// closed mid-flight) doesn't abort a refresh other waiters depend on,
	// bounded by the aggregate deadline so detached never means unkillable.
	fetchCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), completionAggregateDeadline)
	idx, pages, err := buildCompletionIndex(fetchCtx, namespace, lister, logger)
	cancel()

	completionCacheMu.Lock()
	stats = completionStatsFor(namespace)
	if err == nil {
		stats.refreshes++
		if _, hadFailure := completionLastFailure[namespace]; hadFailure {
			logger.Info("completion index recovered", "namespace", namespace)
		}
		completionCacheEntries[namespace] = &completionCacheEntry{index: idx}
		delete(completionLastFailure, namespace)
		fl.index = idx
		logger.Debug("completion index refreshed",
			"namespace", namespace, "pages", pages, "users", len(idx.byUser),
			"hits", stats.hits, "misses", stats.misses,
			"staleServes", stats.staleServes, "refreshFailures", stats.refreshFailures)
	} else {
		stats.refreshFailures++
		identityScoped := isIdentityScopedCompletionError(err)
		if !identityScoped {
			completionLastFailure[namespace] = completionFailure{at: timeNow(), err: err}
		}
		// Refresh attempts are throttled by TTL + cooldown, so this logs state
		// transitions, not every request.
		logger.Info("completion index refresh failed",
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
	delete(completionFlights, namespace)
	completionCacheMu.Unlock()
	close(fl.done)

	return fl.index, fl.err
}

// buildCompletionIndex drains the namespace LIST across pages — up to the
// aggregate record budget — and collates the records into a per-user index.
func buildCompletionIndex(ctx context.Context, namespace string, lister completionRecordLister, logger log.Logger) (*completionIndex, int, error) {
	var records []completionRecordSpec
	continueToken := ""
	pages := 0
	for {
		page, err := lister.ListPage(ctx, namespace, continueToken)
		if err != nil {
			return nil, pages, err
		}
		pages++
		records = append(records, page.Records...)
		if len(records) >= completionListMaxTotalRecords && page.Continue != "" {
			logger.Warn("completion records LIST truncated at aggregate budget",
				"namespace", namespace, "maxTotalRecords", completionListMaxTotalRecords, "pages", pages)
			break
		}
		if page.Continue == "" {
			break
		}
		continueToken = page.Continue
	}

	return &completionIndex{
		byUser: collateByUser(records),
		asOf:   timeNow(),
	}, pages, nil
}

// collateByUser groups records by userId, then collapses each user's records to
// one entry per (guideSource, guideId), sorted by latest completion descending.
func collateByUser(records []completionRecordSpec) map[string][]collatedCompletion {
	type key struct{ source, id string }
	// Per user: (guideSource,guideId) -> accumulating entry + latest timestamp.
	type acc struct {
		entry      collatedCompletion
		latestTime time.Time
		latestOK   bool
		has        bool
	}

	perUser := map[string]map[key]*acc{}
	for _, rec := range records {
		if rec.UserID == "" {
			continue
		}
		groups := perUser[rec.UserID]
		if groups == nil {
			groups = map[key]*acc{}
			perUser[rec.UserID] = groups
		}
		k := key{rec.GuideSource, rec.GuideID}
		a := groups[k]
		if a == nil {
			a = &acc{entry: collatedCompletion{GuideSource: rec.GuideSource, GuideID: rec.GuideID}}
			groups[k] = a
		}

		a.entry.Count++
		if rec.CompletionPercent > a.entry.MaxCompletionPercent {
			a.entry.MaxCompletionPercent = rec.CompletionPercent
		}

		t, ok := parseCompletionTime(rec.CompletedAt)
		if shouldReplaceLatest(a.latestTime, a.latestOK, a.has, t, ok) {
			a.latestTime, a.latestOK, a.has = t, ok, true
			a.entry.LatestCompletedAt = rec.CompletedAt
			a.entry.LatestSource = rec.Source
			a.entry.GuideTitle = rec.GuideTitle
			a.entry.GuideCategory = rec.GuideCategory
			a.entry.PathID = rec.PathID
		}
	}

	result := map[string][]collatedCompletion{}
	for userID, groups := range perUser {
		entries := make([]collatedCompletion, 0, len(groups))
		for _, a := range groups {
			entries = append(entries, a.entry)
		}
		sort.SliceStable(entries, func(i, j int) bool {
			return completionEntryLess(entries[j], entries[i]) // descending by latestCompletedAt
		})
		result[userID] = entries
	}
	return result
}

// shouldReplaceLatest reports whether a candidate record should become the
// group's latest snapshot. The first record in a group always wins. After
// that, a parseable timestamp beats the current one only when strictly newer;
// a parseable candidate also replaces a current snapshot that had no parseable
// timestamp. When neither parses, the first-seen snapshot is kept for
// determinism.
func shouldReplaceLatest(curTime time.Time, curOK, has bool, t time.Time, ok bool) bool {
	if !has {
		return true
	}
	if ok && curOK {
		return t.After(curTime)
	}
	if ok && !curOK {
		return true
	}
	return false
}

// completionEntryLess orders entries by LatestCompletedAt ascending (parseable
// timestamps chronologically; unparseable ones sort last, then lexically).
func completionEntryLess(x, y collatedCompletion) bool {
	tx, okx := parseCompletionTime(x.LatestCompletedAt)
	ty, oky := parseCompletionTime(y.LatestCompletedAt)
	if okx && oky {
		if tx.Equal(ty) {
			return x.LatestCompletedAt < y.LatestCompletedAt
		}
		return tx.Before(ty)
	}
	if okx != oky {
		return oky // the one that parsed is "smaller" (earlier), so unparseable sorts last in ascending
	}
	return x.LatestCompletedAt < y.LatestCompletedAt
}

// parseCompletionTime parses an ISO 8601 / RFC 3339 completedAt timestamp.
func parseCompletionTime(s string) (time.Time, bool) {
	if s == "" {
		return time.Time{}, false
	}
	if t, err := time.Parse(time.RFC3339Nano, s); err == nil {
		return t, true
	}
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t, true
	}
	return time.Time{}, false
}

// handleMyCompletions serves GET /completion-records/my.
func (a *App) handleMyCompletions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Identity gate first — cache hit or miss, warm bytes are never served to
	// an unauthenticated caller. Missing identity on a GET read is a soft-200
	// capability envelope (not 401): these routes gate whether a feature
	// renders at all, and a bare error status conflates "never works here"
	// with a transient blip.
	userID, ok := deriveCompletionUserID(r)
	if !ok {
		a.writeMyCompletions(w, myCompletionsResponse{
			Capability:  completionCapability{Available: false, Reason: reasonIdentityUnavailable},
			Completions: []collatedCompletion{},
		})
		return
	}

	lister, namespace, available, reason := a.resolveCompletionBackend(r)
	if !available {
		a.writeMyCompletions(w, myCompletionsResponse{
			Capability:  completionCapability{Available: false, Reason: reason},
			Completions: []collatedCompletion{},
		})
		return
	}

	forced := r.URL.Query().Get("refresh") == "1"
	idx, err := getCompletionIndex(r.Context(), namespace, lister, forced, a.ctxLogger(r.Context()))
	if idx == nil {
		// Cold failure: no cache to fall back on.
		if isTerminalCompletionError(err) {
			// Structurally can't serve for this caller ("never works here").
			a.writeMyCompletions(w, myCompletionsResponse{
				Capability:  completionCapability{Available: false, Reason: reasonBackendUnavailable},
				Completions: []collatedCompletion{},
			})
			return
		}
		a.ctxLogger(r.Context()).Debug("completion records unavailable (cold)", "error", err)
		w.Header().Set("Retry-After", strconv.Itoa(completionRetryAfterSeconds))
		a.writeError(w, "completion-records-unavailable", http.StatusServiceUnavailable)
		return
	}

	entries := idx.byUser[userID]
	if entries == nil {
		entries = []collatedCompletion{}
	}
	a.writeMyCompletions(w, myCompletionsResponse{
		Capability:  completionCapability{Available: true},
		UserID:      userID,
		Completions: entries,
		AsOf:        idx.asOf.UTC().Format(time.RFC3339),
	})
}

// handleCompletionCapability serves GET /completion-records/capability: a cheap
// probe of identity + (cached) upstream reachability, with no record data. It
// makes the same transient/terminal distinction as the data route — a probe
// that flips available=false during a 30-second blip would grey out UI for
// everyone, so a cold transient failure is a 503 hiccup, not capability=false.
func (a *App) handleCompletionCapability(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if _, ok := deriveCompletionUserID(r); !ok {
		a.writeJSON(w, completionCapability{Available: false, Reason: reasonIdentityUnavailable}, http.StatusOK)
		return
	}

	lister, namespace, available, reason := a.resolveCompletionBackend(r)
	if !available {
		a.writeJSON(w, completionCapability{Available: false, Reason: reason}, http.StatusOK)
		return
	}

	// Reuse the cache (never a per-call forced LIST): a usable index — fresh or
	// stale-on-error — means the CRUD API answered recently.
	idx, err := getCompletionIndex(r.Context(), namespace, lister, false, a.ctxLogger(r.Context()))
	if idx == nil {
		if isTerminalCompletionError(err) {
			a.writeJSON(w, completionCapability{Available: false, Reason: reasonBackendUnavailable}, http.StatusOK)
			return
		}
		w.Header().Set("Retry-After", strconv.Itoa(completionRetryAfterSeconds))
		a.writeError(w, "completion-records-unavailable", http.StatusServiceUnavailable)
		return
	}
	a.writeJSON(w, completionCapability{Available: true}, http.StatusOK)
}

func (a *App) writeMyCompletions(w http.ResponseWriter, resp myCompletionsResponse) {
	a.writeJSON(w, resp, http.StatusOK)
}

// resolveCompletionBackend determines whether the aggregated CRUD API is
// structurally reachable for this request and returns a lister to use.
// "Structurally unavailable" (feature toggle off, no app URL, no namespace) is
// a "never works here" condition surfaced as capability=false, distinct from a
// transient LIST failure. The namespace comes from the trusted plugin context,
// never from a query parameter. Config resolution runs before the test-only
// lister override so the structural-unavailability branch stays testable.
func (a *App) resolveCompletionBackend(r *http.Request) (lister completionRecordLister, namespace string, available bool, reason string) {
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

	if completionListerOverride != nil {
		return completionListerOverride, namespace, true, ""
	}

	idToken := r.Header.Get(backend.GrafanaUserSignInTokenHeaderName)
	return newCompletionHTTPClient(appURL, idToken, a.ctxLogger(r.Context())), namespace, true, ""
}

// isTerminalCompletionError reports whether an upstream failure is terminal
// (a non-transient 4xx per RFC §6.9). Network/timeout/decoding errors have no
// HTTP status and are treated as transient (retryable).
func isTerminalCompletionError(err error) bool {
	var ue *appPlatformUpstreamError
	if errors.As(err, &ue) {
		return !isTransientUpstreamStatus(ue.status)
	}
	return false
}

// isIdentityScopedCompletionError reports whether an upstream failure means
// the aggregator rejected this caller's forwarded identity (401/403).
func isIdentityScopedCompletionError(err error) bool {
	var ue *appPlatformUpstreamError
	if errors.As(err, &ue) {
		return isIdentityScopedUpstreamStatus(ue.status)
	}
	return false
}
