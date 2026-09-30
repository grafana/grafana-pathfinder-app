package plugin

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sort"
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
type assignmentCapability struct {
	Available bool   `json:"available"`
	Reason    string `json:"reason,omitempty"`
}

// assignmentEntry is one obligation on the wire.
type assignmentEntry struct {
	TargetType   string `json:"targetType"`
	TargetID     string `json:"targetId"`
	TrackID      string `json:"trackId,omitempty"`
	TargetSource string `json:"targetSource,omitempty"`

	RuleID     string `json:"ruleId,omitempty"`
	AssignedBy string `json:"assignedBy,omitempty"`
	AssignedAt string `json:"assignedAt,omitempty"`

	DueAt                 string `json:"dueAt,omitempty"`
	AcceptCompletionsFrom string `json:"acceptCompletionsFrom,omitempty"`

	Satisfied bool `json:"satisfied"`
	// Guides is absent when the target could not be resolved.
	Guides    []assignmentGuideEntry `json:"guides,omitempty"`
	Lifecycle string                 `json:"lifecycle"`
}

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

	lister, namespace, available, reason := a.resolveAssignmentBackend(r)
	if !available {
		a.writeAssignmentsCapability(w, reason)
		return
	}

	// Detached from request cancellation, bounded by a deadline.
	logger := a.ctxLogger(r.Context())
	fetchCtx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), assignmentAggregateDeadline)
	records, err := drainAssignments(fetchCtx, namespace, userID, lister, logger)
	cancel()

	if err != nil {
		if isTerminalUpstreamError(err) {
			// Terminal: surface the upstream status (e.g. "upstream-404") in the reason.
			reason := reasonBackendUnavailable
			var upErr *appPlatformUpstreamError
			if errors.As(err, &upErr) {
				reason = fmt.Sprintf("upstream-%d", upErr.status)
			}
			logger.Info("assignments unavailable (terminal)", "namespace", namespace, "error", err)
			a.writeAssignmentsCapability(w, reason)
			return
		}
		logger.Info("assignments unavailable (transient)", "namespace", namespace, "error", err)
		a.writeAssignmentsUnavailable(w)
		return
	}

	entries := shapeAssignments(records, a.satisfactionFunc(r, userID))
	logger.Debug("assignments served", "namespace", namespace, "callerAssignments", len(entries))
	a.writeJSON(w, myAssignmentsResponse{
		Capability:  assignmentCapability{Available: true},
		UserID:      userID,
		Assignments: entries,
		AsOf:        timeNow().UTC().Format(time.RFC3339),
	}, http.StatusOK)
}

// shapeAssignments orders the caller's obligations newest first. Two rules for
// the same target stay two records so no deadline is discarded.
func shapeAssignments(records []assignmentSpec, progress func(assignmentSpec) []assignmentGuideEntry) []assignmentEntry {
	entries := []assignmentEntry{}
	for _, rec := range records {
		guides := progress(rec)
		entries = append(entries, assignmentEntry{
			TargetType:            rec.TargetType,
			TargetID:              rec.TargetID,
			TrackID:               rec.TrackID,
			TargetSource:          rec.TargetSource,
			RuleID:                rec.RuleID,
			AssignedBy:            rec.AssignedBy,
			AssignedAt:            rec.AssignedAt,
			DueAt:                 rec.DueAt,
			AcceptCompletionsFrom: rec.AcceptCompletionsFrom,
			Satisfied:             satisfiedFromGuides(guides),
			Guides:                guides,
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

// drainAssignments drains the namespace LIST and returns the caller's active
// records. There is deliberately no record cap: it would silently drop the
// caller's record past the cut.
func drainAssignments(ctx context.Context, namespace, userID string, lister assignmentLister, logger log.Logger) ([]assignmentSpec, error) {
	records := []assignmentSpec{}
	continueToken := ""
	for {
		page, err := lister.ListPage(ctx, namespace, continueToken)
		if err != nil {
			return nil, err
		}

		// Trust boundary: the LIST is namespace-scoped and carries every user's
		// records, so filter each page to the caller before anything else sees it.
		// Withdrawal revokes an obligation, so only active records are served.
		for _, rec := range page.Records {
			if rec.UserID == userID && rec.Lifecycle == assignmentLifecycleActive {
				records = append(records, rec)
			}
		}

		if page.Continue == "" {
			return records, nil
		}
		continueToken = page.Continue
	}
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
