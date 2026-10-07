package plugin

import (
	"context"
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
	// request. Only failures positively classified as namespace-global enter this
	// shared negative cache — see completionCache.get.
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

	// reasonIdentityUnverifiable separates "this stack can never check a
	// caller's ID token" — no app URL, so no verifier can be built for this
	// stack, or no server-derived namespace to bind one to — from "the caller
	// has no valid one".
	reasonIdentityUnverifiable = "identity-unverifiable"

	// reasonSigningKeysUnreachable separates "we could not reach any
	// signing-keys endpoint" from both of the above. A source that ANSWERS
	// without the token's `kid` is the expected Grafana Cloud shape and reports
	// reasonIdentityUnavailable; arriving here means no source answered at all,
	// which points at the configured address rather than at the caller.
	reasonSigningKeysUnreachable = "signing-keys-unreachable"
)

// completionListMaxTotalRecords is the aggregate budget across all LIST pages
// of one drain (the per-page byte cap alone does not bound total memory).
// When the budget trips, the drain stops and logs the truncation — never
// silently. A var so tests can exercise the budget path.
var completionListMaxTotalRecords = 50_000

// deriveCompletionUserID is the canonical identity contract for the whole
// Completion Records epic: the caller's VERIFIED ID-token `sub` claim VERBATIM,
// typed prefix included (e.g. "user:abc123"). Reads and writes must join on the
// same key — epic PR 4's write hook MUST stamp `spec.userId` with this exact
// helper. Returns the identity-gate status alongside it, fail closed with no
// login/numeric fallback; see app_platform_identity.go and the trust boundary
// in docs/design/BACKEND_PROXY_PATTERN.md §3.
func (a *App) deriveCompletionUserID(r *http.Request) (string, identityStatus) {
	return a.subjectFromIDToken(r)
}

// completionCapability is the availability signal the front-end and epic PRs
// 4/5 gate UX on. `available` is read-derived — it measures identity presence
// plus read-path reachability of the completionrecords API on this stack; it
// does not verify write permission (the write hook must not treat it as a
// write guarantee).
type completionCapability struct {
	Diagnostics *guideProxyDiagnostic `json:"diagnostics,omitempty"`
	Available   bool                  `json:"available"`
	Reason      string                `json:"reason,omitempty"`
	// ProgressRecords advertises that this plugin build accepts attempt
	// upserts (a write body with attemptId). Set whenever Available is. It says
	// what the build supports, not what the caller may write.
	ProgressRecords bool `json:"progressRecords,omitempty"`
}

// inProgressCompletion is a guide the user has started but whose most recent
// activity is an unfinished attempt.
type inProgressCompletion struct {
	GuideSource       string `json:"guideSource"`
	GuideID           string `json:"guideId"`
	GuideTitle        string `json:"guideTitle"`
	GuideCategory     string `json:"guideCategory"`
	PathID            string `json:"pathId"`
	CompletionPercent int64  `json:"completionPercent"`
	LastUpdatedAt     string `json:"lastUpdatedAt"`
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
	Diagnostics *guideProxyDiagnostic `json:"diagnostics,omitempty"`
	Capability  completionCapability  `json:"capability"`
	UserID      string                `json:"userId,omitempty"`
	Completions []collatedCompletion  `json:"completions"`
	// InProgress is always present ([] when empty); writeMyCompletions
	// normalizes a nil slice.
	InProgress []inProgressCompletion `json:"inProgress"`
	AsOf       string                 `json:"asOf,omitempty"`
}

// completionIndex is the collated, per-user view of a namespace's records.
// Raw records are dropped after collation, so the footprint is bounded by
// distinct (user, guide) pairs, not completion volume. Serving reads only
// idx.byUser[caller] — a cache hit is structurally incapable of exposing
// another user's slice.
type completionIndex struct {
	byUser           map[string][]collatedCompletion
	inProgressByUser map[string][]inProgressCompletion
	asOf             time.Time
}

