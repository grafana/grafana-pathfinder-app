package plugin

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/grafana/grafana-plugin-sdk-go/config"
)

// Path Assignments read proxy (docs/design/BACKEND_PROXY_PATTERN.md;
// pathfinder-rfcs rfc/PATH_ASSIGNMENTS.md §6.4, §7.4).
//
// "My Paths" needs the obligations assigned to the signed-in user. This route
// is the only assignment read surface MVP ships: authenticated, identity
// derived server-side from the forwarded ID-token `sub`, returning the caller's
// slice only. The public recommender stays out of the assignment path entirely
// (§2.3) — nothing here reaches it.
//
// DELIBERATE DEVIATION from the pattern's cache-centric §4/§5: this proxy does
// NOT cache across requests and does NOT single-flight across callers, matching
// custom_guide_repository.go rather than completion_records.go. Two reasons,
// and the second is the one that decides it:
//
//   - The pattern's own §4 requires per-user data to use an identity-
//     partitioned cache, which is what completion_records.go builds. That is
//     sound but not free, and nothing needs it yet — "My Paths" is read on
//     panel open, at the same cadence as the catalogue this mirrors.
//   - §7.4 requires satisfaction to be evaluated as the route serves, so a
//     learner sees their own completion reflected immediately. A cached
//     envelope reintroduces exactly the staleness that requirement exists to
//     forbid, so the cache would have to sit under the join rather than over
//     it. Adding one now, before the join exists, would be caching the wrong
//     layer.
//
// If load ever justifies caching, the safe reintroduction is a per-identity
// partitioned cache of the raw LIST beneath a live join — a deliberate future
// change. With no warm data to serve, §5's stale-serve and negative-cache
// cooldown do not apply.

const (
	// assignmentRetryAfterSeconds is the Retry-After hint on a transient 503.
	assignmentRetryAfterSeconds = 30

	// assignmentAggregateDeadline bounds a whole multi-page drain. The drain is
	// detached from the request (context.WithoutCancel) so a canceled request
	// does not abort a fetch partway; the deadline ensures detached never means
	// unkillable.
	assignmentAggregateDeadline = 60 * time.Second
)

// assignmentListMaxTotalRecords is the aggregate budget across all LIST pages
// of one drain (the per-page byte cap alone does not bound total memory). When
// the budget trips, the drain caps the result and logs the truncation — never
// silently. §7.4 names steady-state cardinality as a stated input: roughly
// (assigned people × targets each × retained obligations) for the namespace,
// since the LIST is namespace-wide and the filter to one caller happens here.
// A var so tests can exercise the budget path.
var assignmentListMaxTotalRecords = 50_000

// assignmentLifecycleActive is the only lifecycle value MVP ever writes
// (§6.10): the provisioner is create-only and never withdraws. Records carrying
// anything else are filtered out of the response rather than rendered, so a
// withdrawal mechanism built later needs no frontend change to take effect.
const assignmentLifecycleActive = "active"

// assignmentListerOverride injects a fake lister in tests. nil selects the real
// per-request HTTP client. Config resolution (feature toggle, app URL,
// namespace) is checked BEFORE this override so the structural-unavailability
// path stays testable.
var assignmentListerOverride assignmentLister

// assignmentDevHook is nil in every shipped build, and the only thing that can
// set it is assignments_dev.go, which is behind the `pathfinderdev` build tag.
// It exists so the local dev loop can serve a canned envelope without the four
// things a local stack cannot supply — a served aggregation layer, a registered
// Assignment kind, a provisioned CAP token, and an Okta-resolved subject — and
// so that affordance cannot be switched on by configuration alone in a build
// that shipped. See docs/developer/LOCAL_DEV.md.
//
// A nil check rather than an interface with a no-op default: one branch, one
// symbol, and `git grep assignmentDevHook` finds every line that participates.
// It takes the *App so the fixture can reuse the shared ID-token verifier
// (and its key cache) when the local stack does forward a usable token.
var assignmentDevHook func(*App, *http.Request) (entries []assignmentEntry, subject string, handled bool)

// assignmentCapability is the availability signal "My Paths" gates on.
// `available` is read-derived: it measures identity presence plus read-path
// reachability of the assignments API on this stack. Reasons are
// reasonIdentityUnavailable, reasonIdentityUnverifiable and
// reasonSigningKeysUnreachable (all via identityStatus.capabilityReason()),
// reasonFeatureToggleDisabled, reasonAppURLUnavailable,
// reasonNamespaceUnavailable, reasonOBOUnavailable, and `upstream-<status>` for
// a terminal upstream — which is what an unregistered Assignment kind looks
// like today (`upstream-404`).
type assignmentCapability struct {
	Available bool   `json:"available"`
	Reason    string `json:"reason,omitempty"`
}

