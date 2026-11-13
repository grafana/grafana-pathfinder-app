package provider

import (
	"context"
	"encoding/json"
	"errors"
	"net"

	"github.com/grafana/grafana-pathfinder-app/pkg/resourceaccess"
	"github.com/grafana/grafana-pathfinder-app/pkg/services"
)

func upstreamDiagnostic(err error, resourceName, operation string) *services.ProxyDiagnostic {
	if err == nil {
		return nil
	}
	result := &services.ProxyDiagnostic{Stage: "app-platform", Resource: resourceName, Operation: operation, Outcome: "error", Reason: "unexpected-error"}
	var syntax *json.SyntaxError
	var shape *json.UnmarshalTypeError
	var network net.Error
	var validation *resourceaccess.ResponseValidationError
	switch {
	case errors.As(err, &validation):
		result.Reason = validation.Reason
		result.UpstreamStatus = validation.Status
	case errors.Is(err, context.DeadlineExceeded):
		result.Reason = "timeout"
	case errors.Is(err, context.Canceled):
		result.Reason = "cancelled"
	case errors.As(err, &syntax), errors.As(err, &shape):
		result.Reason = "invalid-json"
	case errors.As(err, &network):
		result.Reason = "network-error"
		if network.Timeout() {
			result.Reason = "timeout"
		}
	default:
		result.UpstreamStatus = sdkErrorStatus(err)
		if result.UpstreamStatus != 0 {
			result.Reason = "http-error"
		}
		if result.UpstreamStatus == 401 {
			result.Reason = "authentication-failed"
		}
		if result.UpstreamStatus == 403 {
			result.Reason = "authorization-denied"
		}
	}
	return result
}
