package provider

import (
	"context"
	"encoding/json"
	"errors"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"net/http"

	"github.com/grafana/grafana-app-sdk/app"
	"github.com/grafana/grafana-app-sdk/simple"
	"github.com/grafana/grafana-pathfinder-app/pkg/services"
)

func settingsReadHandler(read services.SettingsReader) simple.AppCustomRouteHandler {
	return resourceReadHandler("pathfindersettings", "get", func(ctx context.Context, namespace string, _ *app.CustomRouteRequest) (json.RawMessage, error) {
		return services.ReadSettings(ctx, namespace, read)
	})
}

func resourceReadHandler(resourceName, operation string, read func(context.Context, string, *app.CustomRouteRequest) (json.RawMessage, error)) simple.AppCustomRouteHandler {
	return func(ctx context.Context, w app.CustomRouteResponseWriter, request *app.CustomRouteRequest) error {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "application/json")
		if request.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			w.WriteHeader(http.StatusMethodNotAllowed)
			return json.NewEncoder(w).Encode(map[string]string{"error": "method not allowed"})
		}
		namespace, err := callerNamespace(ctx, request.ResourceIdentifier.Namespace)
		if err != nil {
			w.WriteHeader(http.StatusForbidden)
			return json.NewEncoder(w).Encode(struct {
				Error       string                   `json:"error"`
				Diagnostics services.ProxyDiagnostic `json:"diagnostics"`
			}{"identity-unavailable", services.ProxyDiagnostic{Stage: "identity", Resource: resourceName, Operation: operation, Outcome: "error", Reason: "identity-unavailable"}})
		}
		body, err := read(ctx, namespace, request)
		if err != nil {
			diagnostic := upstreamDiagnostic(err, resourceName, operation)
			status := http.StatusBadGateway
			message := "app platform read failed"
			var upstream apierrors.APIStatus
			if errors.As(err, &upstream) {
				value := upstream.Status()
				if diagnostic.UpstreamStatus >= 400 && diagnostic.UpstreamStatus <= 599 && diagnostic.UpstreamStatus != http.StatusUnauthorized {
					status = diagnostic.UpstreamStatus
				}
				encoded, marshalErr := json.Marshal(value)
				if resourceName == "pathfindersettings" && marshalErr == nil && request.URL != nil && request.URL.Query().Get("absence") == "explicit" && services.IsSettingsNotConfigured(int(value.Code), encoded) {
					return json.NewEncoder(w).Encode(map[string]string{"state": "not-configured"})
				}
			}
			if resourceName == "pathfindersettings" && (status == http.StatusNotFound || status == http.StatusMethodNotAllowed || status == http.StatusNotImplemented) {
				message = "settings-upstream-unavailable"
			}
			w.WriteHeader(status)
			return json.NewEncoder(w).Encode(struct {
				Error       string                   `json:"error"`
				Diagnostics services.ProxyDiagnostic `json:"diagnostics"`
			}{message, *diagnostic})
		}
		return json.NewEncoder(w).Encode(body)
	}
}