type completionCacheEntry struct {
	index *completionIndex

	// stale marks an entry a write has superseded: too old to serve on the TTL
	// fast path, but still worth keeping as the fallback when the refresh it
	// forces fails. See completionCache.invalidate.
	stale bool
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
	done       chan struct{}
	generation uint64
	index      *completionIndex
	err        error
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

// completionCache is one App instance's read cache. Its maps are keyed by the
// trusted-context namespace (never caller-supplied), so on hosted Grafana the
// key space is one entry per instance — the maps need no eviction.
type completionCache struct {
	mu          sync.Mutex
	entries     map[string]*completionCacheEntry
	flights     map[string]*completionRefreshFlight
	lastForced  map[string]time.Time
	lastFailure map[string]completionFailure
	stats       map[string]*completionCacheStats
	generations map[string]uint64
}

func newCompletionCache() *completionCache {
	return &completionCache{
		entries:     map[string]*completionCacheEntry{},
		flights:     map[string]*completionRefreshFlight{},
		lastForced:  map[string]time.Time{},
		lastFailure: map[string]completionFailure{},
		stats:       map[string]*completionCacheStats{},
		generations: map[string]uint64{},
	}
}

var (
	// completionListerOverride injects a fake lister in tests. nil selects the
	// real per-request HTTP client. Config resolution (feature toggle, app
	// URL, namespace) is checked BEFORE this override so the structural-
	// unavailability path stays testable.
	completionListerOverride completionRecordLister

	// completionCreatorOverride injects a fake creator in tests (write path),
	// mirroring completionListerOverride. Config resolution is checked BEFORE
	// this override so the structural-unavailability path stays testable.
	completionCreatorOverride completionRecordCreator
)

func (c *completionCache) statsFor(namespace string) *completionCacheStats {
	s := c.stats[namespace]
	if s == nil {
		s = &completionCacheStats{}
		c.stats[namespace] = s
	}
	return s
}

// invalidate stales a namespace's collated read cache so the
// next GET /completion-records/my refreshes from upstream. Called after a
// successful write so the new record surfaces promptly rather than after the
// TTL. The failure cooldown is cleared too: a successful create is fresh proof
// the upstream is reachable, and a lingering cooldown would replay a stale
// error to exactly the post-write read this invalidation serves. Forced/stats
// bookkeeping is left intact.
//
// The entry is marked stale rather than deleted, and that distinction is the
// whole point: get serves a warm-but-stale index when a refresh
// fails, so deleting here would throw that fallback away on every write —
// turning the next upstream blip into a cold 503 for a reader who could have
// had a slightly-stale 200. Marking it skips the TTL fast path (which is what
// actually forces the refresh — the generation bump only coalesces in-flight
// refreshes) while leaving the fallback intact.
func (c *completionCache) invalidate(namespace string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.generations[namespace]++
	if entry := c.entries[namespace]; entry != nil {
		c.entries[namespace] = &completionCacheEntry{index: entry.index, stale: true}
	}
	delete(c.lastFailure, namespace)
}

// get returns the collated index for a namespace, refreshing at
// most once per TTL (or immediately when a rate-limit-permitted forced refresh
// is requested). On refresh failure it serves a warm (stale) index when one
// exists; a cold failure returns (nil, err). After a namespace-global failure
// a short cooldown suppresses TTL-driven re-attempts; only failures positively
// classified as namespace-global enter that shared negative cache — caller A's
// denied token or failed token mint must not become a cached error served to
// caller B. Concurrent refreshes single-flight.
func (c *completionCache) get(ctx context.Context, namespace string, lister completionRecordLister, forced bool, logger log.Logger) (*completionIndex, error) {
	c.mu.Lock()

	entry := c.entries[namespace]
	stats := c.statsFor(namespace)

	effectiveForced := false
	if forced {
		last, seen := c.lastForced[namespace]
		if !seen || timeNow().Sub(last) >= completionForcedRefreshInterval {
			effectiveForced = true
			c.lastForced[namespace] = timeNow()
		}
	}

	if entry != nil && !entry.stale && !effectiveForced && timeNow().Sub(entry.index.asOf) < completionCacheTTL {
		stats.hits++
		idx := entry.index
		c.mu.Unlock()
		return idx, nil
	}
	stats.misses++

	// Negative-cache cooldown: after a recent namespace-global refresh failure,
	// don't re-probe a struggling upstream on every TTL-expired request. Serve
	// the stale index when warm, or replay the sticky error when cold, until
	// the cooldown elapses. A rate-limit-permitted ?refresh=1 bypasses this.
	if !effectiveForced {
		if fail, ok := c.lastFailure[namespace]; ok && timeNow().Sub(fail.at) < completionFailureCooldown {
			if entry != nil {
				stats.staleServes++
				idx := entry.index
				c.mu.Unlock()
				return idx, nil
			}
			err := fail.err
			c.mu.Unlock()
			return nil, err
		}
	}

	generation := c.generations[namespace]
	if fl := c.flights[namespace]; fl != nil && fl.generation == generation {
		c.mu.Unlock()
		select {
		case <-fl.done:
			return fl.index, fl.err
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}

	fl := &completionRefreshFlight{done: make(chan struct{}), generation: generation}
	c.flights[namespace] = fl
	c.mu.Unlock()

	// Detach from the caller's cancellation so a canceled request (panel
	// closed mid-flight) doesn't abort a refresh other waiters depend on,
	// bounded by the aggregate deadline so detached never means unkillable.
	fetchCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), completionAggregateDeadline)
	idx, pages, err := buildCompletionIndex(fetchCtx, namespace, lister, logger)
	cancel()

	c.mu.Lock()
	stats = c.statsFor(namespace)
	if c.generations[namespace] != fl.generation {
		// Fenced off by a concurrent write: this result serves its own waiters but
		// must not repopulate the cache. It is still counted, or the per-namespace
		// vital signs (§9) stop reconciling against stats.misses exactly when the
		// write path is busiest — the condition an operator would be diagnosing.
		if err == nil {
			stats.refreshes++
			fl.index = idx
		} else {
			stats.refreshFailures++
			if entry != nil {
				stats.staleServes++
				fl.index = entry.index
			}
			fl.err = err
		}
		if c.flights[namespace] == fl {
			delete(c.flights, namespace)
		}
		c.mu.Unlock()
		close(fl.done)
		return fl.index, fl.err
	}
	if err == nil {
		stats.refreshes++
		if _, hadFailure := c.lastFailure[namespace]; hadFailure {
			logger.Info("completion index recovered", "namespace", namespace)
		}
		c.entries[namespace] = &completionCacheEntry{index: idx}
		delete(c.lastFailure, namespace)
		fl.index = idx
		logger.Debug("completion index refreshed",
			"namespace", namespace, "pages", pages, "users", len(idx.byUser),
			"hits", stats.hits, "misses", stats.misses,
			"staleServes", stats.staleServes, "refreshFailures", stats.refreshFailures)
	} else {
		stats.refreshFailures++
		namespaceGlobal := isNamespaceGlobalCompletionError(err)
		if namespaceGlobal {
			c.lastFailure[namespace] = completionFailure{at: timeNow(), err: err}
		}
		// Refresh attempts are throttled by TTL + cooldown, so this logs state
		// transitions, not every request.
		logger.Info("completion index refresh failed",
			"namespace", namespace, "reason", classifyGuideProxyError(err).Reason,
			"namespaceGlobal", namespaceGlobal, "servingStale", entry != nil,
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
	if c.flights[namespace] == fl {
		delete(c.flights, namespace)
	}
	c.mu.Unlock()
	close(fl.done)

	return fl.index, fl.err
}

// buildCompletionIndex drains the namespace LIST across pages — up to the
// aggregate record budget — and collates the records into a per-user index.
func buildCompletionIndex(ctx context.Context, namespace string, lister completionRecordLister, logger log.Logger) (*completionIndex, int, error) {
	records, pages, err := drainCompletionRecords(ctx, namespace, lister, completionListMaxTotalRecords, logger)
	if err != nil {
		return nil, pages, err
	}
	byUser, inProgressByUser := collateCompletions(records)
	return &completionIndex{
		byUser:           byUser,
		inProgressByUser: inProgressByUser,
		asOf:             timeNow(),
	}, pages, nil
}

// drainCompletionRecords is the raw LIST buildCompletionIndex collates. The
// assignment join uses it directly: collation drops the per-row completedAt
// the obligation criteria test. maxRecords of 0 means no cap.
func drainCompletionRecords(ctx context.Context, namespace string, lister completionRecordLister, maxRecords int, logger log.Logger) ([]completionRecordSpec, int, error) {
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
		if maxRecords > 0 && len(records) >= maxRecords && page.Continue != "" {
			logger.Warn("completion records LIST truncated at aggregate budget",
				"namespace", namespace, "maxTotalRecords", maxRecords, "pages", pages)
			break
		}
		if page.Continue == "" {
			break
		}
		continueToken = page.Continue
	}
	return records, pages, nil
}

// collateCompletions groups records by userId, then collapses each user's
// records to one entry per (guideSource, guideId), sorted by latest completion
// descending.
//
// Only a record with a completedAt is a completion: it alone feeds count, the
// latest fields and maxCompletionPercent, and only guides with at least one
// appear in completions. Every legacy record has a completedAt (it was
// required), whatever its percent, so legacy collation is unchanged. An attempt
// record has none until it reaches 100%, so a record without one is an
// unfinished attempt. Per guide, the
// newest attempt is reported in inProgress only if it started after the last
// completion. Server arrival time cannot order delayed writes after a reset.
func collateCompletions(records []completionRecordSpec) (map[string][]collatedCompletion, map[string][]inProgressCompletion) {
	type key struct{ source, id string }
	// Per user: (guideSource,guideId) -> accumulating entry + latest timestamp.
	type acc struct {
		entry      collatedCompletion
		latestTime time.Time
		latestOK   bool
		has        bool

		// Latest completion event time, independent of retry arrival.
		doneUpdated   time.Time
		doneUpdatedOK bool

		partial     inProgressCompletion
		partialTime time.Time
		partialOK   bool
		hasPartial  bool
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

		updated, updatedOK := parseCompletionTime(rec.CompletedAt)
		if rec.CompletedAt == "" {
			updated, updatedOK = parseCompletionTime(rec.AttemptStartedAt)
			if !updatedOK {
				updated, updatedOK = parseCompletionTime(rec.LastUpdatedAt)
			}
			if shouldReplaceLatest(a.partialTime, a.partialOK, a.hasPartial, updated, updatedOK) {
				a.partialTime, a.partialOK, a.hasPartial = updated, updatedOK, true
				a.partial = inProgressCompletion{
					GuideSource:       rec.GuideSource,
					GuideID:           rec.GuideID,
					GuideTitle:        rec.GuideTitle,
					GuideCategory:     rec.GuideCategory,
					PathID:            rec.PathID,
					CompletionPercent: rec.CompletionPercent,
					LastUpdatedAt:     rec.LastUpdatedAt,
				}
			}
			continue
		}
		if updatedOK && (!a.doneUpdatedOK || updated.After(a.doneUpdated)) {
			a.doneUpdated, a.doneUpdatedOK = updated, true
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
	inProgress := map[string][]inProgressCompletion{}
	for userID, groups := range perUser {
		entries := make([]collatedCompletion, 0, len(groups))
		var partials []inProgressCompletion
		for _, a := range groups {
			if a.entry.Count > 0 {
				entries = append(entries, a.entry)
			}
			// A partial shows when nothing is completed yet, or when it is
			// provably newer than the latest completed record.
			if a.hasPartial && (a.entry.Count == 0 || (a.partialOK && a.doneUpdatedOK && a.partialTime.After(a.doneUpdated))) {
				partials = append(partials, a.partial)
			}
		}
		sort.SliceStable(entries, func(i, j int) bool {
			return completionEntryLess(entries[j], entries[i]) // descending by latestCompletedAt
		})
		sort.SliceStable(partials, func(i, j int) bool {
			return inProgressLess(partials[j], partials[i]) // descending by lastUpdatedAt
		})
		if len(entries) > 0 {
			result[userID] = entries
		}
		if len(partials) > 0 {
			inProgress[userID] = partials
		}
	}
	return result, inProgress
}

// inProgressLess orders partials by LastUpdatedAt ascending, the same way
// completionEntryLess orders completions, with a guide-identity tiebreak so
// the order is deterministic.
func inProgressLess(x, y inProgressCompletion) bool {
	tx, okx := parseCompletionTime(x.LastUpdatedAt)
	ty, oky := parseCompletionTime(y.LastUpdatedAt)
	if okx && oky && !tx.Equal(ty) {
		return tx.Before(ty)
	}
	if okx != oky {
		return oky
	}
	if x.GuideSource != y.GuideSource {
		return x.GuideSource > y.GuideSource
	}
	return x.GuideID > y.GuideID
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
	// an unauthenticated caller. Every identity failure on a GET read is a
	// soft-200 capability envelope (not 401, not 503), because none of them is
	// retryable and the reason token says which one it was. A client that caches
	// `available:false` but not a thrown 503 makes the envelope STICKIER than
	// the 503 it replaced, which is the accepted cost of the standing-condition
	// classification (see custom_guide_repository.go for the live case).
	userID, status := a.deriveCompletionUserID(r)
	if status != identityVerified {
		a.writeMyCompletions(w, myCompletionsResponse{
			Capability:  completionCapability{Available: false, Reason: status.capabilityReason(), Diagnostics: proxyGateDiagnostic("identity-unavailable", "completionrecords", "list", "identity")},
			Completions: []collatedCompletion{},
		})
		return
	}

	lister, namespace, available, reason := a.resolveCompletionBackend(r)
	if !available {
		a.writeMyCompletions(w, myCompletionsResponse{
			Capability:  completionCapability{Available: false, Reason: reason, Diagnostics: proxyGateDiagnostic("proxy-unavailable", "completionrecords", "list", "configuration")},
			Completions: []collatedCompletion{},
		})
		return
	}

	forced := r.URL.Query().Get("refresh") == "1"
	idx, err := a.completions.get(r.Context(), namespace, lister, forced, a.ctxLogger(r.Context()))
	if idx == nil {
		// Cold failure: no cache to fall back on.
		if isTerminalCompletionError(err) {
			// Structurally can't serve for this caller ("never works here").
			a.writeMyCompletions(w, myCompletionsResponse{
				Capability:  completionCapability{Available: false, Reason: reasonBackendUnavailable, Diagnostics: appPlatformDiagnostic(err, "completionrecords", "list")},
				Completions: []collatedCompletion{},
			})
			return
		}
		a.ctxLogger(r.Context()).Debug("completion records unavailable (cold)", "reason", classifyGuideProxyError(err).Reason)
		a.writeCompletionUnavailable(w, err)
		return
	}

	diagnostic := appPlatformDiagnostic(err, "completionrecords", "list")
	if diagnostic != nil {
		diagnostic.Outcome, diagnostic.Cache = "degraded", "stale"
		diagnostic.CacheAgeMS = max(0, timeNow().Sub(idx.asOf).Milliseconds())
	}
	a.writeMyCompletions(w, myCompletionsResponse{
		Capability:  completionCapability{Available: true, ProgressRecords: true},
		Diagnostics: diagnostic,
		UserID:      userID,
		Completions: idx.byUser[userID],
		InProgress:  idx.inProgressByUser[userID],
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

	if _, status := a.deriveCompletionUserID(r); status != identityVerified {
		a.writeJSON(w, completionCapability{Available: false, Reason: status.capabilityReason(), Diagnostics: proxyGateDiagnostic("identity-unavailable", "completionrecords", "list", "identity")}, http.StatusOK)
		return
	}

	lister, namespace, available, reason := a.resolveCompletionBackend(r)
	if !available {
		a.writeJSON(w, completionCapability{Available: false, Reason: reason, Diagnostics: proxyGateDiagnostic("proxy-unavailable", "completionrecords", "list", "configuration")}, http.StatusOK)
		return
	}

	// Reuse the cache (never a per-call forced LIST): a usable index — fresh or
	// stale-on-error — means the CRUD API answered recently.
	idx, err := a.completions.get(r.Context(), namespace, lister, false, a.ctxLogger(r.Context()))
	if idx == nil {
		if isTerminalCompletionError(err) {
			a.writeJSON(w, completionCapability{Available: false, Reason: reasonBackendUnavailable, Diagnostics: appPlatformDiagnostic(err, "completionrecords", "list")}, http.StatusOK)
			return
		}
		a.writeCompletionUnavailable(w, err)
		return
	}
	diagnostic := appPlatformDiagnostic(err, "completionrecords", "list")
	if diagnostic != nil {
		diagnostic.Outcome, diagnostic.Cache = "degraded", "stale"
		diagnostic.CacheAgeMS = max(0, timeNow().Sub(idx.asOf).Milliseconds())
	}
	a.writeJSON(w, completionCapability{Available: true, ProgressRecords: true, Diagnostics: diagnostic}, http.StatusOK)
}

func (a *App) writeMyCompletions(w http.ResponseWriter, resp myCompletionsResponse) {
	// Both arrays are always present on the wire, never null.
	if resp.Completions == nil {
		resp.Completions = []collatedCompletion{}
	}
	if resp.InProgress == nil {
		resp.InProgress = []inProgressCompletion{}
	}
	a.writeJSON(w, resp, http.StatusOK)
}

// writeCompletionUnavailable serves BACKEND_PROXY_PATTERN.md §7's transient
// hiccup — 503 plus a Retry-After hint, never a capability envelope — so both
// completion routes answer every retryable failure in one shape.
func (a *App) writeCompletionUnavailable(w http.ResponseWriter, err error) {
	w.Header().Set("Retry-After", strconv.Itoa(completionRetryAfterSeconds))
	a.writeProxyError(w, "completion-records-unavailable", http.StatusServiceUnavailable, appPlatformDiagnostic(err, "completionrecords", "list"))
}

// resolveCompletionBackend determines whether the aggregated CRUD API is
// structurally reachable for this request and returns a lister to use.
// "Structurally unavailable" (feature toggle off, no app URL, no namespace, no
// provisioned on-behalf-of credential) is a "never works here" condition
// surfaced as capability=false, distinct from a transient LIST failure. The
// namespace comes from the trusted plugin context, never from a query
// parameter. Config resolution runs before the test-only lister override so the
// structural-unavailability branch stays testable.
func (a *App) resolveCompletionBackend(r *http.Request) (lister completionRecordLister, namespace string, available bool, reason string) {
	appURL, namespace, idToken, available, reason := a.resolveCompletionConfig(r)
	if !available {
		return nil, namespace, false, reason
	}
	if completionListerOverride != nil {
		return completionListerOverride, namespace, true, ""
	}
	if a.oboExchanger == nil {
		return nil, namespace, false, reasonOBOUnavailable
	}
	return newCompletionHTTPClient(appURL, a.oboExchanger, idToken, a.ctxLogger(r.Context())), namespace, true, ""
}

// resolveCompletionWriteBackend is the write-path companion to
// resolveCompletionBackend: same structural-availability gate, but it returns a
// creator (POST) and honors completionCreatorOverride for tests.
//
// The nil-exchanger guard is repeated here rather than folded into
// resolveCompletionConfig because each resolver applies it AFTER its own test
// override, and because it must not be possible to add a third resolver that
// silently inherits a real client with no credential. A stack with no
// provisioned on-behalf-of token takes the structural path (→ 404 → the front
// end disarms the session and keeps its queued facts), never a hard failure.
func (a *App) resolveCompletionWriteBackend(r *http.Request) (creator completionRecordCreator, namespace string, available bool, reason string) {
	appURL, namespace, idToken, available, reason := a.resolveCompletionConfig(r)
	if !available {
		return nil, namespace, false, reason
	}
	if completionCreatorOverride != nil {
		return completionCreatorOverride, namespace, true, ""
	}
	if a.oboExchanger == nil {
		return nil, namespace, false, reasonOBOUnavailable
	}
	return newCompletionHTTPClient(appURL, a.oboExchanger, idToken, a.ctxLogger(r.Context())), namespace, true, ""
}

// resolveCompletionConfig resolves the shared "is the aggregated CRUD API
// structurally reachable?" gate for both the read and write proxies: feature
// toggle on, an app URL, and a trusted-context namespace (never a query param).
// Returns available=false with a machine reason when any is missing.
func (a *App) resolveCompletionConfig(r *http.Request) (appURL, namespace, idToken string, available bool, reason string) {
	namespace = backend.PluginConfigFromContext(r.Context()).Namespace

	cfg := config.GrafanaConfigFromContext(r.Context())
	if cfg == nil {
		return "", namespace, "", false, reasonBackendUnavailable
	}
	if !cfg.FeatureToggles().IsEnabled(completionRecordsAggregationToggle) {
		return "", namespace, "", false, reasonBackendUnavailable
	}
	appURL, err := cfg.AppURL()
	if err != nil || appURL == "" || namespace == "" {
		return "", namespace, "", false, reasonBackendUnavailable
	}
	idToken = r.Header.Get(backend.GrafanaUserSignInTokenHeaderName)
	return appURL, namespace, idToken, true, ""
}

// isTerminalCompletionError reports whether an upstream failure is terminal
// (a non-transient 4xx per RFC §6.9). Network/timeout/decoding errors have no
// HTTP status and are treated as transient (retryable). Thin domain alias over
// the shared classifier so both proxies share one definition of the logic.
func isTerminalCompletionError(err error) bool {
	return isTerminalUpstreamError(err)
}

// isNamespaceGlobalCompletionError reports whether an upstream failure may be
// shared across callers through the negative cache. Thin domain alias over the
// shared classifier.
func isNamespaceGlobalCompletionError(err error) bool {
	return isNamespaceGlobalUpstreamError(err)
}
