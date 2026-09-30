package plugin

import (
	"context"
	"net/http"
	"slices"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

// Obligation evaluation for GET /assignments/my and the completion-time status
// write. One completion row must meet a guide on its own, so this reads raw
// completion specs rather than the collated index.

// assignmentGuideEntry is one guide within an assignment's target, on the wire.
type assignmentGuideEntry struct {
	GuideID   string `json:"guideId"`
	Completed bool   `json:"completed"`
}

// satisfiedFromGuides is true when the target resolved and every guide is done.
func satisfiedFromGuides(guides []assignmentGuideEntry) bool {
	if len(guides) == 0 {
		return false
	}
	for _, g := range guides {
		if !g.Completed {
			return false
		}
	}
	return true
}

// obligationEvaluator serves one request: each target's guide list is resolved
// at most once across all assignments.
type obligationEvaluator struct {
	ctx      context.Context
	logger   log.Logger
	sources  []pathGuideSource
	resolved map[string][]string
}

// guideProgress is one entry per guide the assignment requires. nil means the
// target could not be resolved, distinct from a resolved target that is incomplete.
func (e *obligationEvaluator) guideProgress(asg assignmentSpec, completions []completionRecordSpec) []assignmentGuideEntry {
	guideIDs := e.assignmentGuides(asg)
	if len(guideIDs) == 0 {
		return nil
	}
	var accept time.Time
	hasAccept := false
	if asg.AcceptCompletionsFrom != "" {
		parsed, ok := parseCompletionTime(asg.AcceptCompletionsFrom)
		if !ok {
			return nil
		}
		accept, hasAccept = parsed, true
	}
	entries := make([]assignmentGuideEntry, len(guideIDs))
	for i, guideID := range guideIDs {
		done := false
		for _, rec := range completions {
			if rec.GuideID != guideID {
				continue
			}
			at, ok := parseCompletionTime(rec.CompletedAt)
			if !ok {
				continue
			}
			if hasAccept && at.Before(accept) {
				continue
			}
			done = true
			break
		}
		entries[i] = assignmentGuideEntry{GuideID: guideID, Completed: done}
	}
	return entries
}

// assignmentGuides is the guides an assignment requires, nil when unresolved.
// Guide targets stay unresolved: grading a whole path would mark a narrower
// obligation done. A track assignment is graded against that track's guides.
func (e *obligationEvaluator) assignmentGuides(asg assignmentSpec) []string {
	if e.resolved == nil {
		e.resolved = map[string][]string{}
	}
	key := asg.TargetType + "\x00" + asg.TargetID + "\x00" + asg.TrackID + "\x00" + asg.TargetSource
	if cached, ok := e.resolved[key]; ok {
		return cached
	}
	guides := e.resolveGuides(asg)
	e.resolved[key] = guides
	return guides
}

func (e *obligationEvaluator) resolveGuides(asg assignmentSpec) []string {
	if asg.TargetType == assignmentTargetGuide {
		e.logger.Error("assignment guide target is not evaluated", "targetType", asg.TargetType, "targetId", asg.TargetID)
		return nil
	}
	if asg.TargetType != assignmentTargetPath || asg.TargetID == "" {
		return nil
	}
	for _, source := range e.sources {
		guides, found, err := source(e.ctx, asg.TargetID, asg.TrackID)
		if err != nil {
			e.logger.Info("path guides unavailable", "targetId", asg.TargetID, "error", err)
			return nil
		}
		if found {
			return guides
		}
	}
	return nil
}

// newObligationEvaluator builds one evaluator per request, draining the
// custom-guide catalogue once up front.
func (a *App) newObligationEvaluator(r *http.Request) *obligationEvaluator {
	ev := &obligationEvaluator{
		ctx:    r.Context(),
		logger: a.ctxLogger(r.Context()),
	}
	ev.sources = append(ev.sources, bundledPathGuides(ev.logger))
	if lister, namespace, available, _ := a.resolveCustomGuideBackend(r); available {
		fetchCtx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), customGuideAggregateDeadline)
		entries, _, err := drainCustomGuides(fetchCtx, namespace, lister, ev.logger)
		cancel()
		if err != nil {
			ev.logger.Info("custom guide catalogue unavailable for assignment evaluation", "error", err)
		} else {
			ev.sources = append(ev.sources, customPathGuides(entries, ev.logger))
		}
	}
	ev.sources = append(ev.sources, a.onlinePathGuides(ev.logger))
	return ev
}

