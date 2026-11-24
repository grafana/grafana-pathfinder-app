package plugin

import (
	"context"
	"github.com/grafana/grafana-pathfinder-app/pkg/services"
	"net/http"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

type assignmentGuideEntry = services.AssignmentGuideEntry

func satisfiedFromGuides(guides []assignmentGuideEntry) bool {
	return services.SatisfiedFromGuides(guides)
}

type obligationEvaluator = services.ObligationEvaluator

// newObligationEvaluator builds one evaluator per request. The custom-guide
// catalogue is drained on first use, at most once.
func (a *App) newObligationEvaluator(r *http.Request) *obligationEvaluator {
	ev := &obligationEvaluator{
		Context: r.Context(),
		Logger:  a.ctxLogger(r.Context()),
	}
	ev.Sources = append(ev.Sources, bundledPathGuides(ev.Logger), a.lazyCustomPathGuides(r, ev.Logger))
	ev.Sources = append(ev.Sources, a.onlinePathGuides(ev.Logger))
	return ev
}

func (a *App) lazyCustomPathGuides(r *http.Request, logger log.Logger) pathGuideSource {
	var source pathGuideSource
	var loadErr error
	loaded := false
	return func(ctx context.Context, targetID, trackID, targetSource string) ([]assignmentGuideIdentity, bool, error) {
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
		return source(ctx, targetID, trackID, targetSource)
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

// Status repair must use the same source-qualified match as per-guide credit.
func containsAssignmentGuide(guides []assignmentGuideIdentity, rec completionRecordSpec) bool {
	for _, guide := range guides {
		if assignmentGuideMatchesCompletion(guide, rec) {
			return true
		}
	}
	return false
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
	services.SyncSatisfiedAssignments(records, just, a.newObligationEvaluator(r), func() ([]services.CompletionRecord, error) { return a.callerCompletionRecords(r, userID) }, func(rec services.Assignment) { markAssignmentSatisfied(r.Context(), lister, namespace, rec, logger) }, logger)
}

// markAssignmentSatisfied replaces the assignment's status subresource (PUT).
// A lost write, a 409 included, is repaired by the next GET /assignments/my.
func markAssignmentSatisfied(ctx context.Context, lister assignmentLister, namespace string, rec assignmentSpec, logger log.Logger) {
	if err := lister.UpdateStatus(ctx, namespace, rec.Name, rec.ResourceVersion, true); err != nil {
		logger.Info("assignment status write failed", "name", rec.Name, "error", err)
	}
}
