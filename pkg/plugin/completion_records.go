package plugin

import (
	"context"
	"github.com/grafana/grafana-pathfinder-app/pkg/services"
	"net/http"
	"strconv"
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
	// shared negative cache — see getCompletionIndex.
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
type inProgressCompletion = services.InProgressCompletion

// collatedCompletion is one entry per (guideSource, guideId) for a single user.
type collatedCompletion = services.CollatedCompletion

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
// idx.ByUser[caller] — a cache hit is structurally incapable of exposing
// another user's slice.
type completionIndex = services.CompletionIndex

var completionListerOverride completionRecordLister
var completionCreatorOverride completionRecordCreator

func resetCompletionRecordsCache()               { services.ResetCompletionCache() }
func invalidateCompletionIndex(namespace string) { services.InvalidateCompletionIndex(namespace) }
func getCompletionIndex(ctx context.Context, namespace string, lister completionRecordLister, forced bool, logger log.Logger) (*completionIndex, error) {
	return services.LoadCompletionIndex(ctx, namespace, forced, logger, func(ctx context.Context) (*completionIndex, int, error) {
		return buildCompletionIndex(ctx, namespace, lister, logger)
	}, func() time.Time { return timeNow() }, isNamespaceGlobalCompletionError, func(err error) string { return classifyGuideProxyError(err).Reason })
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
		ByUser:           byUser,
		InProgressByUser: inProgressByUser,
		AsOf:             timeNow(),
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
	return services.CollateCompletions(records)
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
	idx, err := getCompletionIndex(r.Context(), namespace, lister, forced, a.ctxLogger(r.Context()))
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
		diagnostic.CacheAgeMS = max(0, timeNow().Sub(idx.AsOf).Milliseconds())
	}
	a.writeMyCompletions(w, myCompletionsResponse{
		Capability:  completionCapability{Available: true, ProgressRecords: true},
		Diagnostics: diagnostic,
		UserID:      userID,
		Completions: idx.ByUser[userID],
		InProgress:  idx.InProgressByUser[userID],
		AsOf:        idx.AsOf.UTC().Format(time.RFC3339),
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
	idx, err := getCompletionIndex(r.Context(), namespace, lister, false, a.ctxLogger(r.Context()))
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
		diagnostic.CacheAgeMS = max(0, timeNow().Sub(idx.AsOf).Milliseconds())
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
