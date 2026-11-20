package publiccontent

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/grafana/grafana-pathfinder-app/pkg/services"
	"net"
)

type guideProxyDiagnostic services.ProxyDiagnostic

type guideProxyError struct {
	diagnostic guideProxyDiagnostic
	err        error
}

func (e *guideProxyError) Error() string { return e.err.Error() }
func (e *guideProxyError) Unwrap() error { return e.err }

func classifyGuideProxyError(err error) guideProxyDiagnostic {
	diagnostic := guideProxyDiagnostic{Outcome: "error", Reason: "unexpected-error"}
	var typed *guideProxyError
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
