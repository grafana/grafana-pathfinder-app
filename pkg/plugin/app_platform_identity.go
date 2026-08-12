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
// server→plugin forwarding to keep the header honest — see "The identity trust
// boundary" in docs/design/BACKEND_PROXY_PATTERN.md §3. The ID token
// stays an identity attestation, never an outbound credential: proxy routes
// exchange it for an access token (pkg/plugin/auth) and send that instead.
//
// Every failure yields an identityStatus rather than a bare bool, so all three
// proxy routes make one shared decision about how each distinct failure is
// served and cannot drift apart.

// identityStatus is the verdict of the identity gate. Three distinct failures,
// because BACKEND_PROXY_PATTERN.md §7's transient/structural split cuts across
// them: only one of the three is retryable, and reporting a retryable outage as
// a standing condition darkens the surface past the end of the outage.
type identityStatus int

const (
	// identityVerified: the caller carries a cryptographically verified token.
	identityVerified identityStatus = iota

	// identityRejected: no token at all, or one this stack will not accept —
	// forged signature, unknown `kid`, wrong `typ`, expired, or no `exp`.
	identityRejected

	// identityUnverifiable: no signing-keys URL is resolvable on this stack (no
	// Grafana config on the request, or a config carrying no app URL), so
	// verification can never succeed here.
	identityUnverifiable

	// identitySigningKeysDown: the signing-keys URL resolved but the fetch
	// failed. Retryable, so routes serve §7's 503 + Retry-After — a capability
	// envelope would read as "never works here" for the whole client cache TTL.
	identitySigningKeysDown
)

// capabilityReason is the envelope token for a status served as a soft 200.
// identitySigningKeysDown has none: it takes each route's transient path.
func (s identityStatus) capabilityReason() string {
	switch s {
	case identityRejected:
		return reasonIdentityUnavailable
	case identityUnverifiable:
		return reasonIdentityUnverifiable
	default:
		return ""
	}
}

// validIDToken reports whether the request carries a verified Grafana ID token.
// A verified token with no `sub` is accepted: namespace-global routes have no
// per-user need.
func (a *App) validIDToken(r *http.Request) identityStatus {
	_, status := a.verifyIDToken(r)
	return status
}

// subjectFromIDToken returns the request's verified ID-token `sub` claim
// VERBATIM, typed prefix included (e.g. "user:abc123"). Fail closed: absent,
// unverifiable, expired, and subject-less tokens all yield a failing status.
func (a *App) subjectFromIDToken(r *http.Request) (string, identityStatus) {
	sub, status := a.verifyIDToken(r)
	if status != identityVerified {
		return "", status
	}
	if sub == "" {
		return "", identityRejected
	}
	return sub, identityVerified
}

// verifyIDToken verifies the inbound ID token and returns its `sub` claim.
func (a *App) verifyIDToken(r *http.Request) (string, identityStatus) {
	token := strings.TrimSpace(r.Header.Get(backend.GrafanaUserSignInTokenHeaderName))
	if token == "" {
		return "", identityRejected
	}

	verifier, err := a.idTokenVerifier(r.Context())
	if err != nil {
		a.ctxLogger(r.Context()).Info("cannot verify caller id token", "error", err)
		return "", identityUnverifiable
	}

	sub, err := verifier.Verify(r.Context(), token)
	switch {
	case err == nil:
		return sub, identityVerified
	case auth.SigningKeysUnavailable(err):
		a.ctxLogger(r.Context()).Info("cannot fetch signing keys to verify caller id token", "error", err)
		return "", identitySigningKeysDown
	default:
		// Info, not Debug: this branch is only reachable when a token was present
		// and unacceptable, which is exactly the attack #1568 closed, so it must
		// be observable without raising the log level.
		a.ctxLogger(r.Context()).Info("caller id token rejected", "error", err)
		return "", identityRejected
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
