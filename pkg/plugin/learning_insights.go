package plugin

import (
	"context"
	"github.com/grafana/grafana-pathfinder-app/pkg/services"
	"net/http"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
)

const (
	learningInsightsMaxPages = services.LearningInsightsMaxPages
	learningInsightsMaxItems = services.LearningInsightsMaxItems
	learningInsightsDeadline = 30 * time.Second
)

type learningInsightsResponse = services.LearningInsightsResponse

func newLearningInsightsResponse(from, to time.Time) learningInsightsResponse {
	return services.NewLearningInsightsResponse(from, to)
}

func learningInsightsPeriod(r *http.Request) (time.Time, time.Time, error) {
	return services.LearningInsightsPeriod(r.URL.Query(), timeNow())
}

func (a *App) handleLearningInsights(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	// User.Role is Grafana's current-org role in the trusted RPC context, never a browser header.
	pc := backend.PluginConfigFromContext(r.Context())
	if pc.User == nil || pc.User.Role != "Admin" {
		a.writeError(w, "learning-insights-forbidden", http.StatusForbidden)
		return
	}
	from, to, err := learningInsightsPeriod(r)
	if err != nil {
		a.writeError(w, "invalid-period", http.StatusBadRequest)
		return
	}
	resp := newLearningInsightsResponse(from, to)
	userID, status := a.subjectFromIDToken(r)
	if status != identityVerified {
		resp.Capability.Reason = status.capabilityReason()
		a.writeJSON(w, resp, http.StatusOK)
		return
	}
	if a.assignmentsReadRateLimiter != nil {
		if allow, retryAfter := a.assignmentsReadRateLimiter.allow(userID); !allow {
			a.writeRateLimited(w, retryAfter)
			return
		}
	}
	ctx, cancel := context.WithTimeout(r.Context(), learningInsightsDeadline)
	defer cancel()
	r = r.WithContext(ctx)
	completionLister, namespace, available, reason := a.resolveCompletionBackend(r)
	if !available {
		resp.Capability.Reason = reason
		a.writeJSON(w, resp, http.StatusOK)
		return
	}
	resp.Capability.Available = true
	records, completionsComplete, warning := drainInsights(ctx, func(token string) ([]completionRecordSpec, string, error) {
		page, err := completionLister.ListPage(ctx, namespace, token)
		if err != nil {
			return nil, "", err
		}
		return page.Records, page.Continue, nil
	})
	if warning != "" {
		resp.Partial("completions-" + warning)
	}
	assignments := []assignmentSpec{}
	lister, assignmentNamespace, available, reason := a.resolveAssignmentBackend(r)
	if !available {
		resp.Partial("assignments-" + reason)
	} else if assignmentNamespace != namespace {
		resp.Partial("assignments-namespace-mismatch")
	} else {
		var asgWarning string
		assignments, _, asgWarning = drainInsights(ctx, func(token string) ([]assignmentSpec, string, error) {
			page, err := lister.ListPage(ctx, namespace, token)
			if err != nil {
				return nil, "", err
			}
			return page.Records, page.Continue, nil
		})
		if asgWarning != "" {
			resp.Partial("assignments-" + asgWarning)
		}
	}
	ev := a.insightsObligationEvaluator(r)
	shapeLearningInsights(&resp, records, assignments, from, to, timeNow().UTC(), completionsComplete, func(rec assignmentSpec, history []completionRecordSpec) ([]assignmentGuideEntry, error) {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		return ev.GuideProgress(rec, history)
	})
	if ctx.Err() != nil {
		resp.Partial("evaluation-deadline")
	}
	resp.AsOf = timeNow().UTC().Format(time.RFC3339Nano)
	a.ctxLogger(r.Context()).Debug("learning insights served", "namespace", namespace, "completionRecords", len(records), "assignmentRecords", len(assignments), "completeness", resp.Completeness, "warnings", resp.Warnings)
	a.writeJSON(w, resp, http.StatusOK)
}

// The shared client caps each page at 8 MiB: at most 160 MiB per kind is read, with 10k retained rows.
func drainInsights[T any](ctx context.Context, page func(string) ([]T, string, error)) ([]T, bool, string) {
	return services.DrainInsights(ctx, page, isTerminalUpstreamError)
}

func shapeLearningInsights(resp *learningInsightsResponse, records []completionRecordSpec, assignments []assignmentSpec, from, to, now time.Time, historyComplete bool, progress func(assignmentSpec, []completionRecordSpec) ([]assignmentGuideEntry, error)) {
	services.ShapeLearningInsights(resp, records, assignments, from, to, now, historyComplete, progress)
}
