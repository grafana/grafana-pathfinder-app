// Package auth mints short-lived, user-scoped access tokens for the App
// Platform proxy routes, so the plugin backend can call its own stack's
// aggregated API as the calling user rather than forwarding an ID token that
// nothing downstream accepts as a credential.
//
// Mirrors grafana-dbo11y-app's pkg/plugin/auth, which runs this flow in
// production: exchange the inbound Grafana ID token for a real access token
// using the plugin's provisioned Cloud Access Policy token, then send it as
// X-Access-Token. Grafana's front door authenticates that (ExtendedJWT), and
// the instance's embedded aggregator signs the onward hop to GAP itself.
package auth

import (
	"context"
	"errors"
	"fmt"

	"github.com/grafana/authlib/authn"
)

const (
	// DefaultTokenExchangeURL is auth-api's in-cluster token-exchange endpoint.
	// The address resolves per-cell, so the same value is correct in every
	// region.
	DefaultTokenExchangeURL = "http://api-lb.auth.svc.cluster.local./v1/sign-access-token"

	// AccessTokenHeader is the header Grafana reads the minted on-behalf-of
	// access token from (authlib's authenticator contract). The minted token is
	// a complete on-behalf-of token — it carries the user's identity in its
	// actor (act) claim — so no separate identity header is sent with it.
	AccessTokenHeader = "X-Access-Token"

	// tokenTTLSeconds is the lifetime requested for minted access tokens.
	// auth-api caps this at 600s; authlib caches minted tokens until shortly
	// before they expire, keyed (among other things) by the subject, so the
	// exchange runs at most once per user per TTL window.
	tokenTTLSeconds = 600
)

// Exchanger mints short-lived, user-scoped access tokens from the plugin's
// long-lived CAP token. It is safe for concurrent use and is built once per
// plugin instance so authlib's internal token cache is shared across requests.
type Exchanger struct {
	client  authn.TokenExchanger
	stackID string
}

// New builds an Exchanger from the plugin's provisioned credentials: the raw
// CAP token (from decrypted secure settings) and the stack ID (from jsonData),
// both written by stack-state-service.
//
// It returns (nil, nil) when no token is provisioned — local development, or a
// stack that predates provisioning — so the caller can degrade instead of
// failing to load. It returns an error when a token is present but the stack ID
// is missing.
func New(token, stackID, tokenExchangeURL string) (*Exchanger, error) {
	if token == "" {
		return nil, nil
	}
	if stackID == "" {
		return nil, errors.New("on-behalf-of token provisioned without a stack ID")
	}

	client, err := authn.NewTokenExchangeClient(authn.TokenExchangeConfig{
		Token:            token,
		TokenExchangeURL: tokenExchangeURL,
	})
	if err != nil {
		return nil, fmt.Errorf("building token exchange client: %w", err)
	}

	return &Exchanger{client: client, stackID: stackID}, nil
}

// Mint exchanges the CAP token for a short-lived access token scoped to the
// user identified by idToken. The audience is the stack's own front door, which
// is where the proxy routes send it; the aggregator re-signs from there.
func (e *Exchanger) Mint(ctx context.Context, idToken string) (string, error) {
	if idToken == "" {
		return "", errors.New("cannot mint an access token without a caller id token")
	}
	ttl := tokenTTLSeconds
	resp, err := e.client.Exchange(ctx, authn.TokenExchangeRequest{
		Namespace:    "stacks-" + e.stackID,
		Audiences:    []string{"grafana"},
		SubjectToken: idToken,
		ExpiresIn:    &ttl,
	})
	if err != nil {
		return "", err
	}
	return resp.Token, nil
}
