package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"github.com/grafana/grafana-pathfinder-app/pkg/plugin/auth"
	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/config"
)

const pathfinderSettingsMaxBytes = 1024 * 1024

func (a *App) handlePathfinderSettings(w http.ResponseWriter, r *http.Request) {
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
		a.writeError(w, "settings proxy unavailable", http.StatusServiceUnavailable)
		return
	}
	appURL, err := cfg.AppURL()
	if err != nil || appURL == "" {
		a.writeError(w, "settings proxy unavailable", http.StatusServiceUnavailable)
		return
	}
	client := newAppPlatformListClient(appURL, a.oboExchanger, r.Header.Get(backend.GrafanaUserSignInTokenHeaderName), a.ctxLogger(r.Context()))
	body, err := client.getSettings(r.Context(), namespace)
	if err != nil {
		status := http.StatusBadGateway
		if upstreamStatus, ok := upstreamStatusOf(err); ok && upstreamStatus >= 400 && upstreamStatus <= 599 {
			status = upstreamStatus
		}
		a.ctxLogger(r.Context()).Warn("Pathfinder settings proxy read failed", "namespace", namespace, "error", err)
		message := "settings read failed"
		if status == http.StatusNotFound || status == http.StatusMethodNotAllowed || status == http.StatusNotImplemented {
			message = "settings-upstream-unavailable"
		}
		a.writeError(w, message, status)
		return
	}
	a.writeJSON(w, body, http.StatusOK)
}

func (c *appPlatformListClient) getSettings(ctx context.Context, namespace string) (json.RawMessage, error) {
	ctx, cancel := context.WithTimeout(ctx, appPlatformUpstreamTimeout)
	defer cancel()
	token, err := mintAccessToken(ctx, c.minter, namespace, c.idToken)
	if err != nil {
		return nil, err
	}
	endpoint := buildAppPlatformURL(c.appURL, appPlatformGroup+"/v1alpha1", namespace, "pathfindersettings") + "/default"
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
		return nil, &appPlatformUpstreamError{status: resp.StatusCode, msg: fmt.Sprintf("settings upstream status %d", resp.StatusCode)}
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, pathfinderSettingsMaxBytes+1))
	if err != nil {
		return nil, err
	}
	if len(body) > pathfinderSettingsMaxBytes || !json.Valid(body) {
		return nil, fmt.Errorf("invalid settings upstream response")
	}
	return json.RawMessage(body), nil
}
