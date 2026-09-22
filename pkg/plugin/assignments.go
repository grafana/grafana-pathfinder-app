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
// of one drain (the per-page byte cap alone does not bound total memory).
// When the budget trips, the drain caps the result and logs the truncation —
// never silently. A var so tests can exercise the budget path.
var assignmentListMaxTotalRecords = 50_000

// assignmentLifecycleActive is the only lifecycle this route serves.
// Anything else is filtered out rather than rendered.
const assignmentLifecycleActive = "active"

// assignmentListerOverride injects a fake lister in tests. nil selects the real
// per-request HTTP client. Config resolution (feature toggle, app URL,
// namespace) is checked BEFORE this override so the structural-unavailability
// path stays testable.
var assignmentListerOverride assignmentLister

// assignmentDevHook is nil in every shipped build. assignments_dev.go, behind
// the pathfinderdev build tag, is the only thing that sets it, so a local
// fixture cannot be switched on by configuration. See docs/developer/LOCAL_DEV.md.
var assignmentDevHook func(*App, *http.Request) (entries []assignmentEntry, subject string, handled bool)

// assignmentCapability is the availability signal "My Paths" gates on.
// `available` is read-derived: identity presence plus read-path reachability
// of the assignments API on this stack.
type assignmentCapability struct {
	Available bool   `json:"available"`
	Reason    string `json:"reason,omitempty"`
}

// assignmentEntry is one obligation on the wire. The target is
// (targetType, targetId); this route does not filter on targetType.
// Optional omitempty scalars are absent, not empty, when unset.
type assignmentEntry struct {
	TargetType string `json:"targetType"`
	TargetID   string `json:"targetId"`
	TrackID    string `json:"trackId,omitempty"`

	RuleID     string `json:"ruleId,omitempty"`
	AssignedBy string `json:"assignedBy,omitempty"`
	AssignedAt string `json:"assignedAt,omitempty"`

	DueAt                 string `json:"dueAt,omitempty"`
	AcceptCompletionsFrom string `json:"acceptCompletionsFrom,omitempty"`

	Satisfied bool   `json:"satisfied"`
	Lifecycle string `json:"lifecycle"`
}

// myAssignmentsResponse is the GET /assignments/my envelope. `assignments`
// is always a non-nil slice, so an empty list serializes as `[]` rather than
// as capability.available=false.
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

// unevaluatedSatisfaction reports every obligation unsatisfied until the
// completion join lands. False is the safe direction: showing work as done
// when it is not would suppress it. Do not build that join on collateByUser;
// that aggregate can report a satisfaction no single completion achieved.
func unevaluatedSatisfaction(assignmentSpec) bool { return false }

// shapeAssignments keeps one caller's active obligations, newest first.
// Target type is not a filter. Two rules for the same target stay two
// records — collapsing them would discard a deadline.
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
			TargetType:            rec.TargetType,
			TargetID:              rec.TargetID,
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
// absent ones sort last, then by (targetType, targetId, trackId, ruleId) so
// the order is total and a golden cannot flake on map iteration or upstream
// page order.
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
		if x.TargetType != y.TargetType {
			return x.TargetType < y.TargetType
		}
		if x.TargetID != y.TargetID {
			return x.TargetID < y.TargetID
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
