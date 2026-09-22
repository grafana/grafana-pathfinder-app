package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"

	"github.com/grafana/grafana-pathfinder-app/pkg/plugin/auth"
	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/config"
)

const pathfinderSettingsMaxBytes = 1024 * 1024

func (a *App) handlePathfinderSettings(w http.ResponseWriter, r *http.Request) {
	a.handleAppPlatformRead(w, r, "pathfindersettings", "default", pathfinderSettingsMaxBytes)
}

func (a *App) handleAppPlatformRead(w http.ResponseWriter, r *http.Request, resource, name string, maxBytes int64) {
	w.Header().Set("Cache-Control", "no-store")
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		a.writeError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if status := a.validIDToken(r); status != identityVerified {
		a.writeError(w, status.capabilityReason(), http.StatusForbidden)
		return
	}
	namespace := backend.PluginConfigFromContext(r.Context()).Namespace
	cfg := config.GrafanaConfigFromContext(r.Context())
	if cfg == nil || namespace == "" || a.oboExchanger == nil {
		a.writeError(w, "app platform proxy unavailable", http.StatusServiceUnavailable)
		return
	}
	appURL, err := cfg.AppURL()
	if err != nil || appURL == "" {
		a.writeError(w, "app platform proxy unavailable", http.StatusServiceUnavailable)
		return
	}
	client := newAppPlatformListClient(appURL, a.oboExchanger, r.Header.Get(backend.GrafanaUserSignInTokenHeaderName), a.ctxLogger(r.Context()))
	body, err := client.getItem(r.Context(), namespace, resource, name, maxBytes)
	if err != nil {
		status := appPlatformReadErrorStatus(err)
		a.ctxLogger(r.Context()).Warn("App Platform proxy read failed", "resource", resource, "namespace", namespace, "error", err)
		message := "app platform read failed"
		if resource == "pathfindersettings" && (status == http.StatusNotFound || status == http.StatusMethodNotAllowed || status == http.StatusNotImplemented) {
			message = "settings-upstream-unavailable"
		}
		a.writeError(w, message, status)
		return
	}
	a.writeJSON(w, body, http.StatusOK)
}

func (c *appPlatformListClient) getSettings(ctx context.Context, namespace string) (json.RawMessage, error) {
	return c.getItem(ctx, namespace, "pathfindersettings", "default", pathfinderSettingsMaxBytes)
}

func (c *appPlatformListClient) getItem(ctx context.Context, namespace, resource, name string, maxBytes int64) (json.RawMessage, error) {
	ctx, cancel := context.WithTimeout(ctx, appPlatformUpstreamTimeout)
	defer cancel()
	token, err := mintAccessToken(ctx, c.minter, namespace, c.idToken)
	if err != nil {
		return nil, err
	}
	endpoint := buildAppPlatformURL(c.appURL, appPlatformGroup+"/v1alpha1", namespace, resource) + "/" + url.PathEscape(name)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set(auth.AccessTokenHeader, token)
	req.Header.Set("Accept", "application/json")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil, &appPlatformUpstreamError{status: resp.StatusCode, msg: fmt.Sprintf("app platform upstream status %d", resp.StatusCode)}
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBytes+1))
	if err != nil {
		return nil, err
	}
	if int64(len(body)) > maxBytes || !json.Valid(body) {
		return nil, fmt.Errorf("invalid app platform upstream response")
	}
	return json.RawMessage(body), nil
}

func appPlatformReadErrorStatus(err error) int {
	status, ok := upstreamStatusOf(err)
	// Grafana interprets plugin-resource 401s as session expiry, not upstream failure.
	if !ok || status == http.StatusUnauthorized || status < 400 || status > 599 {
		return http.StatusBadGateway
	}
	return status
}
