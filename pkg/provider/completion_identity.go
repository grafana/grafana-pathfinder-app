package provider

import (
	"context"
	"errors"

	authlib "github.com/grafana/authlib/types"
)

type completionWriterIdentity struct {
	Subject     string
	Login       string
	DisplayName string
	Namespace   string
	OrgID       int64
}

func completionCaller(ctx context.Context, routeNamespace string) (completionWriterIdentity, error) {
	namespace, err := callerNamespace(ctx, routeNamespace)
	if err != nil {
		return completionWriterIdentity{}, err
	}
	identity, ok := authlib.AuthInfoFrom(ctx)
	if !ok || identity.GetSubject() == "" {
		return completionWriterIdentity{}, errUnboundCaller
	}
	info, err := authlib.ParseNamespace(namespace)
	if err != nil || info.OrgID < 1 {
		return completionWriterIdentity{}, errors.New("organization-unavailable")
	}
	return completionWriterIdentity{Subject: identity.GetSubject(), Login: identity.GetUsername(), DisplayName: identity.GetName(), Namespace: namespace, OrgID: info.OrgID}, nil
}
