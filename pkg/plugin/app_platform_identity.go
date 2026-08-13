package plugin

import (
	"net/http"
	"strings"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/config"
)

// Shared caller-identity helpers for App Platform proxy routes
// (docs/design/BACKEND_PROXY_PATTERN.md §3). Two layers: validIDToken for
// routes that only need a verified caller, subjectFromIDToken for
// per-user-data routes that additionally key on the caller's subject.
//
// Trust boundary: the inbound X-Grafana-Id header can survive to the plugin
// on requests whose authenticated requester has no ID token of its own (see
// docs/developer/CODA.md), so it is verified locally — signature, type, and
// exp — against the issuing stack's own JWKS (pkg/plugin/auth.IdentityVerifier)
// before any of its claims are trusted. The ID token is an identity
// attestation, never an outbound credential: proxy routes exchange it for an
// access token (pkg/plugin/auth) and send that instead.

// validIDToken reports whether the request carries a Grafana ID token that
// verifies against this stack's own JWKS: well-formed JWT, correct signature,
// correct type, and `exp` present and unexpired.
func (a *App) validIDToken(r *http.Request) bool {
	_, ok := a.verifyIDToken(r)
	return ok
}

// subjectFromIDToken returns the request's verified ID-token `sub` claim
// VERBATIM, typed prefix included (e.g. "user:abc123"). Fail closed: absent,
// malformed, unverifiable, missing-exp, expired, or subject-less tokens yield
// ("", false).
func (a *App) subjectFromIDToken(r *http.Request) (string, bool) {
	sub, ok := a.verifyIDToken(r)
	if !ok || sub == "" {
		return "", false
	}
	return sub, true
}

// verifyIDToken verifies the request's ID token against this stack's own JWKS
// and returns its `sub` claim verbatim. Verification needs the stack's app
// URL to locate the JWKS endpoint, which is only resolvable from the
// request's plugin config — BACKEND_PROXY_PATTERN.md §4 requires identity
// validation to run before the rest of config resolution (feature toggles,
// namespace, OBO), so this resolves only the app URL it needs for itself,
// here, rather than promoting app-url resolution into a separate step ahead
// of the identity gate. An app URL that isn't yet resolvable fails closed the
// same way any other identity failure does.
func (a *App) verifyIDToken(r *http.Request) (string, bool) {
	token := strings.TrimSpace(r.Header.Get(backend.GrafanaUserSignInTokenHeaderName))
	if token == "" {
		return "", false
	}

	cfg := config.GrafanaConfigFromContext(r.Context())
	if cfg == nil {
		return "", false
	}
	appURL, err := cfg.AppURL()
	if err != nil || appURL == "" {
		return "", false
	}

	sub, err := a.identityVerifier.VerifySubject(r.Context(), appURL, token)
	if err != nil {
		return "", false
	}
	return sub, true
}
