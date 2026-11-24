package provider

import (
	"context"
	"errors"

	authlib "github.com/grafana/authlib/types"
)

var errUnboundCaller = errors.New("identity-unavailable")

func callerNamespace(ctx context.Context, routeNamespace string) (string, error) {
	identity, ok := authlib.AuthInfoFrom(ctx)
	if !ok || identity == nil || routeNamespace == "" || routeNamespace == "*" {
		return "", errUnboundCaller
	}
	if identity.GetNamespace() != routeNamespace {
		return "", errUnboundCaller
	}
	return routeNamespace, nil
}
