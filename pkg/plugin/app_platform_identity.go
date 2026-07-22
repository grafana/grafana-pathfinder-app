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
// boundary" in docs/developer/CODA.md.

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

// forwardIdentityHeaders stamps the outbound identity for plugin→aggregator
// calls: `Authorization: Bearer <id-token>` plus the ID-token header, both
// synthesized from the caller's inbound ID token. This is the runtime-verified
// shape (dev-stack smoke, commit 89d6bd5e on feat/external-import-api).
// Never forward Cookie, and never replay the inbound Authorization header —
// Grafana strips it before plugin resource handlers.
func forwardIdentityHeaders(dst http.Header, idToken string) {
	dst.Set("Authorization", "Bearer "+idToken)
	dst.Set(backend.GrafanaUserSignInTokenHeaderName, idToken)
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
