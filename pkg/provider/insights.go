package provider

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"time"

	authlib "github.com/grafana/authlib/types"
	"github.com/grafana/grafana-app-sdk/app"
	"github.com/grafana/grafana-app-sdk/simple"
	"github.com/grafana/grafana-pathfinder-app/pkg/resourceaccess"
	"github.com/grafana/grafana-pathfinder-app/pkg/services"
)

func insightsReadHandler(completions *resourceaccess.CompletionStore, assignments *resourceaccess.AssignmentStore, evaluator func(context.Context, string) *services.ObligationEvaluator, allow func(string, string) (bool, time.Duration)) simple.AppCustomRouteHandler {
	return func(ctx context.Context, w app.CustomRouteResponseWriter, req *app.CustomRouteRequest) error {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		fail := func(status int, message string) error {
			w.WriteHeader(status)
			return json.NewEncoder(w).Encode(map[string]string{"error": message})
		}
		if req.Method != http.MethodGet {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return nil
		}
		namespace, err := callerNamespace(ctx, req.ResourceIdentifier.Namespace)
		if err != nil || !callerIsAdmin(ctx, namespace) {
			return fail(http.StatusForbidden, "learning-insights-forbidden")
		}
		query := url.Values{}
		if req.URL != nil {
			query = req.URL.Query()
		}
		from, to, err := services.LearningInsightsPeriod(query, time.Now())
		if err != nil {
			return fail(http.StatusBadRequest, "invalid-period")
		}
		identity, _ := authlib.AuthInfoFrom(ctx)
		if allowed, retry := allow(namespace, identity.GetSubject()); !allowed {
			w.Header().Set("Retry-After", strconv.Itoa(max(1, int(math.Ceil(retry.Seconds())))))
			return fail(http.StatusTooManyRequests, "rate-limited")
		}
		ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
		defer cancel()
		terminal := func(err error) bool {
			status := sdkErrorStatus(err)
			return status >= 400 && status < 500 && status != 408 && status != 429
		}
		response := services.NewLearningInsightsResponse(from, to)
		response.Capability.Available = true
		records, complete, warning := services.DrainInsights(ctx, func(token string) ([]services.CompletionRecord, string, error) {
			page, err := completions.ListPage(ctx, namespace, token)
			return page.Records, page.Continue, err
		}, terminal)
		if warning != "" {
			response.Partial("completions-" + warning)
		}
		obligations, _, warning := services.DrainInsights(ctx, func(token string) ([]services.Assignment, string, error) {
			page, err := assignments.ListPage(ctx, namespace, token)
			if err != nil {
				return nil, "", err
			}
			return page.Records, page.Continue, nil
		}, terminal)
		if warning != "" {
			response.Partial("assignments-" + warning)
		}
		ev := evaluator(ctx, namespace)
		services.ShapeLearningInsights(&response, records, obligations, from, to, time.Now().UTC(), complete, func(record services.Assignment, history []services.CompletionRecord) ([]services.AssignmentGuideEntry, error) {
			if err := ctx.Err(); err != nil {
				return nil, err
			}
			return ev.GuideProgress(record, history)
		})
		if ctx.Err() != nil {
			response.Partial("evaluation-deadline")
		}
		response.AsOf = time.Now().UTC().Format(time.RFC3339Nano)
		return json.NewEncoder(w).Encode(response)
	}
}
