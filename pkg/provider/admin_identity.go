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
	Actor     *roleClaims `json:"act"`
}

func callerIsAdmin(ctx context.Context, namespace string) bool {
	identity, ok := authlib.AuthInfoFrom(ctx)
	if !ok || namespace == "" || namespace == "*" || identity.GetNamespace() != namespace || identity.GetSubject() == "" {
		return false
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
		return false
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return false
	}
	var claims roleClaims
	if json.Unmarshal(payload, &claims) != nil || claims.Namespace != namespace {
		return false
	}
	if delegated {
		for claims.Actor != nil {
			claims = *claims.Actor
		}
	}
	return claims.Subject == identity.GetSubject() && claims.Role == "Admin"
}
