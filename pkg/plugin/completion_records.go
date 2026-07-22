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
	"github.com/grafana/grafana-plugin-sdk-go/config"
)

// Completion Records read proxy.
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

	// completionFailureCooldown is a negative-cache window: after an upstream
	// refresh fails, TTL-expired re-attempts are suppressed for this long so a
	// sustained outage doesn't re-trigger a full-namespace LIST on every
	// sequential request. Mirrors package_recommendations.go's sticky failure.
	completionFailureCooldown = 30 * time.Second

	// completionRetryAfterSeconds is the Retry-After hint on a cold 503.
	completionRetryAfterSeconds = 30

	reasonIdentityUnavailable = "identity-unavailable"
	reasonBackendUnavailable  = "backend-unavailable"
)

// completionCapability is the availability signal the front-end and epic PRs
// 4/5 gate UX on. It answers "can this instance do durable completion records
// for this caller?" without status-code archaeology.
type completionCapability struct {
	CompletionRecordingAvailable bool   `json:"completionRecordingAvailable"`
	Reason                       string `json:"reason"`
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
// distinct (user, guide) pairs, not completion volume.
type completionIndex struct {
	byUser map[string][]collatedCompletion
	asOf   time.Time
}

type completionCacheEntry struct {
	index *completionIndex
}

// completionFailure records the most recent upstream refresh failure for a
// namespace so the cooldown can suppress re-probes and cold callers can still
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

var (
	completionCacheMu      sync.Mutex
	completionCacheEntries map[string]*completionCacheEntry
	completionFlights      map[string]*completionRefreshFlight
	completionLastForced   map[string]time.Time
	completionLastFailure  map[string]completionFailure

	// completionListerOverride injects a fake lister in tests. nil selects the
	// real per-request HTTP client.
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
}

// resetCompletionRecordsCache clears all cached state. Test-only.
func resetCompletionRecordsCache() {
	completionCacheMu.Lock()
	defer completionCacheMu.Unlock()
	completionCacheEntries = nil
	completionFlights = nil
	completionLastForced = nil
	completionLastFailure = nil
}

// getCompletionIndex returns the collated index for a namespace, refreshing at
// most once per TTL (or immediately when a rate-limit-permitted forced refresh
// is requested). On refresh failure it serves a warm (stale) index when one
// exists; a cold failure returns (nil, err). After a failure a short cooldown
// suppresses TTL-driven re-attempts so a sustained outage isn't re-probed on
// every request. Concurrent refreshes single-flight.
func getCompletionIndex(ctx context.Context, namespace string, lister completionRecordLister, forced bool) (*completionIndex, error) {
	completionCacheMu.Lock()
	completionCacheInit()

	entry := completionCacheEntries[namespace]

	effectiveForced := false
	if forced {
		last, seen := completionLastForced[namespace]
		if !seen || timeNow().Sub(last) >= completionForcedRefreshInterval {
			effectiveForced = true
			completionLastForced[namespace] = timeNow()
		}
	}

	if entry != nil && !effectiveForced && timeNow().Sub(entry.index.asOf) < completionCacheTTL {
		idx := entry.index
		completionCacheMu.Unlock()
		return idx, nil
	}

	// Negative-cache cooldown: after a recent refresh failure, don't re-probe a
	// struggling upstream on every TTL-expired request. Serve the stale index
	// when warm, or replay the sticky error when cold, until the cooldown
	// elapses. A rate-limit-permitted forced refresh (?refresh=1) bypasses this.
	if !effectiveForced {
		if fail, ok := completionLastFailure[namespace]; ok && timeNow().Sub(fail.at) < completionFailureCooldown {
			if entry != nil {
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
	// closed mid-flight) doesn't abort a refresh other waiters depend on.
	idx, err := buildCompletionIndex(context.WithoutCancel(ctx), namespace, lister)

	completionCacheMu.Lock()
	if err == nil {
		completionCacheEntries[namespace] = &completionCacheEntry{index: idx}
		delete(completionLastFailure, namespace)
		fl.index = idx
	} else {
		completionLastFailure[namespace] = completionFailure{at: timeNow(), err: err}
		if entry != nil {
			// Warm cache + upstream failure: serve stale. asOf reflects true age.
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

// buildCompletionIndex drains the namespace LIST across all pages and collates
// the records into a per-user index.
func buildCompletionIndex(ctx context.Context, namespace string, lister completionRecordLister) (*completionIndex, error) {
	var records []completionRecordSpec
	continueToken := ""
	for {
		page, err := lister.ListPage(ctx, namespace, continueToken)
		if err != nil {
			return nil, err
		}
		records = append(records, page.Records...)
		if page.Continue == "" {
			break
		}
		continueToken = page.Continue
	}

	return &completionIndex{
		byUser: collateByUser(records),
		asOf:   timeNow(),
	}, nil
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

	userID, ok := deriveCompletionUserID(r)
	if !ok {
		a.writeMyCompletions(w, myCompletionsResponse{
			Capability:  completionCapability{CompletionRecordingAvailable: false, Reason: reasonIdentityUnavailable},
			Completions: []collatedCompletion{},
		})
		return
	}

	lister, namespace, available, reason := a.resolveCompletionBackend(r)
	if !available {
		a.writeMyCompletions(w, myCompletionsResponse{
			Capability:  completionCapability{CompletionRecordingAvailable: false, Reason: reason},
			Completions: []collatedCompletion{},
		})
		return
	}

	forced := r.URL.Query().Get("refresh") == "1"
	idx, err := getCompletionIndex(r.Context(), namespace, lister, forced)
	if idx == nil {
		// Cold failure: no cache to fall back on.
		if isTerminalCompletionError(err) {
			// Structurally can't serve for this caller ("never works here").
			a.writeMyCompletions(w, myCompletionsResponse{
				Capability:  completionCapability{CompletionRecordingAvailable: false, Reason: reasonBackendUnavailable},
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
		Capability:  completionCapability{CompletionRecordingAvailable: true},
		UserID:      userID,
		Completions: entries,
		AsOf:        idx.asOf.UTC().Format(time.RFC3339),
	})
}

// handleCompletionCapability serves GET /completion-records/capability: a cheap
// probe of identity + (cached) upstream reachability, with no record data.
func (a *App) handleCompletionCapability(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if _, ok := deriveCompletionUserID(r); !ok {
		a.writeJSON(w, completionCapability{CompletionRecordingAvailable: false, Reason: reasonIdentityUnavailable}, http.StatusOK)
		return
	}

	lister, namespace, available, reason := a.resolveCompletionBackend(r)
	if !available {
		a.writeJSON(w, completionCapability{CompletionRecordingAvailable: false, Reason: reason}, http.StatusOK)
		return
	}

	// Reuse the cache (never a per-call forced LIST): a usable index — fresh or
	// stale-on-error — means the CRUD API answered recently, so recording works.
	idx, _ := getCompletionIndex(r.Context(), namespace, lister, false)
	if idx == nil {
		a.writeJSON(w, completionCapability{CompletionRecordingAvailable: false, Reason: reasonBackendUnavailable}, http.StatusOK)
		return
	}
	a.writeJSON(w, completionCapability{CompletionRecordingAvailable: true}, http.StatusOK)
}

func (a *App) writeMyCompletions(w http.ResponseWriter, resp myCompletionsResponse) {
	a.writeJSON(w, resp, http.StatusOK)
}

// resolveCompletionBackend determines whether the aggregated CRUD API is
// structurally reachable for this request and returns a lister to use.
// "Structurally unavailable" (feature toggle off, no app URL, no namespace) is
// a "never works here" condition surfaced as capability=false, distinct from a
// transient LIST failure.
func (a *App) resolveCompletionBackend(r *http.Request) (lister completionRecordLister, namespace string, available bool, reason string) {
	namespace = backend.PluginConfigFromContext(r.Context()).Namespace

	if completionListerOverride != nil {
		return completionListerOverride, namespace, true, ""
	}

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
	return newCompletionHTTPClient(appURL, r.Header), namespace, true, ""
}

// pathfinderBackendAggregationToggle mirrors the front-end availability check
// in src/utils/fetchBackendGuides.ts: the boot-time toggle the aggregation
// layer sets when the pathfinderbackend API is served on this instance.
const pathfinderBackendAggregationToggle = "aggregation.pathfinderbackend-ext-grafana-com.enabled"

// isTerminalCompletionError reports whether an upstream failure is terminal
// (a non-transient 4xx per RFC §6.9). Network/timeout/decoding errors have no
// HTTP status and are treated as transient (retryable).
func isTerminalCompletionError(err error) bool {
	var ue *completionUpstreamError
	if errors.As(err, &ue) {
		return !isTransientUpstreamStatus(ue.status)
	}
	return false
}