// assignmentEntry is one obligation as "My Paths" renders it.
//
// The envelope carries FACTS, not a rendered status. `satisfied`, `dueAt` and
// `lifecycle` are separate fields and the UI derives its own display state from
// them, rather than the backend shipping a precomputed "overdue" string. Two
// reasons: `dueAt` is soft by definition (§6.9), so overdue is a display
// concept the store has no opinion about; and a derived enum would have to pick
// a comparison basis — §12.3 leaves open whether a deadline is measured against
// the completion's own `completedAt` or the server-stamped `recordedAt` — and
// shipping either reading here would bake an unsettled decision into the wire.
//
// Every optional field is an omitempty flat scalar whose absence means what MVP
// does today (§6.11): absent `dueAt` is no deadline, absent
// `acceptCompletionsFrom` credits any prior completion.
type assignmentEntry struct {
	PathID  string `json:"pathId"`
	TrackID string `json:"trackId,omitempty"`

	RuleID     string `json:"ruleId,omitempty"`
	AssignedBy string `json:"assignedBy,omitempty"`
	AssignedAt string `json:"assignedAt,omitempty"`

	DueAt                 string `json:"dueAt,omitempty"`
	AcceptCompletionsFrom string `json:"acceptCompletionsFrom,omitempty"`

	Satisfied bool   `json:"satisfied"`
	Lifecycle string `json:"lifecycle"`
}

// myAssignmentsResponse is the GET /assignments/my envelope. `assignments` is
// always a non-nil slice so it serializes as `[]` rather than `null`: an empty
// array means the caller genuinely has no obligations, which is a different
// statement from capability.available=false (§7).
//
// `asOf` is the age of THIS request's LIST, not of a materialisation. §6.12
// requires any surface serving the cached satisfaction copy to state its age;
// this route does not serve that copy at all — it evaluates live — so `asOf`
// here means only "when the obligations were read".
type myAssignmentsResponse struct {
	Capability  assignmentCapability `json:"capability"`
	UserID      string               `json:"userId,omitempty"`
	Assignments []assignmentEntry    `json:"assignments"`
	AsOf        string               `json:"asOf,omitempty"`
}

// deriveAssignmentUserID is the identity contract for this route: the caller's
// VERIFIED ID-token `sub` claim VERBATIM, typed prefix included. It is the same
// helper the completion routes join on (deriveCompletionUserID), which is the
// whole point of putting assignments on these rails — obligation and fulfilment
// key on one subject, so the future progress view is a same-store query rather
// than an identity reconciliation (§2.2).
func (a *App) deriveAssignmentUserID(r *http.Request) (string, identityStatus) {
	return a.subjectFromIDToken(r)
}

