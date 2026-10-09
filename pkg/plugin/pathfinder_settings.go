package plugin

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/config"
)

const pathfinderSettingsMaxBytes = 1024 * 1024

func (a *App) handlePathfinderSettings(w http.ResponseWriter, r *http.Request) {
	a.handleAppPlatformRead(w, r, "pathfindersettings", "default", pathfinderSettingsMaxBytes)
}

func (a *App) handleAppPlatformRead(w http.ResponseWriter, r *http.Request, resource, name string, maxBytes int64) {
	client, namespace, ok := a.appPlatformReadClient(w, r, resource)
	if !ok {
		return
	}
	body, err := client.getItem(r.Context(), namespace, resource, name, maxBytes)
	if err != nil {
		status := appPlatformReadErrorStatus(err)

		message := "app platform read failed"
		if resource == "pathfindersettings" && (status == http.StatusNotFound || status == http.StatusMethodNotAllowed || status == http.StatusNotImplemented) {
			message = "settings-upstream-unavailable"
		}
		a.writeProxyError(w, message, status, appPlatformDiagnostic(err, resource, "get"))
		return
	}
	a.writeJSON(w, body, http.StatusOK)
}

func (a *App) appPlatformReadClient(w http.ResponseWriter, r *http.Request, resource string) (*appPlatformListClient, string, bool) {
	w.Header().Set("Cache-Control", "no-store")
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		a.writeError(w, "method not allowed", http.StatusMethodNotAllowed)
		return nil, "", false
	}
	if status := a.validIDToken(r); status != identityVerified {
		a.writeProxyError(w, status.capabilityReason(), http.StatusForbidden, proxyGateDiagnostic("identity-unavailable", resource, "get", "identity"))
		return nil, "", false
	}
	namespace := backend.PluginConfigFromContext(r.Context()).Namespace
	cfg := config.GrafanaConfigFromContext(r.Context())
	if cfg == nil || namespace == "" || a.oboExchanger == nil {
		a.writeProxyError(w, "app platform proxy unavailable", http.StatusServiceUnavailable, proxyGateDiagnostic("proxy-unavailable", resource, "get", "configuration"))
		return nil, "", false
	}
	appURL, err := cfg.AppURL()
	if err != nil || appURL == "" {
		a.writeProxyError(w, "app platform proxy unavailable", http.StatusServiceUnavailable, proxyGateDiagnostic("proxy-unavailable", resource, "get", "configuration"))
		return nil, "", false
	}
	return newAppPlatformListClient(appURL, a.oboExchanger, r.Header.Get(backend.GrafanaUserSignInTokenHeaderName), a.ctxLogger(r.Context())), namespace, true
}

func (c *appPlatformListClient) getSettings(ctx context.Context, namespace string) (json.RawMessage, error) {
	return c.getItem(ctx, namespace, "pathfindersettings", "default", pathfinderSettingsMaxBytes)
}

func (c *appPlatformListClient) getItem(ctx context.Context, namespace, resource, name string, maxBytes int64) (json.RawMessage, error) {
	return c.getPath(ctx, appPlatformGroup+"/v1alpha1", namespace, resource, name, nil, maxBytes)
}

func appPlatformReadErrorStatus(err error) int {
	status, ok := upstreamStatusOf(err)
	// Grafana interprets plugin-resource 401s as session expiry, not upstream failure.
	if !ok || status == http.StatusUnauthorized || status < 400 || status > 599 {
		return http.StatusBadGateway
	}
	return status
}
