package plugin

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/config"

	"github.com/grafana/grafana-pathfinder-app/pkg/plugin/auth"
)

const idTokenVerifierMaxAge = 5 * time.Minute

// Shared caller-identity helpers for App Platform proxy routes. Two layers:
// validIDToken for routes that only need an authenticated caller,
// subjectFromIDToken for per-user-data routes that additionally key on the
// caller's subject. Both cryptographically verify the forwarded Grafana ID token
// (X-Grafana-Id) against the stack's published JWKS — see "The identity trust
// boundary" in docs/design/BACKEND_PROXY_PATTERN.md §3.

// identityStatus is the verdict of the identity gate. Three distinct failures,
// because BACKEND_PROXY_PATTERN.md §7's transient/structural split cuts across
// them: only one of the three is retryable, and reporting a retryable outage as
// a standing condition darkens the surface past the end of the outage.
type identityStatus int

const (
	// identityUnknown is the zero value, so a status left unset can never be
	// mistaken for a verified caller.
	identityUnknown identityStatus = iota

	// identityVerified: the caller carries a cryptographically verified token.
	identityVerified

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
// identitySigningKeysDown has none: it takes each route's transient path. An
// unrecognized status reports the generic identity failure rather than an empty
// reason, since every status but identityVerified is served with no data.
func (s identityStatus) capabilityReason() string {
	switch s {
	case identityVerified, identitySigningKeysDown:
		return ""
	case identityUnverifiable:
		return reasonIdentityUnverifiable
	default:
		return reasonIdentityUnavailable
	}
}

// completionWriterIdentity derives the server-stamped identity for a completion
// write from the caller's forwarded Grafana context. The stable user id is
// REQUIRED and fails closed; it comes from deriveCompletionUserID — the
// canonical identity contract — rather than from subjectFromIDToken directly,
// so the read and write paths cannot drift apart on the key they join on.
//
// Login and display name are best-effort denormalized snapshots read ONLY from
// the verified ID token's `username`/`name` claims (authlib IDTokenClaims).
// There is deliberately no fallback: an absent claim leaves the field empty
// rather than substituting a value from anywhere else. A plausible-but-unverified
// login is worse than an absent one because it reads as verified, and these
// records are headed for compliance-grade use — absence is auditable, a forgery
// is not. The record's identity of record is `userId`, which the read path joins
// on exclusively; these two are display convenience.
//
// Every value here comes from the INBOUND request. The outbound on-behalf-of
// access token is a credential, not the source of the stamped subject — moving
// identity onto it would silently change what gets attributed
// (TestCompletionWrite_SubjectComesFromInboundIDToken pins this).
func (a *App) completionWriterIdentity(r *http.Request) (userID, userLogin, userDisplayName string, status identityStatus) {
	userID, status = a.deriveCompletionUserID(r)
	if status != identityVerified {
		return "", "", "", status
	}
	userLogin, userDisplayName = idTokenProfile(r.Header.Get(backend.GrafanaUserSignInTokenHeaderName))
	return userID, userLogin, userDisplayName, identityVerified
}

// idTokenProfile best-effort reads the login and display-name claims from a
// forwarded ID token. It runs only after the token has been cryptographically
// verified, so re-decoding the payload here reads already-trusted bytes. The
// claim names are pinned to Grafana authlib's IDTokenClaims
// (authn/verifier_id_token.go): login is `username`, display name is `name` —
// NOT `login` or `preferred_username`, which Grafana does not emit and which
// silently yielded empty snapshots. It gates nothing (the subject already did)
// and returns ("", "") on any decode failure — the fields are denormalized
// snapshots, not authorization inputs.
func idTokenProfile(token string) (login, name string) {
	token = strings.TrimSpace(token)
	if token == "" {
		return "", ""
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return "", ""
	}
	payload, err := decodeJWTSegment(parts[1])
	if err != nil {
		return "", ""
	}
	var claims struct {
		Username string `json:"username"`
		Name     string `json:"name"`
	}
	if err := json.Unmarshal(payload, &claims); err != nil {
		return "", ""
	}
	return claims.Username, claims.Name
}

// decodeJWTSegment decodes a base64url JWT segment, tolerating both the
// unpadded (RFC 7515) and padded encodings.
func decodeJWTSegment(seg string) ([]byte, error) {
	if b, err := base64.RawURLEncoding.DecodeString(seg); err == nil {
		return b, nil
	}
	return base64.URLEncoding.DecodeString(seg)
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
		// and unacceptable, so it must be observable without raising the log level.
		a.ctxLogger(r.Context()).Info("caller id token rejected", "error", err)
		return "", identityRejected
	}
}

// idTokenVerifier returns this stack's ID-token verifier, building it on first
// use. The signing-keys URL derives from the per-request Grafana config, so the
// verifier cannot be built in NewApp. It is reused briefly so authlib's key
// cache is shared across requests, then rebuilt to bound how long a key removed
// from the live JWKS remains trusted.
func (a *App) idTokenVerifier(ctx context.Context) (*auth.IDTokenVerifier, error) {
	appURL, err := config.GrafanaConfigFromContext(ctx).AppURL()
	if err != nil {
		return nil, fmt.Errorf("resolving app URL: %w", err)
	}
	if appURL == "" {
		return nil, errors.New("grafana config carries no app URL")
	}

	a.idVerifierMu.Lock()
	defer a.idVerifierMu.Unlock()
	now := timeNow()
	if a.idVerifier != nil && a.idVerifierAppURL == appURL &&
		now.Before(a.idVerifierCreatedAt.Add(idTokenVerifierMaxAge)) {
		return a.idVerifier, nil
	}
	verifier, err := auth.NewIDTokenVerifier(appURL)
	if err != nil {
		return nil, err
	}
	a.idVerifier = verifier
	a.idVerifierAppURL = appURL
	a.idVerifierCreatedAt = now
	return verifier, nil
}