// handleMyAssignments serves GET /assignments/my.
func (a *App) handleMyAssignments(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Dev-build escape hatch, checked before anything else so a local stack
	// needs none of the four structural preconditions below. nil in every
	// shipped build (see assignmentDevHook).
	if assignmentDevHook != nil {
		if entries, subject, handled := assignmentDevHook(a, r); handled {
			a.writeMyAssignments(w, myAssignmentsResponse{
				Capability:  assignmentCapability{Available: true},
				UserID:      subject,
				Assignments: entries,
				AsOf:        timeNow().UTC().Format(time.RFC3339),
			})
			return
		}
	}

	// Identity gate first: warm or canned, no data is served to an
	// unauthenticated caller. Every identity failure on a GET read is a
	// soft-200 capability envelope (not 401, not 503), because none of them is
	// retryable and the reason token says which one it was
	// (BACKEND_PROXY_PATTERN.md §3, §7).
	userID, status := a.deriveAssignmentUserID(r)
	if status != identityVerified {
		a.writeMyAssignments(w, myAssignmentsResponse{
			Capability:  assignmentCapability{Available: false, Reason: status.capabilityReason()},
			Assignments: []assignmentEntry{},
		})
		return
	}

	lister, namespace, available, reason := a.resolveAssignmentBackend(r)
	if !available {
		a.writeMyAssignments(w, myAssignmentsResponse{
			Capability:  assignmentCapability{Available: false, Reason: reason},
			Assignments: []assignmentEntry{},
		})
		return
	}

	// Detach the drain from the caller's cancellation, bounded by the aggregate
	// deadline. Per-request, never shared: this fetch rides this caller's
	// identity and is handed to no other caller.
	logger := a.ctxLogger(r.Context())
	fetchCtx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), assignmentAggregateDeadline)
	records, pages, err := drainAssignments(fetchCtx, namespace, lister, logger)
	cancel()

	if err != nil {
		if isTerminalUpstreamError(err) {
			// "Never works here" — includes identity-scoped 401/403 for this
			// caller's token, and the 404 an unregistered Assignment kind
			// returns today. Surface the upstream status in the reason
			// (e.g. "upstream-404") so the cause is diagnosable from the
			// envelope without backend log access.
			reason := reasonBackendUnavailable
			var upErr *appPlatformUpstreamError
			if errors.As(err, &upErr) {
				reason = fmt.Sprintf("upstream-%d", upErr.status)
			}
			logger.Info("assignments unavailable (terminal)", "namespace", namespace, "error", err)
			a.writeMyAssignments(w, myAssignmentsResponse{
				Capability:  assignmentCapability{Available: false, Reason: reason},
				Assignments: []assignmentEntry{},
			})
			return
		}
		// Transient: signal a hiccup rather than darkening the feature. Info
		// (not Debug) so a wrong CAP token or unreachable auth-api — which
		// would 503 this route indefinitely — is diagnosable without raising
		// the log level.
		logger.Info("assignments unavailable (transient)", "namespace", namespace, "error", err)
		a.writeAssignmentsUnavailable(w)
		return
	}

	entries := shapeAssignments(records, userID, unevaluatedSatisfaction)
	logger.Debug("assignments served",
		"namespace", namespace, "pages", pages, "namespaceRecords", len(records), "callerAssignments", len(entries))
	a.writeMyAssignments(w, myAssignmentsResponse{
		Capability:  assignmentCapability{Available: true},
		UserID:      userID,
		Assignments: entries,
		AsOf:        timeNow().UTC().Format(time.RFC3339),
	})
}

// unevaluatedSatisfaction is the satisfaction evaluator the real read path uses
// until the completion join lands. It reports every obligation unsatisfied.
//
// This is a stated gap, not an oversight, and it is the narrower half of RFC
// §7.4: both kinds must be listed for the namespace, joined in memory on
// (subject, target), and each obligation evaluated against whether ONE
// completion event meets every configured criterion at once — never criteria
// tested independently against a general-purpose aggregate, which can report a
// satisfaction no single completion ever achieved (§6.12). The proxy's existing
// collateByUser is exactly that general-purpose aggregate, so this join must
// NOT be built by reusing it as-is; it needs a criteria-scoped collation or a
// scan of the caller's raw completions.
//
// Reporting false is the safe direction while it is missing: an obligation
// shown as outstanding when it is met is a wrong nudge, whereas one shown met
// when it is not would suppress work someone owes. It is also why the dev hook
// supplies its own values — the UI has to render both states before the join
// exists.
func unevaluatedSatisfaction(assignmentSpec) bool { return false }

// shapeAssignments filters a namespace-wide LIST to one caller's active
// obligations and shapes each into a wire entry, newest assignment first.
//
// The caller filter is what makes this "my" assignments. It is a UI filter and
// not row-level authorization: the upstream LIST is namespace-wide-readable by
// any authenticated viewer on the stack, which is the accepted privacy grain
// (§6.8) and is stated rather than implied.
//
// No deduplication by (subject, target). The RFC is explicit that two rules may
// assign the same path to the same person and that this produces two records,
// each with its own provenance and `dueAt` (§6.10) — nothing upstream merges
// them, and collapsing them here would discard a deadline the learner owes.
// Whether "My Paths" renders two cards for one path is a display decision for
// the component, made with both records in hand.
func shapeAssignments(records []assignmentSpec, userID string, satisfied func(assignmentSpec) bool) []assignmentEntry {
	entries := []assignmentEntry{}
	for _, rec := range records {
		if rec.UserID != userID {
			continue
		}
		if rec.Lifecycle != assignmentLifecycleActive {
			continue
		}
		entries = append(entries, assignmentEntry{
			PathID:                rec.PathID,
			TrackID:               rec.TrackID,
			RuleID:                rec.RuleID,
			AssignedBy:            rec.AssignedBy,
			AssignedAt:            rec.AssignedAt,
			DueAt:                 rec.DueAt,
			AcceptCompletionsFrom: rec.AcceptCompletionsFrom,
			Satisfied:             satisfied(rec),
			Lifecycle:             rec.Lifecycle,
		})
	}
	sortAssignments(entries)
	return entries
}

