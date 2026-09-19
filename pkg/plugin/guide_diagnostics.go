package plugin

import (
	"context"
	"encoding/json"
	"errors"
	"net"
)

type guideProxyDiagnostic struct {
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
