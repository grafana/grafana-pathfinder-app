package provider

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/grafana/grafana-app-sdk/app"
	"github.com/grafana/grafana-app-sdk/logging"
	"github.com/grafana/grafana-app-sdk/simple"
	"github.com/grafana/grafana-pathfinder-app/pkg/resourceaccess"
	"github.com/grafana/grafana-pathfinder-app/pkg/services"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
)

type catalogueResponse struct {
	Diagnostics *services.ProxyDiagnostic `json:"diagnostics,omitempty"`
	Capability  struct {
		Available bool   `json:"available"`
		Reason    string `json:"reason,omitempty"`
	} `json:"capability"`
	Guides []services.CatalogueEntry `json:"guides"`
	AsOf   string                    `json:"asOf,omitempty"`
}

func catalogueReadHandler(store *resourceaccess.GuideStore) simple.AppCustomRouteHandler {
	return func(ctx context.Context, w app.CustomRouteResponseWriter, req *app.CustomRouteRequest) error {
		w.Header().Set("Content-Type", "application/json")
		if req.Method != http.MethodGet {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return nil
		}
		response := catalogueResponse{Guides: []services.CatalogueEntry{}}
		namespace, err := callerNamespace(ctx, req.ResourceIdentifier.Namespace)
		if err != nil {
			response.Capability.Reason = "identity-unavailable"
			response.Diagnostics = &services.ProxyDiagnostic{Stage: "identity", Resource: "interactiveguides", Operation: "list", Outcome: "error", Reason: "identity-unavailable"}
			return json.NewEncoder(w).Encode(response)
		}
		ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 60*time.Second)
		defer cancel()
		warnings := 0
		warn := func(message string, args ...any) {
			warnings++
			if warnings <= 10 {
				logging.DefaultLogger.Warn(message, append([]any{"namespace", namespace}, args...)...)
			}
		}
		entries, _, err := services.ReadCatalogue(ctx, namespace, 50000, func(ctx context.Context, namespace, token string) (services.CataloguePage[services.CatalogueEntry], error) {
			raw, err := store.ListPage(ctx, namespace, token)
			if err != nil {
				return services.CataloguePage[services.CatalogueEntry]{}, err
			}
			page := services.CataloguePage[services.CatalogueEntry]{Continue: raw.Continue}
			for _, item := range raw.Items {
				var object struct {
					Spec json.RawMessage `json:"spec"`
				}
				if err := json.Unmarshal(item, &object); err != nil {
					return page, err
				}
				if entry, ok := services.DecodeCatalogueEntry(object.Spec, warn); ok {
					page.Entries = append(page.Entries, entry)
				}
			}
			return page, nil
		}, func(pages int) {
			logging.DefaultLogger.Warn("custom guide catalogue LIST truncated at aggregate budget", "namespace", namespace, "maxTotalEntries", 50000, "pages", pages)
		})
		if warnings > 10 {
			logging.DefaultLogger.Warn("custom guide repository: further decode warnings suppressed", "namespace", namespace, "warnings", warnings, "logged", 10)
		}
		if err != nil {
			diagnostic := &services.ProxyDiagnostic{Stage: "app-platform", Resource: "interactiveguides", Operation: "list", Outcome: "error", Reason: "unexpected-error"}
			var upstream apierrors.APIStatus
			if errors.As(err, &upstream) {
				status := int(upstream.Status().Code)
				diagnostic.UpstreamStatus, diagnostic.Reason = status, "http-error"
				if status == 401 {
					diagnostic.Reason = "authentication-failed"
				}
				if status == 403 {
					diagnostic.Reason = "authorization-denied"
				}
				if status >= 400 && status < 500 && status != 408 && status != 429 {
					response.Capability.Reason = fmt.Sprintf("upstream-%d", status)
					response.Diagnostics = diagnostic
					return json.NewEncoder(w).Encode(response)
				}
			}
			w.Header().Set("Retry-After", "30")
			w.WriteHeader(http.StatusServiceUnavailable)
			return json.NewEncoder(w).Encode(map[string]any{"error": "custom-guide-repository-unavailable", "diagnostics": diagnostic})
		}
		response.Guides = entries
		response.Capability.Available = true
		response.AsOf = time.Now().UTC().Format(time.RFC3339)
		return json.NewEncoder(w).Encode(response)
	}
}
