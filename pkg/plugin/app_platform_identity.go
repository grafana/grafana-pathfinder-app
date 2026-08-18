package plugin

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
)

// Shared caller-identity helpers for App Platform proxy routes
// (docs/design/BACKEND_PROXY_PATTERN.md §3). Two layers: validIDToken for
// routes that only need a structurally valid caller, subjectFromIDToken for
// per-user-data routes that additionally key on the caller's subject.
//
// Trust boundary: structural (non-signature) validation is defensible only
// because requests reach the plugin exclusively via Grafana's trusted
// server→plugin forwarding — see "App Platform proxies — identity trust
// boundary" in docs/developer/CODA.md. The ID token is an identity
// attestation, never an outbound credential: proxy routes exchange it for an
// access token (pkg/plugin/auth) and send that instead.

// validIDToken reports whether the request carries a structurally valid
// Grafana ID token: well-formed JWT with `exp` present and unexpired.
func validIDToken(r *http.Request) bool {
	_, ok := parseIDToken(r.Header.Get(backend.GrafanaUserSignInTokenHeaderName))
	return ok
}

// subjectFromIDToken returns the request's ID-token `sub` claim VERBATIM,
// typed prefix included (e.g. "user:abc123"). Fail closed: absent, malformed,
// missing-exp, expired, or subject-less tokens yield ("", false).
func subjectFromIDToken(r *http.Request) (string, bool) {
	sub, ok := parseIDToken(r.Header.Get(backend.GrafanaUserSignInTokenHeaderName))
	if !ok || sub == "" {
		return "", false
	}
	return sub, true
}

// completionWriterIdentity derives the server-stamped identity for a completion
// write from the caller's forwarded Grafana context. The stable user id (the
// ID-token `sub`) is REQUIRED and fails closed. Login and display name are
// best-effort denormalized snapshots read ONLY from the signed ID token's
// `username`/`name` claims (authlib IDTokenClaims). There is deliberately no
// fallback: an absent claim leaves the field empty rather than substituting a
// value from anywhere else. A plausible-but-unverified login is worse than an
// absent one because it reads as verified, and these records are headed for
// compliance-grade use — absence is auditable, a forgery is not. The record's
// identity of record is `userId`, which the read path joins on exclusively;
// these two are display convenience.
//
// Every value here comes from the INBOUND request. The outbound on-behalf-of
// access token is a credential, not the source of the stamped subject — moving
// identity onto it would silently change what gets attributed
// (TestCompletionWrite_SubjectComesFromInboundIDToken pins this).
func completionWriterIdentity(r *http.Request) (userID, userLogin, userDisplayName string, ok bool) {
	userID, ok = subjectFromIDToken(r)
	if !ok {
		return "", "", "", false
	}
	userLogin, userDisplayName = idTokenProfile(r.Header.Get(backend.GrafanaUserSignInTokenHeaderName))
	return userID, userLogin, userDisplayName, true
}

// idTokenProfile best-effort reads the login and display-name claims from a
// forwarded ID token. The claim names are pinned to Grafana authlib's
// IDTokenClaims (authn/verifier_id_token.go): login is `username`, display name
// is `name` — NOT `login` or `preferred_username`, which Grafana does not emit
// and which silently yielded empty snapshots. It gates nothing (the subject
// already did) and returns ("", "") on any decode failure — the fields are
// denormalized snapshots, not authorization inputs.
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

// parseIDToken structurally validates a JWT and returns its `sub` claim.
// A forwarded Grafana ID token always carries `exp`, so a missing (or zero)
// `exp` is rejected rather than treated as non-expiring.
func parseIDToken(token string) (string, bool) {
	token = strings.TrimSpace(token)
	if token == "" {
		return "", false
	}

	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return "", false
	}

	payload, err := decodeJWTSegment(parts[1])
	if err != nil {
		return "", false
	}

	var claims struct {
		Sub string `json:"sub"`
		Exp int64  `json:"exp"`
	}
	if err := json.Unmarshal(payload, &claims); err != nil {
		return "", false
	}
	if claims.Exp == 0 || timeNow().Unix() >= claims.Exp {
		return "", false
	}

	return claims.Sub, true
}

// decodeJWTSegment decodes a base64url JWT segment, tolerating both the
// unpadded (RFC 7515) and padded encodings.
func decodeJWTSegment(seg string) ([]byte, error) {
	if b, err := base64.RawURLEncoding.DecodeString(seg); err == nil {
		return b, nil
	}
	return base64.URLEncoding.DecodeString(seg)
}