// sortAssignments orders entries by assignedAt descending, so the newest
// obligation leads. Parseable timestamps sort chronologically; unparseable and
// absent ones sort last, then by (pathId, trackId, ruleId) so the order is
// total and a golden cannot flake on map iteration or upstream page order.
func sortAssignments(entries []assignmentEntry) {
	sort.SliceStable(entries, func(i, j int) bool {
		x, y := entries[i], entries[j]
		tx, okx := parseCompletionTime(x.AssignedAt)
		ty, oky := parseCompletionTime(y.AssignedAt)
		if okx && oky && !tx.Equal(ty) {
			return tx.After(ty)
		}
		if okx != oky {
			return okx // the one that parsed leads
		}
		if x.PathID != y.PathID {
			return x.PathID < y.PathID
		}
		if x.TrackID != y.TrackID {
			return x.TrackID < y.TrackID
		}
		return x.RuleID < y.RuleID
	})
}

// drainAssignments drains the namespace LIST across pages — up to the aggregate
// record budget — and returns the raw specs.
func drainAssignments(ctx context.Context, namespace string, lister assignmentLister, logger log.Logger) ([]assignmentSpec, int, error) {
	records := []assignmentSpec{}
	continueToken := ""
	pages := 0
	for {
		page, err := lister.ListPage(ctx, namespace, continueToken)
		if err != nil {
			return nil, pages, err
		}
		pages++
		records = append(records, page.Records...)
		if len(records) >= assignmentListMaxTotalRecords && page.Continue != "" {
			logger.Warn("assignments LIST truncated at aggregate budget",
				"namespace", namespace, "maxTotalRecords", assignmentListMaxTotalRecords, "pages", pages)
			break
		}
		if page.Continue == "" {
			break
		}
		continueToken = page.Continue
	}
	return records, pages, nil
}

// resolveAssignmentBackend determines whether the aggregated CRUD API is
// structurally reachable for this request and returns a lister to use.
// "Structurally unavailable" (feature toggle off, no app URL, no namespace, no
// provisioned on-behalf-of credential) is a "never works here" condition
// surfaced as capability=false, distinct from a transient LIST failure. The
// namespace comes from the trusted plugin context, never from a query
// parameter. Config resolution runs before the test-only lister override so the
// structural-unavailability branch stays testable.
func (a *App) resolveAssignmentBackend(r *http.Request) (lister assignmentLister, namespace string, available bool, reason string) {
	namespace = backend.PluginConfigFromContext(r.Context()).Namespace

	cfg := config.GrafanaConfigFromContext(r.Context())
	if cfg == nil {
		return nil, namespace, false, reasonGrafanaConfigUnavailable
	}
	if !cfg.FeatureToggles().IsEnabled(assignmentsAggregationToggle) {
		return nil, namespace, false, reasonFeatureToggleDisabled
	}
	if namespace == "" {
		return nil, namespace, false, reasonNamespaceUnavailable
	}
	appURL, err := cfg.AppURL()
	if err != nil || appURL == "" {
		return nil, namespace, false, reasonAppURLUnavailable
	}

	if assignmentListerOverride != nil {
		return assignmentListerOverride, namespace, true, ""
	}

	// No provisioned CAP token means there is no way to authenticate as the
	// caller against the aggregated API — a "never works here" condition
	// rather than a transient one.
	if a.oboExchanger == nil {
		return nil, namespace, false, reasonOBOUnavailable
	}

	idToken := r.Header.Get(backend.GrafanaUserSignInTokenHeaderName)
	return newAssignmentHTTPClient(appURL, a.oboExchanger, idToken, a.ctxLogger(r.Context())), namespace, true, ""
}

func (a *App) writeMyAssignments(w http.ResponseWriter, resp myAssignmentsResponse) {
	a.writeJSON(w, resp, http.StatusOK)
}

// writeAssignmentsUnavailable serves BACKEND_PROXY_PATTERN.md §7's transient
// hiccup — 503 plus a Retry-After hint, never a capability envelope — so every
// retryable failure on this route answers in one shape.
func (a *App) writeAssignmentsUnavailable(w http.ResponseWriter) {
	w.Header().Set("Retry-After", strconv.Itoa(assignmentRetryAfterSeconds))
	a.writeError(w, "assignments-unavailable", http.StatusServiceUnavailable)
}
