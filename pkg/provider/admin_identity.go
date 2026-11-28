package provider

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"strings"

	authlib "github.com/grafana/authlib/types"
)

type roleClaims struct {
	Subject   string      `json:"sub"`
	Namespace string      `json:"namespace"`
	Role      string      `json:"role"`
	Name      string      `json:"name"`
	Actor     *roleClaims `json:"act"`
}

func callerClaims(ctx context.Context, namespace string) (roleClaims, bool) {
	identity, ok := authlib.AuthInfoFrom(ctx)
	if !ok || namespace == "" || namespace == "*" || identity.GetNamespace() != namespace || identity.GetSubject() == "" {
		return roleClaims{}, false
	}
	token := identity.GetIDToken()
	delegated := false
	if token == "" {
		token = identity.GetAccessToken()
		delegated = true
	}
	// Authlib verified these context tokens; request headers are never a role source.
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return roleClaims{}, false
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return roleClaims{}, false
	}
	var claims roleClaims
	if json.Unmarshal(payload, &claims) != nil || claims.Namespace != namespace {
		return roleClaims{}, false
	}
	if delegated {
		for claims.Actor != nil {
			claims = *claims.Actor
		}
	}
	if claims.Subject != identity.GetSubject() {
		return roleClaims{}, false
	}
	return claims, true
}

func callerIsAdmin(ctx context.Context, namespace string) bool {
	claims, ok := callerClaims(ctx, namespace)
	return ok && claims.Role == "Admin"
}
