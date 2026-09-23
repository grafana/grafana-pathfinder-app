package plugin

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"net"
	"net/http"
)

type guideProxyDiagnostic struct {
	Stage            string         `json:"stage,omitempty"`
	Resource         string         `json:"resource,omitempty"`
	Operation        string         `json:"operation,omitempty"`
	Outcome          string         `json:"outcome"`
	Reason           string         `json:"reason,omitempty"`
	UpstreamStatus   int            `json:"upstreamStatus,omitempty"`
	Cache            string         `json:"cache,omitempty"`
	CacheAgeMS       int64          `json:"cacheAgeMs"`
	ManifestFailures map[string]int `json:"manifestFailures,omitempty"`
	BudgetExhausted  bool           `json:"budgetExhausted,omitempty"`
}

type guideProxyError struct {
	diagnostic guideProxyDiagnostic
	err        error
}

func (e *guideProxyError) Error() string { return e.err.Error() }
func (e *guideProxyError) Unwrap() error { return e.err }

func classifyGuideProxyError(err error) guideProxyDiagnostic {
	diagnostic := guideProxyDiagnostic{Outcome: "error", Reason: "unexpected-error"}
	var typed *guideProxyError
	var upstream *appPlatformUpstreamError
	var syntax *json.SyntaxError
	var shape *json.UnmarshalTypeError
	var network net.Error
	switch {
	case errors.As(err, &typed):
		return typed.diagnostic
	case errors.Is(err, context.DeadlineExceeded):
		diagnostic.Reason = "timeout"
	case errors.Is(err, context.Canceled):
		diagnostic.Reason = "cancelled"
	case isTokenExchangeError(err):
		diagnostic.Reason = "token-exchange-failed"
	case errors.As(err, &upstream):
		diagnostic.Reason, diagnostic.UpstreamStatus = "http-error", upstream.status
	case errors.As(err, &syntax), errors.As(err, &shape):
		diagnostic.Reason = "invalid-json"
	case errors.As(err, &network):
		diagnostic.Reason = "network-error"
		if network.Timeout() {
			diagnostic.Reason = "timeout"
		}
	}
	return diagnostic
}

func packageResponseDiagnostics(resp *PackageRecommendationsResponse, err error, cache string, age int64) (*PackageRecommendationsResponse, error) {
	if err != nil {
		diagnostic := classifyGuideProxyError(err)
		diagnostic.Cache, diagnostic.CacheAgeMS = cache, max(0, age)
		return nil, &guideProxyError{diagnostic: diagnostic, err: err}
	}
	copyResponse := *resp
	diagnostic := guideProxyDiagnostic{Outcome: "ok"}
	if resp.Diagnostics != nil {
		diagnostic = *resp.Diagnostics
	}
	diagnostic.Cache, diagnostic.CacheAgeMS = cache, max(0, age)
	copyResponse.Diagnostics = &diagnostic
	return &copyResponse, nil
}

func appPlatformDiagnostic(err error, resource, operation string) *guideProxyDiagnostic {
	if err == nil {
		return nil
	}
	d := classifyGuideProxyError(err)
	d.Stage, d.Resource, d.Operation = "app-platform", resource, operation
	if isTokenExchangeError(err) {
		d.Stage = "token-exchange"
		if !errors.Is(err, context.Canceled) {
			d.Reason = "token-exchange-failed"
		}
	}
	if d.UpstreamStatus == 401 || d.UpstreamStatus == 403 {
		d.Reason = "authorization-denied"
	}
	return &d
}

func logAppPlatformResult(logger log.Logger, namespace, resource, operation string, err error) {
	d := appPlatformDiagnostic(err, resource, operation)
	if d == nil || errors.Is(err, context.Canceled) || d.Reason == "cancelled" {
		return
	}
	if d.UpstreamStatus == 405 || d.UpstreamStatus == 501 || (d.UpstreamStatus == 404 && (resource == "pathfindersettings" || operation != "get")) || (d.UpstreamStatus == 409 && resource == "completionrecords" && operation == "create") {
		return
	}
	logger.Warn("Pathfinder proxy operation failed", "event", "pathfinder_proxy_failure", "stack_namespace", namespace, "resource", resource, "operation", operation, "stage", d.Stage, "reason", d.Reason, "upstream_status", d.UpstreamStatus)
}

func (a *App) writeProxyError(w http.ResponseWriter, message string, status int, d *guideProxyDiagnostic) {
	a.writeJSON(w, struct {
		Error       string                `json:"error"`
		Diagnostics *guideProxyDiagnostic `json:"diagnostics,omitempty"`
	}{message, d}, status)
}

func proxyGateDiagnostic(reason, resource, operation, stage string) *guideProxyDiagnostic {
	return &guideProxyDiagnostic{Outcome: "error", Stage: stage, Reason: reason, Resource: resource, Operation: operation}
}
