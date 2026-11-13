package plugin

import (
	"context"
	"errors"
	"fmt"
	"github.com/grafana/grafana-pathfinder-app/pkg/services"
	"net/http"
	"strconv"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

// GET /assignments/my serves the signed-in user's assignments. Identity is
// derived server-side from the forwarded ID token. The route is deliberately
// uncached because satisfaction is evaluated live against raw completions.

const (
	// assignmentRetryAfterSeconds is the Retry-After hint on a transient 503.
	assignmentRetryAfterSeconds = 30

	// assignmentAggregateDeadline bounds a whole multi-page drain, which runs on
	// a detached context.
	assignmentAggregateDeadline = 60 * time.Second

	// Per-user flood guard for GET /assignments/my: each call can drain the
	// whole namespace, and a healthy client polls far below this.
	assignmentsReadRateRefillPerSec = 1.0
	assignmentsReadRateBurst        = 20.0
)

// assignmentLifecycleActive is the only lifecycle this route serves.
// Anything else is filtered out rather than rendered.
const assignmentLifecycleActive = "active"

// assignmentTargetPath and assignmentTargetGuide are the targetType values
// kinds/assignment.cue defines; MVP evaluates path only.
const (
	assignmentTargetPath  = "path"
	assignmentTargetGuide = "guide"
)

// assignmentListerOverride injects a fake lister in tests; config resolution
// runs before it.
var assignmentListerOverride assignmentLister

// assignmentCapability is the availability signal "My Paths" gates on.
type assignmentCapability = services.AssignmentCapability

// assignmentEntry is one obligation on the wire.
type assignmentEntry = services.AssignmentEntry

// myAssignmentsResponse is the GET /assignments/my envelope; assignments is
// never nil.
type myAssignmentsResponse struct {
	Capability  assignmentCapability `json:"capability"`
	UserID      string               `json:"userId,omitempty"`
	Assignments []assignmentEntry    `json:"assignments"`
	AsOf        string               `json:"asOf,omitempty"`
}

// handleMyAssignments serves GET /assignments/my.
func (a *App) handleMyAssignments(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Assignments and completions key on the same subject.
	userID, status := a.deriveCompletionUserID(r)
	if status != identityVerified {
		a.writeAssignmentsCapability(w, status.capabilityReason())
		return
	}

	if a.assignmentsReadRateLimiter != nil {
		if allow, retryAfter := a.assignmentsReadRateLimiter.allow(userID); !allow {
			a.ctxLogger(r.Context()).Debug("assignments read rate-limited (local)")
			a.writeRateLimited(w, retryAfter)
			return
		}
	}

	lister, namespace, available, reason := a.resolveAssignmentBackend(r)
	if !available {
		a.writeAssignmentsCapability(w, reason)
		return
	}

	// Detached from request cancellation, bounded by a deadline.
	logger := a.ctxLogger(r.Context())
	fetchCtx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), assignmentAggregateDeadline)
	records, err := drainAssignments(fetchCtx, namespace, userID, lister)
	cancel()
	if err != nil {
		a.writeAssignmentsReadFailure(w, logger, namespace, "assignments", err)
		return
	}

	ev := a.newObligationEvaluator(r)
	entries, err := services.ReadAssignmentView(r.Context(), records, userID, services.AssignmentViewDependencies{
		ReadCompletions: func(ctx context.Context, userID string) ([]services.CompletionRecord, error) {
			return a.callerCompletionRecords(r.WithContext(ctx), userID)
		},
		Progress:      ev.GuideProgress,
		MarkSatisfied: func(unmarked []services.Assignment) { a.markSatisfiedInBackground(r, lister, namespace, unmarked) },
		Logger:        logger,
	})
	if err != nil {
		a.writeAssignmentsReadFailure(w, logger, namespace, "completion records", err)
		return
	}

	logger.Debug("assignments served", "namespace", namespace, "callerAssignments", len(entries))
	a.writeJSON(w, myAssignmentsResponse{
		Capability:  assignmentCapability{Available: true},
		UserID:      userID,
		Assignments: entries,
		AsOf:        timeNow().UTC().Format(time.RFC3339),
	}, http.StatusOK)
}

// writeAssignmentsReadFailure answers a whole-list failure: structural
// unavailability and terminal upstream statuses become capability=false carrying
// the reason, anything else a retryable 503. Serving 200 with every assignment
// unmet would show finished training as outstanding.
func (a *App) writeAssignmentsReadFailure(w http.ResponseWriter, logger log.Logger, namespace, what string, err error) {
	var unavailable *completionsUnavailableError
	if errors.As(err, &unavailable) {
		a.writeAssignmentsCapability(w, unavailable.reason)
		return
	}
	if isTerminalUpstreamError(err) {
		reason := reasonBackendUnavailable
		var upErr *appPlatformUpstreamError
		if errors.As(err, &upErr) {
			reason = fmt.Sprintf("upstream-%d", upErr.status)
		}
		logger.Info(what+" unavailable (terminal)", "namespace", namespace, "error", err)
		a.writeAssignmentsCapability(w, reason)
		return
	}
	logger.Info(what+" unavailable (transient)", "namespace", namespace, "error", err)
	a.writeAssignmentsUnavailable(w)
}

// shapeAssignments orders the caller's obligations newest first. Two rules for
// the same target stay two records so no deadline is discarded. An assignment
// whose progress cannot be evaluated is logged and omitted.

// drainAssignments drains the namespace LIST and returns the caller's active
// records. There is deliberately no record cap: it would silently drop the
// caller's record past the cut. The LIST is namespace-scoped and carries every
// user's records, so this is the trust boundary: each page is filtered to the
// caller before anything else sees it. Withdrawal revokes an obligation, so only
// active records are served.
func drainAssignments(ctx context.Context, namespace, userID string, lister assignmentLister) ([]assignmentSpec, error) {
	return services.ReadAssignments(ctx, namespace, userID, lister)
}

// resolveAssignmentBackend reports whether the aggregated API is structurally
// reachable (toggle, app URL, namespace, credential) and returns a lister. The
// namespace comes from the trusted plugin context, never a query parameter.
func (a *App) resolveAssignmentBackend(r *http.Request) (lister assignmentLister, namespace string, available bool, reason string) {
	appURL, namespace, idToken, reason := resolveAppPlatformConfig(r, assignmentsAggregationToggle)
	if reason != "" {
		return nil, namespace, false, reason
	}

	if assignmentListerOverride != nil {
		return assignmentListerOverride, namespace, true, ""
	}

	if a.oboExchanger == nil {
		return nil, namespace, false, reasonOBOUnavailable
	}

	return newAssignmentHTTPClient(appURL, a.oboExchanger, idToken, a.ctxLogger(r.Context())), namespace, true, ""
}

func (a *App) writeAssignmentsCapability(w http.ResponseWriter, reason string) {
	a.writeJSON(w, myAssignmentsResponse{
		Capability:  assignmentCapability{Available: false, Reason: reason},
		Assignments: []assignmentEntry{},
	}, http.StatusOK)
}

// writeAssignmentsUnavailable serves a transient failure as 503 with Retry-After.
func (a *App) writeAssignmentsUnavailable(w http.ResponseWriter) {
	w.Header().Set("Retry-After", strconv.Itoa(assignmentRetryAfterSeconds))
	a.writeError(w, "assignments-unavailable", http.StatusServiceUnavailable)
}
