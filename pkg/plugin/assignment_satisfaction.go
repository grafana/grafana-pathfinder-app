package plugin

import (
	"context"
	"errors"
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

type resolvedGuides struct {
	guides []string
	err    error
}

// obligationEvaluator serves one request: each target's guide list is resolved
// at most once across all assignments, failures included.
type obligationEvaluator struct {
	ctx      context.Context
	logger   log.Logger
	sources  []pathGuideSource
	resolved map[string]resolvedGuides
}

// guideProgress is one entry per guide the assignment requires. nil means the
// target could not be resolved, distinct from a resolved target that is
// incomplete; err means the assignment could not be checked.
func (e *obligationEvaluator) guideProgress(asg assignmentSpec, completions []completionRecordSpec) ([]assignmentGuideEntry, error) {
	guideIDs, err := e.assignmentGuides(asg)
	if err != nil || len(guideIDs) == 0 {
		return nil, err
	}
	var accept time.Time
	hasAccept := false
	if asg.AcceptCompletionsFrom != "" {
		parsed, ok := parseCompletionTime(asg.AcceptCompletionsFrom)
		if !ok {
			return nil, nil
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
	return entries, nil
}

// assignmentGuides is the guides an assignment requires, nil when unresolved.
// Guide targets stay unresolved: grading a whole path would mark a narrower
// obligation done. A track assignment is graded against that track's guides.
func (e *obligationEvaluator) assignmentGuides(asg assignmentSpec) ([]string, error) {
	if e.resolved == nil {
		e.resolved = map[string]resolvedGuides{}
	}
	key := asg.TargetType + "\x00" + asg.TargetID + "\x00" + asg.TrackID + "\x00" + asg.TargetSource
	if cached, ok := e.resolved[key]; ok {
		return cached.guides, cached.err
	}
	guides, err := e.resolveGuides(asg)
	e.resolved[key] = resolvedGuides{guides: guides, err: err}
	return guides, err
}

// errAssignmentUncheckable means no source found the target and at least one
// failed, so the target may exist.
var errAssignmentUncheckable = errors.New("assignment target could not be checked")

// resolveGuides returns the first source's answer that finds the target. A
// failing source is logged and skipped.
func (e *obligationEvaluator) resolveGuides(asg assignmentSpec) ([]string, error) {
	if asg.TargetType == assignmentTargetGuide {
		e.logger.Error("assignment guide target is not evaluated", "targetType", asg.TargetType, "targetId", asg.TargetID)
		return nil, nil
	}
	if asg.TargetType != assignmentTargetPath || asg.TargetID == "" {
		return nil, nil
	}
	failed := false
	for _, source := range e.sources {
		guides, found, err := source(e.ctx, asg.TargetID, asg.TrackID)
		if err != nil {
			failed = true
			e.logger.Info("assignment guide source failed", "targetId", asg.TargetID, "trackId", asg.TrackID, "error", err)
			continue
		}
		if found {
			return guides, nil
		}
	}
	if failed {
		return nil, errAssignmentUncheckable
	}
	return nil, nil
}

// newObligationEvaluator builds one evaluator per request. The custom-guide
// catalogue is drained on first use, at most once.
func (a *App) newObligationEvaluator(r *http.Request) *obligationEvaluator {
	ev := &obligationEvaluator{
		ctx:    r.Context(),
		logger: a.ctxLogger(r.Context()),
	}
	ev.sources = append(ev.sources, bundledPathGuides(ev.logger), a.lazyCustomPathGuides(r, ev.logger))
	ev.sources = append(ev.sources, a.onlinePathGuides(ev.logger))
	return ev
}

func (a *App) lazyCustomPathGuides(r *http.Request, logger log.Logger) pathGuideSource {
	var source pathGuideSource
	var loadErr error
	loaded := false
	return func(ctx context.Context, targetID, trackID string) ([]string, bool, error) {
		if !loaded {
			loaded = true
			source, loadErr = a.drainCustomPathGuides(r, logger)
		}
		if loadErr != nil {
			return nil, false, loadErr
		}
		if source == nil {
			return nil, false, nil
		}
		return source(ctx, targetID, trackID)
	}
}

// drainCustomPathGuides drains the catalogue as the caller: the LIST is not
// shared across callers. A nil source with no error means the backend is absent.
func (a *App) drainCustomPathGuides(r *http.Request, logger log.Logger) (pathGuideSource, error) {
	lister, namespace, available, _ := a.resolveCustomGuideBackend(r)
	if !available {
		return nil, nil
	}
	fetchCtx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), customGuideAggregateDeadline)
	defer cancel()
	entries, _, err := drainCustomGuides(fetchCtx, namespace, lister, logger)
	if err != nil {
		return nil, err
	}
	return customPathGuides(entries, logger), nil
}

// completionsUnavailableError means the completion backend is structurally
// absent, as opposed to a failed read.
type completionsUnavailableError struct{ reason string }

func (e *completionsUnavailableError) Error() string {
	return "completion records unavailable: " + e.reason
}

// callerCompletionRecords is the caller's raw completion rows, skipping the
// collation the completion cache applies. The whole namespace is read with no
// record cap, so a truncated read can never report finished work as unmet.
func (a *App) callerCompletionRecords(r *http.Request, userID string) ([]completionRecordSpec, error) {
	lister, namespace, available, reason := a.resolveCompletionBackend(r)
	if !available {
		return nil, &completionsUnavailableError{reason: reason}
	}
	fetchCtx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), completionAggregateDeadline)
	defer cancel()
	all, _, err := drainCompletionRecords(fetchCtx, namespace, lister, 0, a.ctxLogger(r.Context()))
	if err != nil {
		return nil, err
	}
	// Trust boundary: all holds every user's rows; filter to the caller here.
	out := make([]completionRecordSpec, 0, len(all))
	for _, rec := range all {
		if rec.UserID == userID {
			out = append(out, rec)
		}
	}
	return out, nil
}

