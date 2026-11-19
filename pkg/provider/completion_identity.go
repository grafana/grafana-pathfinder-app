package provider

import (
	"context"
	"errors"
	"net/http"

	authlib "github.com/grafana/authlib/types"
)

type completionWriterIdentity struct {
	Subject     string
	Login       string
	DisplayName string
	Namespace   string
	OrgID       int64
}

var errMissingAuthentication = errors.New("unauthenticated")

func completionCallerFailure(err error) (int, string) {
	if errors.Is(err, errMissingAuthentication) {
		return http.StatusUnauthorized, "unauthenticated"
	}
	return http.StatusForbidden, "identity-unavailable"
}

func completionCaller(ctx context.Context, routeNamespace string) (completionWriterIdentity, error) {
	identity, ok := authlib.AuthInfoFrom(ctx)
	if !ok || identity == nil {
		return completionWriterIdentity{}, errMissingAuthentication
	}
	namespace, err := callerNamespace(ctx, routeNamespace)
	if err != nil {
		return completionWriterIdentity{}, err
	}
	if identity.GetSubject() == "" {
		return completionWriterIdentity{}, errUnboundCaller
	}
	info, err := authlib.ParseNamespace(namespace)
	if err != nil || info.OrgID < 1 {
		return completionWriterIdentity{}, errors.New("organization-unavailable")
	}
	claims, _ := callerClaims(ctx, namespace)
	return completionWriterIdentity{Subject: identity.GetSubject(), Login: identity.GetUsername(), DisplayName: claims.Name, Namespace: namespace, OrgID: info.OrgID}, nil
}
