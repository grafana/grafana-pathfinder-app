package provider

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"time"

	authlib "github.com/grafana/authlib/types"
	"github.com/grafana/grafana-app-sdk/app"
	"github.com/grafana/grafana-app-sdk/simple"
	"github.com/grafana/grafana-pathfinder-app/pkg/services"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

type assignmentCapability struct {
	Available bool   `json:"available"`
	Reason    string `json:"reason,omitempty"`
}
type assignmentResponse struct {
	Capability  assignmentCapability       `json:"capability"`
	UserID      string                     `json:"userId,omitempty"`
	Assignments []services.AssignmentEntry `json:"assignments"`
	AsOf        string                     `json:"asOf,omitempty"`
}
type assignmentRouteDependencies struct {
	Assignments     services.AssignmentReader
	ReadCompletions func(context.Context, string, string) ([]services.CompletionRecord, error)
	Evaluator       func(context.Context, string) *services.ObligationEvaluator
	MarkSatisfied   func(context.Context, string, []services.Assignment)
	Allow           func(string, string) (bool, time.Duration)
}

func assignmentsReadHandler(deps assignmentRouteDependencies) simple.AppCustomRouteHandler {
	return func(ctx context.Context, w app.CustomRouteResponseWriter, req *app.CustomRouteRequest) error {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		if req.Method != http.MethodGet {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return nil
		}
		response := assignmentResponse{Assignments: []services.AssignmentEntry{}}
		write := func() error { return json.NewEncoder(w).Encode(response) }
		namespace, err := callerNamespace(ctx, req.ResourceIdentifier.Namespace)
		identity, ok := authlib.AuthInfoFrom(ctx)
		if err != nil || !ok || identity.GetSubject() == "" {
			response.Capability.Reason = "identity-unavailable"
			return write()
		}
		subject := identity.GetSubject()
		if allow, retry := deps.Allow(namespace, subject); !allow {
			w.Header().Set("Retry-After", strconv.Itoa(max(1, int(math.Ceil(retry.Seconds())))))
			w.WriteHeader(http.StatusTooManyRequests)
			return json.NewEncoder(w).Encode(map[string]string{"error": "rate-limited"})
		}
		fail := func(err error) error {
			status := sdkErrorStatus(err)
			if status >= 400 && status < 500 && status != 408 && status != 429 {
				response.Capability.Reason = fmt.Sprintf("upstream-%d", status)
				return write()
			}
			w.Header().Set("Retry-After", "30")
			w.WriteHeader(http.StatusServiceUnavailable)
			return json.NewEncoder(w).Encode(map[string]string{"error": "assignments-unavailable"})
		}
		fetchCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 60*time.Second)
		records, err := services.ReadAssignments(fetchCtx, namespace, subject, deps.Assignments)
		cancel()
		if err != nil {
			return fail(err)
		}
		ev := deps.Evaluator(ctx, namespace)
		entries, err := services.ReadAssignmentView(ctx, records, subject, services.AssignmentViewDependencies{
			ReadCompletions: func(ctx context.Context, subject string) ([]services.CompletionRecord, error) {
				readCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 60*time.Second)
				defer cancel()
				return deps.ReadCompletions(readCtx, namespace, subject)
			},
			Progress: ev.GuideProgress,
			MarkSatisfied: func(records []services.Assignment) {
				deps.MarkSatisfied(context.WithoutCancel(ctx), namespace, records)
			},
			Logger: log.DefaultLogger,
		})
		if err != nil {
			return fail(err)
		}
		response.Capability.Available = true
		response.UserID = subject
		response.Assignments = entries
		response.AsOf = time.Now().UTC().Format(time.RFC3339)
		return write()
	}
}
