package plugin

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/config"

	"github.com/grafana/grafana-pathfinder-app/pkg/plugin/auth"
)

// Shared caller-identity helpers for App Platform proxy routes
// (docs/design/BACKEND_PROXY_PATTERN.md §3). Two layers: validIDToken for
// routes that only need an authenticated caller, subjectFromIDToken for
// per-user-data routes that additionally key on the caller's subject.
//
// Both CRYPTOGRAPHICALLY verify the forwarded Grafana ID token (X-Grafana-Id)
// against the stack's published JWKS, so neither relies on Grafana's
// server→plugin forwarding to keep the header honest — see "App Platform
// proxies — identity trust boundary" in docs/developer/CODA.md. The ID token
// stays an identity attestation, never an outbound credential: proxy routes
// exchange it for an access token (pkg/plugin/auth) and send that instead.
//
// Every failure yields a machine reason token for the capability envelope
// rather than a bare bool, so a signing-key outage (reasonIdentityUnverifiable)
// is distinguishable from an unauthenticated caller (reasonIdentityUnavailable)
// without backend log access.

// validIDToken reports whether the request carries a verified Grafana ID token,
// plus the reason it did not ("" on success). A verified token with no `sub` is
// accepted: namespace-global routes have no per-user need.
func (a *App) validIDToken(r *http.Request) (bool, string) {
	_, reason := a.verifyIDToken(r)
	return reason == "", reason
}

// subjectFromIDToken returns the request's verified ID-token `sub` claim
// VERBATIM, typed prefix included (e.g. "user:abc123"). Fail closed: absent,
// unverifiable, expired, and subject-less tokens all yield a reason.
func (a *App) subjectFromIDToken(r *http.Request) (string, string) {
	sub, reason := a.verifyIDToken(r)
	if reason != "" {
		return "", reason
	}
	if sub == "" {
		return "", reasonIdentityUnavailable
	}
	return sub, ""
}

// verifyIDToken verifies the inbound ID token and returns its `sub` claim.
func (a *App) verifyIDToken(r *http.Request) (string, string) {
	token := strings.TrimSpace(r.Header.Get(backend.GrafanaUserSignInTokenHeaderName))
	if token == "" {
		return "", reasonIdentityUnavailable
	}

	verifier, err := a.idTokenVerifier(r.Context())
	if err != nil {
		a.ctxLogger(r.Context()).Info("cannot verify caller id token", "error", err)
		return "", reasonIdentityUnverifiable
	}

	sub, err := verifier.Verify(r.Context(), token)
	switch {
	case err == nil:
		return sub, ""
	case auth.SigningKeysUnavailable(err):
		// Still fail closed, but Info-level and under a distinct reason: this is
		// an outage, not an unauthenticated caller.
		a.ctxLogger(r.Context()).Info("cannot verify caller id token", "error", err)
		return "", reasonIdentityUnverifiable
	default:
		a.ctxLogger(r.Context()).Debug("caller id token rejected", "error", err)
		return "", reasonIdentityUnavailable
	}
}

// idTokenVerifier returns this stack's ID-token verifier, building it on first
// use. The signing-keys URL derives from the per-request Grafana config, so the
// verifier cannot be built in NewApp; it is then held for the instance lifetime
// so authlib's key cache is shared across requests instead of refetched per
// call.
func (a *App) idTokenVerifier(ctx context.Context) (*auth.IDTokenVerifier, error) {
	cfg := config.GrafanaConfigFromContext(ctx)
	if cfg == nil {
		return nil, errors.New("no grafana config on request context")
	}
	appURL, err := cfg.AppURL()
	if err != nil {
		return nil, fmt.Errorf("resolving app URL: %w", err)
	}
	if appURL == "" {
		return nil, errors.New("grafana config carries no app URL")
	}

	a.idVerifierMu.Lock()
	defer a.idVerifierMu.Unlock()
	if a.idVerifier != nil && a.idVerifierAppURL == appURL {
		return a.idVerifier, nil
	}
	verifier, err := auth.NewIDTokenVerifier(appURL)
	if err != nil {
		return nil, err
	}
	a.idVerifier, a.idVerifierAppURL = verifier, appURL
	return verifier, nil
}