// callerCompletionRecords is the caller's raw completion rows, skipping the
// collation the completion cache applies. ok is false when the list could not
// be read; callers then report every obligation unmet.
func (a *App) callerCompletionRecords(r *http.Request, userID string) ([]completionRecordSpec, bool) {
	lister, namespace, available, _ := a.resolveCompletionBackend(r)
	if !available {
		return nil, false
	}
	logger := a.ctxLogger(r.Context())
	fetchCtx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), completionAggregateDeadline)
	records, _, err := drainCompletionRecords(fetchCtx, namespace, lister, logger)
	cancel()
	if err != nil {
		logger.Info("completion records unavailable for assignment evaluation", "error", err)
		return nil, false
	}
	// Trust boundary: records holds every user's rows; filter to the caller here.
	out := make([]completionRecordSpec, 0, len(records))
	for _, rec := range records {
		if rec.UserID == userID {
			out = append(out, rec)
		}
	}
	return out, true
}

// satisfactionFunc returns the per-assignment guide progress for this request;
// nil when completions are unavailable.
func (a *App) satisfactionFunc(r *http.Request, userID string) func(assignmentSpec) []assignmentGuideEntry {
	completions, ok := a.callerCompletionRecords(r, userID)
	if !ok {
		return func(assignmentSpec) []assignmentGuideEntry { return nil }
	}
	ev := a.newObligationEvaluator(r)
	return func(rec assignmentSpec) []assignmentGuideEntry {
		return ev.guideProgress(rec, completions)
	}
}

// assignmentStatusDispatchOverride lets tests run writeSatisfiedAssignments'
// background work inline so no goroutine outlives the test.
var assignmentStatusDispatchOverride func(run func())

// writeSatisfiedAssignments PATCHes status.satisfied on the caller's active
// assignments that a new completion newly meets, for consumers that LIST the
// kind. It runs in the background and must never fail the completion write.
func (a *App) writeSatisfiedAssignments(r *http.Request, userID string, just completionRecordSpec) {
	logger := a.ctxLogger(r.Context())
	// Detached: the request context is canceled once the response is written.
	bgReq := r.WithContext(context.WithoutCancel(r.Context()))
	run := func() {
		defer func() {
			if panicVal := recover(); panicVal != nil {
				logger.Error("assignment status write panicked", "panic", panicVal)
			}
		}()
		a.syncSatisfiedAssignments(bgReq, userID, just, logger)
	}
	if dispatch := assignmentStatusDispatchOverride; dispatch != nil {
		dispatch(run)
		return
	}
	go run()
}

func (a *App) syncSatisfiedAssignments(r *http.Request, userID string, just completionRecordSpec, logger log.Logger) {
	lister, namespace, available, _ := a.resolveAssignmentBackend(r)
	if !available {
		return
	}
	fetchCtx, cancel := context.WithTimeout(r.Context(), assignmentAggregateDeadline)
	records, err := drainAssignments(fetchCtx, namespace, userID, lister, logger)
	cancel()
	if err != nil {
		logger.Info("assignment status write skipped", "error", err)
		return
	}
	completions, listOK := a.callerCompletionRecords(r, userID)
	if !listOK {
		completions = nil
	}
	fresh := true
	for _, rec := range completions {
		if rec.GuideID == just.GuideID && rec.GuideSource == just.GuideSource && rec.CompletedAt == just.CompletedAt {
			fresh = false
			break
		}
	}
	if fresh {
		completions = append(completions, just)
	}
	ev := a.newObligationEvaluator(r)
	for _, rec := range records {
		if rec.Name == "" || (rec.StatusSatisfied != nil && *rec.StatusSatisfied) {
			continue
		}
		guides := ev.guideProgress(rec, completions)
		if !satisfiedFromGuides(guides) || !slices.ContainsFunc(guides, func(g assignmentGuideEntry) bool { return g.GuideID == just.GuideID }) {
			continue
		}
		if err := lister.UpdateStatus(r.Context(), namespace, rec.Name, rec.ResourceVersion, true); err != nil {
			status, _ := upstreamStatusOf(err)
			logger.Info("assignment status write failed", "name", rec.Name, "status", status, "error", err)
		}
	}
}
