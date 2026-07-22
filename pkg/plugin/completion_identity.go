package plugin

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"
)

// grafanaIDTokenHeader carries the Grafana-forwarded ID token (a signed JWT)
// on requests that reach the plugin backend. It is present only when the stack
// has idForwarding enabled (standard on Grafana Cloud).
const grafanaIDTokenHeader = "X-Grafana-Id"

// deriveCompletionUserID is the canonical identity contract for the whole
// Completion Records epic. It derives the caller's durable user identifier
// from the Grafana-forwarded ID token's `sub` claim and returns it VERBATIM,
// typed prefix included (e.g. "user:abc123").
//
// The epic's core invariant is that reads and writes join on the same key:
// epic PR 4 (the write hook) MUST stamp `spec.userId` using this exact helper
// so a record written under identity X is later read back under identity X.
// Do not introduce a second derivation path — reuse this one.
//
// Fail closed: if the ID token is absent, malformed, or expired, this returns
// ("", false). Callers MUST then report capability=false rather than guessing
// an identity. There is deliberately NO fallback to X-Grafana-User (a mutable
// login — a rename would split a user's history) and NO fallback to the
// numeric stack-local user ID.
//
// Trust boundary: the token arrives over Grafana's trusted server→plugin gRPC
// plumbing, so this performs structural validation (well-formed JWT, present
// non-empty `sub`, unexpired) and treats the subject as authoritative.
// Cryptographic signature verification against Grafana's JWKS (via
// github.com/grafana/authlib) is a documented future hardening; it is not
// wired here because it needs runtime key-endpoint config outside this PR's
// unit-test surface.
func deriveCompletionUserID(r *http.Request) (string, bool) {
	return subjectFromIDToken(r.Header.Get(grafanaIDTokenHeader))
}

// subjectFromIDToken parses a JWT and returns its `sub` claim verbatim.
// Returns ("", false) for any structural problem, an empty subject, or an
// expired token (fail closed).
func subjectFromIDToken(token string) (string, bool) {
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
	if claims.Sub == "" {
		return "", false
	}
	if claims.Exp != 0 && timeNow().Unix() >= claims.Exp {
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
