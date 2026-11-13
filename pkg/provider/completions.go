package provider

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"time"

	authlib "github.com/grafana/authlib/types"
	"github.com/grafana/grafana-app-sdk/app"
	"github.com/grafana/grafana-app-sdk/simple"
	"github.com/grafana/grafana-pathfinder-app/pkg/resourceaccess"
	"github.com/grafana/grafana-pathfinder-app/pkg/services"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
)

type completionCapability struct {
	Diagnostics     *services.ProxyDiagnostic `json:"diagnostics,omitempty"`
	Available       bool                      `json:"available"`
	Reason          string                    `json:"reason,omitempty"`
	ProgressRecords bool                      `json:"progressRecords,omitempty"`
}

type completionResponse struct {
	Diagnostics *services.ProxyDiagnostic       `json:"diagnostics,omitempty"`
	Capability  completionCapability            `json:"capability"`
	UserID      string                          `json:"userId,omitempty"`
	Completions []services.CollatedCompletion   `json:"completions"`
	InProgress  []services.InProgressCompletion `json:"inProgress"`
	AsOf        string                          `json:"asOf,omitempty"`
}

func sdkErrorStatus(err error) int {
	var status apierrors.APIStatus
	if errors.As(err, &status) {
		return int(status.Status().Code)
	}
	return 0
}

func completionReadHandler(store *resourceaccess.CompletionStore, capabilityOnly bool) simple.AppCustomRouteHandler {
	return func(ctx context.Context, w app.CustomRouteResponseWriter, req *app.CustomRouteRequest) error {
		w.Header().Set("Content-Type", "application/json")
		if req.Method != http.MethodGet {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return nil
		}
		response := completionResponse{Completions: []services.CollatedCompletion{}, InProgress: []services.InProgressCompletion{}}
		write := func() error {
			if capabilityOnly {
				return json.NewEncoder(w).Encode(response.Capability)
			}
			return json.NewEncoder(w).Encode(response)
		}
		namespace, err := callerNamespace(ctx, req.ResourceIdentifier.Namespace)
		identity, ok := authlib.AuthInfoFrom(ctx)
		if err != nil || !ok || identity.GetSubject() == "" {
			response.Capability.Reason = "identity-unavailable"
			response.Capability.Diagnostics = &services.ProxyDiagnostic{Stage: "identity", Resource: "completionrecords", Operation: "list", Outcome: "error", Reason: "identity-unavailable"}
			return write()
		}
		forced := !capabilityOnly && req.URL != nil && req.URL.Query().Get("refresh") == "1"
		cacheKey := services.CallerCompletionCacheKey(namespace, identity.GetSubject())
		index, err := services.LoadCompletionIndex(ctx, cacheKey, forced, log.DefaultLogger, func(ctx context.Context) (*services.CompletionIndex, int, error) {
			var records []services.CompletionRecord
			token, pages, scanned := "", 0, 0
			for {
				page, err := store.ListPage(ctx, namespace, token)
				if err != nil {
					return nil, pages, err
				}
				pages++
				scanned += len(page.Records)
				for _, record := range page.Records {
					if record.UserID == identity.GetSubject() {
						records = append(records, record)
					}
				}
				if scanned >= 50000 && page.Continue != "" {
					log.DefaultLogger.Warn("completion records LIST truncated at aggregate budget", "namespace", namespace, "maxTotalRecords", 50000, "pages", pages)
					break
				}
				if page.Continue == "" {
					break
				}
				token = page.Continue
			}
			completed, progress := services.CollateCompletions(records)
			return &services.CompletionIndex{ByUser: completed, InProgressByUser: progress, AsOf: time.Now()}, pages, nil
		}, time.Now, completionFailureCooldown, func(err error) string { return upstreamDiagnostic(err, "completionrecords", "list").Reason })
		diagnostic := upstreamDiagnostic(err, "completionrecords", "list")
		if index == nil {
			status := sdkErrorStatus(err)
			if status >= 400 && status < 500 && status != 408 && status != 429 {
				response.Capability.Reason, response.Capability.Diagnostics = "backend-unavailable", diagnostic
				return write()
			}
			w.Header().Set("Retry-After", "30")
			w.WriteHeader(http.StatusServiceUnavailable)
			return json.NewEncoder(w).Encode(map[string]any{"error": "completion-records-unavailable", "diagnostics": diagnostic})
		}
		if diagnostic != nil {
			diagnostic.Outcome, diagnostic.Cache = "degraded", "stale"
			diagnostic.CacheAgeMS = max(0, time.Since(index.AsOf).Milliseconds())
		}
		response.Capability.Available, response.Capability.ProgressRecords = true, true
		if capabilityOnly {
			response.Capability.Diagnostics = diagnostic
		} else {
			response.Diagnostics, response.UserID, response.AsOf = diagnostic, identity.GetSubject(), index.AsOf.UTC().Format(time.RFC3339)
			if items := index.ByUser[response.UserID]; items != nil {
				response.Completions = items
			}
			if items := index.InProgressByUser[response.UserID]; items != nil {
				response.InProgress = items
			}
		}
		return write()
	}
}

func completionFailureCooldown(err error) bool {
	if errors.Is(err, context.Canceled) {
		return false
	}
	var networkError net.Error
	if errors.As(err, &networkError) || errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	diagnostic := upstreamDiagnostic(err, "completionrecords", "list")
	return diagnostic != nil && diagnostic.UpstreamStatus >= 300 && diagnostic.UpstreamStatus != 401 && diagnostic.UpstreamStatus != 403
}