// satisfactionFunc returns the per-assignment guide progress for this request.
func (a *App) satisfactionFunc(r *http.Request, completions []completionRecordSpec) func(assignmentSpec) ([]assignmentGuideEntry, error) {
	ev := a.newObligationEvaluator(r)
	return func(rec assignmentSpec) ([]assignmentGuideEntry, error) {
		return ev.guideProgress(rec, completions)
	}
}

// assignmentStatusDispatchOverride lets tests run the background status writes
// inline so no goroutine outlives the test.
var assignmentStatusDispatchOverride func(run func())

// writeSatisfiedAssignments writes status.satisfied on the caller's active
// assignments that a new completion newly meets, for consumers that LIST the
// kind. It runs in the background and must never fail the completion write.
func (a *App) writeSatisfiedAssignments(r *http.Request, userID string, just completionRecordSpec) {
	logger := a.ctxLogger(r.Context())
	a.dispatchStatusWrite(r, logger, func(bgReq *http.Request) {
		a.syncSatisfiedAssignments(bgReq, userID, just, logger)
	})
}

// markSatisfiedInBackground repairs status.satisfied on assignments GET
// /assignments/my evaluated as met while the flag is unset, healing a write
// that was lost. It is best-effort and never delays the response.
func (a *App) markSatisfiedInBackground(r *http.Request, lister assignmentLister, namespace string, records []assignmentSpec) {
	if len(records) == 0 {
		return
	}
	logger := a.ctxLogger(r.Context())
	a.dispatchStatusWrite(r, logger, func(bgReq *http.Request) {
		ctx, cancel := context.WithTimeout(bgReq.Context(), assignmentAggregateDeadline)
		defer cancel()
		for _, rec := range records {
			markAssignmentSatisfied(ctx, lister, namespace, rec, logger)
		}
	})
}

// dispatchStatusWrite runs work detached from the request, recovering a panic.
func (a *App) dispatchStatusWrite(r *http.Request, logger log.Logger, work func(bgReq *http.Request)) {
	// Detached: the request context is canceled once the response is written.
	bgReq := r.WithContext(context.WithoutCancel(r.Context()))
	run := func() {
		defer func() {
			if panicVal := recover(); panicVal != nil {
				logger.Error("assignment status write panicked", "panic", panicVal)
			}
		}()
		work(bgReq)
	}
	if dispatch := assignmentStatusDispatchOverride; dispatch != nil {
		dispatch(run)
		return
	}
	go run()
}

func isStatusSatisfied(rec assignmentSpec) bool {
	return rec.StatusSatisfied != nil && *rec.StatusSatisfied
}

// syncSatisfiedAssignments reads completions only once an unsatisfied active
// assignment of the caller's contains the just-completed guide.
func (a *App) syncSatisfiedAssignments(r *http.Request, userID string, just completionRecordSpec, logger log.Logger) {
	lister, namespace, available, _ := a.resolveAssignmentBackend(r)
	if !available {
		return
	}
	fetchCtx, cancel := context.WithTimeout(r.Context(), assignmentAggregateDeadline)
	records, err := drainAssignments(fetchCtx, namespace, userID, lister)
	cancel()
	if err != nil {
		logger.Info("assignment status write skipped", "error", err)
		return
	}
	ev := a.newObligationEvaluator(r)
	var candidates []assignmentSpec
	for _, rec := range records {
		if rec.Name == "" || isStatusSatisfied(rec) {
			continue
		}
		guideIDs, err := ev.assignmentGuides(rec)
		if err != nil {
			logger.Info("assignment status write skipped", "targetId", rec.TargetID, "error", err)
			continue
		}
		if slices.Contains(guideIDs, just.GuideID) {
			candidates = append(candidates, rec)
		}
	}
	if len(candidates) == 0 {
		return
	}
	completions, err := a.callerCompletionRecords(r, userID)
	if err != nil {
		logger.Info("assignment status write skipped", "error", err)
		return
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
	for _, rec := range candidates {
		guides, err := ev.guideProgress(rec, completions)
		if err != nil || !satisfiedFromGuides(guides) {
			continue
		}
		markAssignmentSatisfied(r.Context(), lister, namespace, rec, logger)
	}
}

// markAssignmentSatisfied replaces the assignment's status subresource (PUT).
// A lost write, a 409 included, is repaired by the next GET /assignments/my.
func markAssignmentSatisfied(ctx context.Context, lister assignmentLister, namespace string, rec assignmentSpec, logger log.Logger) {
	if err := lister.UpdateStatus(ctx, namespace, rec.Name, rec.ResourceVersion, true); err != nil {
		logger.Info("assignment status write failed", "name", rec.Name, "error", err)
	}
}
