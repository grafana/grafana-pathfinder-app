package plugin

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	sdkconfig "github.com/grafana/grafana-plugin-sdk-go/config"

	"github.com/grafana/grafana-pathfinder-app/pkg/plugin/auth"
)

// --- ID-token signing fixtures -----------------------------------------------
//
// The proxies verify inbound ID tokens against the stack's published JWKS, so
// these tests sign real ES256 tokens and serve the matching public key from a
// local JWKS endpoint. Nothing is stubbed between the handler and authlib: a
// test that accepts a token accepts it for the same reason production would.
//
// Token validity therefore runs on wall-clock time, not the timeNow seam
// (authlib calls time.Now() internally). Tests wanting "a valid identity" use
// makeValidIDToken; withFrozenTime still governs everything else.

const testSigningKeyID = "pathfinder-test-key"

// testSigningKey is the ES256 key the test JWKS endpoints publish and
// signIDToken signs with, generated once per test binary.
var testSigningKey = sync.OnceValue(func() *ecdsa.PrivateKey {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		panic(fmt.Sprintf("generate test signing key: %v", err))
	}
	return key
})

// testSigningKeysURL is the app URL for a healthy stack: an origin whose
// /api/signing-keys/keys publishes testSigningKey. Package-scoped because
// testGrafanaConfig takes no *testing.T; the server lives for the test binary.
var testSigningKeysURL = sync.OnceValue(func() string {
	server, _ := startJWKSServer(nil)
	return server.URL
})

// startJWKSServer serves testSigningKey's public half as a JWKS at
// auth.SigningKeysPath, and counts key-set fetches so tests can prove the
// verifier caches. A nil *testing.T leaks the server deliberately (see
// testSigningKeysURL); otherwise it is closed on cleanup.
func startJWKSServer(t *testing.T) (*httptest.Server, *atomic.Int32) {
	var fetches atomic.Int32

	// SEC 1 uncompressed point: 0x04 ‖ X(32) ‖ Y(32) for P-256.
	point, err := testSigningKey().PublicKey.Bytes()
	if err != nil {
		panic(fmt.Sprintf("encode test public key: %v", err))
	}
	body, err := json.Marshal(map[string]any{"keys": []map[string]string{{
		"kty": "EC",
		"crv": "P-256",
		"alg": "ES256",
		"use": "sig",
		"kid": testSigningKeyID,
		"x":   base64.RawURLEncoding.EncodeToString(point[1:33]),
		"y":   base64.RawURLEncoding.EncodeToString(point[33:]),
	}}})
	if err != nil {
		panic(fmt.Sprintf("marshal test JWKS: %v", err))
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != auth.SigningKeysPath {
			http.NotFound(w, r)
			return
		}
		fetches.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(body)
	}))
	if t != nil {
		t.Cleanup(server.Close)
	}
	return server, &fetches
}

// idToken describes a token to sign. The zero value is invalid on purpose:
// every field a real Grafana ID token carries must be set explicitly, so a test
// asserting rejection cannot pass by accidentally omitting something else.
type idToken struct {
	sub string
	exp int64 // 0 omits the claim
	kid string
	typ string
	key *ecdsa.PrivateKey
}

// signIDToken builds and ES256-signs a JWT to spec.
func signIDToken(t *testing.T, tok idToken) string {
	t.Helper()

	header, err := json.Marshal(map[string]string{"alg": "ES256", "typ": tok.typ, "kid": tok.kid})
	if err != nil {
		t.Fatalf("marshal header: %v", err)
	}
	claims := map[string]any{}
	if tok.sub != "" {
		claims["sub"] = tok.sub
	}
	if tok.exp != 0 {
		claims["exp"] = tok.exp
	}
	payload, err := json.Marshal(claims)
	if err != nil {
		t.Fatalf("marshal claims: %v", err)
	}

	signingInput := base64.RawURLEncoding.EncodeToString(header) + "." + base64.RawURLEncoding.EncodeToString(payload)
	digest := sha256.Sum256([]byte(signingInput))
	r, s, err := ecdsa.Sign(rand.Reader, tok.key, digest[:])
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	// JWS ES256 signatures are the fixed-width R‖S pair, not the ASN.1 encoding
	// ecdsa.SignASN1 produces.
	sig := append(r.FillBytes(make([]byte, 32)), s.FillBytes(make([]byte, 32))...)
	return signingInput + "." + base64.RawURLEncoding.EncodeToString(sig)
}

// makeIDToken signs a well-formed ID token with the given subject and `exp`
// (exp == 0 omits the claim). Both may be invalid — that is the point.
func makeIDToken(t *testing.T, sub string, exp int64) string {
	t.Helper()
	return signIDToken(t, idToken{sub: sub, exp: exp, kid: testSigningKeyID, typ: "jwt", key: testSigningKey()})
}

// makeValidIDToken signs a token that verifies against the test JWKS right now.
// Its `exp` is wall-clock-relative, so it is unaffected by withFrozenTime.
func makeValidIDToken(t *testing.T, sub string) string {
	t.Helper()
	return makeIDToken(t, sub, time.Now().Add(time.Hour).Unix())
}

// identityRequest builds a bare request carrying the given ID-token header and
// a healthy Grafana config (app URL pointing at the test JWKS endpoint).
func identityRequest(t *testing.T, token string) *http.Request {
	t.Helper()
	return identityRequestWithConfig(t, token, testGrafanaConfig())
}

func identityRequestWithConfig(t *testing.T, token string, cfg map[string]string) *http.Request {
	t.Helper()
	r, _ := http.NewRequest(http.MethodGet, "/", nil)
	if token != "" {
		r.Header.Set(backend.GrafanaUserSignInTokenHeaderName, token)
	}
	if cfg == nil {
		return r
	}
	return r.WithContext(sdkconfig.WithGrafanaConfig(r.Context(), sdkconfig.NewGrafanaCfg(cfg)))
}

// --- Verification matrix -----------------------------------------------------

func TestDeriveCompletionUserID(t *testing.T) {
	foreignKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate foreign key: %v", err)
	}
	validExp := time.Now().Add(time.Hour).Unix()

	tests := []struct {
		name       string
		token      string
		wantID     string
		wantReason string
	}{
		{
			name:   "verified token yields verbatim typed subject",
			token:  makeValidIDToken(t, "user:abc123"),
			wantID: "user:abc123",
		},
		{
			name:   "typed prefix preserved verbatim",
			token:  makeValidIDToken(t, "service-account:xyz"),
			wantID: "service-account:xyz",
		},
		{
			name:       "absent header fails closed",
			token:      "",
			wantReason: reasonIdentityUnavailable,
		},
		{
			name:       "malformed (not three segments) fails closed",
			token:      "not-a-jwt",
			wantReason: reasonIdentityUnavailable,
		},
		{
			name:       "empty subject fails closed",
			token:      makeValidIDToken(t, ""),
			wantReason: reasonIdentityUnavailable,
		},
		{
			name:       "expired token fails closed",
			token:      makeIDToken(t, "user:abc123", time.Now().Add(-time.Hour).Unix()),
			wantReason: reasonIdentityUnavailable,
		},
		{
			name:       "missing exp claim fails closed",
			token:      makeIDToken(t, "user:abc123", 0),
			wantReason: reasonIdentityUnavailable,
		},
		{
			// The whole point of #1568: a client-forged header naming any subject
			// is worthless without the stack's signing key.
			name:       "signature from a foreign key fails closed",
			token:      signIDToken(t, idToken{sub: "user:victim", exp: validExp, kid: testSigningKeyID, typ: "jwt", key: foreignKey}),
			wantReason: reasonIdentityUnavailable,
		},
		{
			name:       "unrecognized kid fails closed",
			token:      signIDToken(t, idToken{sub: "user:abc123", exp: validExp, kid: "not-a-real-key", typ: "jwt", key: testSigningKey()}),
			wantReason: reasonIdentityUnavailable,
		},
		{
			name:       "missing kid fails closed",
			token:      signIDToken(t, idToken{sub: "user:abc123", exp: validExp, typ: "jwt", key: testSigningKey()}),
			wantReason: reasonIdentityUnavailable,
		},
		{
			// An access token is signed by the same keys but is not an identity
			// attestation; type confusion must not authenticate a caller.
			name:       "access-token type fails closed",
			token:      signIDToken(t, idToken{sub: "user:abc123", exp: validExp, kid: testSigningKeyID, typ: "at+jwt", key: testSigningKey()}),
			wantReason: reasonIdentityUnavailable,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			id, reason := newTestApp(t).deriveCompletionUserID(identityRequest(t, tt.token))
			if reason != tt.wantReason {
				t.Fatalf("reason = %q, want %q", reason, tt.wantReason)
			}
			if id != tt.wantID {
				t.Fatalf("id = %q, want %q", id, tt.wantID)
			}
		})
	}
}

// TestDeriveCompletionUserID_NoLoginFallback proves the fail-closed contract:
// a present X-Grafana-User login does NOT rescue a missing/invalid ID token.
func TestDeriveCompletionUserID_NoLoginFallback(t *testing.T) {
	r := identityRequest(t, "garbage")
	r.Header.Set("X-Grafana-User", "admin")
	if id, reason := newTestApp(t).deriveCompletionUserID(r); reason == "" {
		t.Fatalf("expected fail-closed, got id=%q reason=%q", id, reason)
	}
}

// validIDToken is the layer for routes with no per-user need: same verification
// discipline, but a verified token needs no subject to authorize the caller.
func TestValidIDToken(t *testing.T) {
	cases := []struct {
		name       string
		token      string
		want       bool
		wantReason string
	}{
		{name: "verified token", token: makeValidIDToken(t, "user:1"), want: true},
		{name: "no subject still authorizes", token: makeValidIDToken(t, ""), want: true},
		{name: "missing exp rejected", token: makeIDToken(t, "user:1", 0), wantReason: reasonIdentityUnavailable},
		{name: "expired rejected", token: makeIDToken(t, "user:1", time.Now().Add(-time.Hour).Unix()), wantReason: reasonIdentityUnavailable},
		{name: "absent rejected", token: "", wantReason: reasonIdentityUnavailable},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			ok, reason := newTestApp(t).validIDToken(identityRequest(t, tt.token))
			if ok != tt.want {
				t.Fatalf("validIDToken = %v, want %v (reason %q)", ok, tt.want, reason)
			}
			if reason != tt.wantReason {
				t.Fatalf("reason = %q, want %q", reason, tt.wantReason)
			}
		})
	}
}

// --- Fail-closed when verification is impossible -----------------------------
//
// A verifiable-identity gate that cannot reach the signing keys must reject, not
// wave the caller through. The distinct reason keeps a JWKS outage from reading
// as a crowd of logged-out users.

func TestVerifyIDToken_UnverifiableFailsClosed(t *testing.T) {
	unreachable, _ := startJWKSServer(t)
	unreachable.Close()

	cases := []struct {
		name string
		cfg  map[string]string
	}{
		{name: "no grafana config on context", cfg: nil},
		{name: "config carries no app URL", cfg: map[string]string{}},
		{name: "signing keys unreachable", cfg: map[string]string{sdkconfig.AppURL: unreachable.URL}},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			r := identityRequestWithConfig(t, makeValidIDToken(t, "user:1"), tt.cfg)
			id, reason := newTestApp(t).deriveCompletionUserID(r)
			if reason != reasonIdentityUnverifiable {
				t.Fatalf("reason = %q, want %q", reason, reasonIdentityUnverifiable)
			}
			if id != "" {
				t.Fatalf("expected empty id when unverifiable, got %q", id)
			}
		})
	}
}

// A 5xx from the signing-keys endpoint is an outage, not a bad token: the
// caller must not be told they are unauthenticated.
func TestVerifyIDToken_SigningKeysErrorIsUnverifiable(t *testing.T) {
	broken := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	t.Cleanup(broken.Close)

	r := identityRequestWithConfig(t, makeValidIDToken(t, "user:1"), map[string]string{sdkconfig.AppURL: broken.URL})
	if _, reason := newTestApp(t).deriveCompletionUserID(r); reason != reasonIdentityUnverifiable {
		t.Fatalf("reason = %q, want %q", reason, reasonIdentityUnverifiable)
	}
}

// --- Key caching -------------------------------------------------------------

// The verifier is held on the App so authlib's key cache survives across
// requests. Rebuilding it per call would fetch the JWKS on every proxy request.
func TestVerifyIDToken_KeySetFetchedOncePerInstance(t *testing.T) {
	server, fetches := startJWKSServer(t)
	cfg := map[string]string{sdkconfig.AppURL: server.URL}
	app := newTestApp(t)

	for i := range 5 {
		r := identityRequestWithConfig(t, makeValidIDToken(t, "user:1"), cfg)
		if _, reason := app.deriveCompletionUserID(r); reason != "" {
			t.Fatalf("request %d: unexpected reason %q", i, reason)
		}
	}

	if got := fetches.Load(); got != 1 {
		t.Fatalf("JWKS fetched %d times, want 1", got)
	}
}

// A verifier built for one stack must not be reused after the app URL changes.
func TestVerifyIDToken_RebuiltWhenAppURLChanges(t *testing.T) {
	first, firstFetches := startJWKSServer(t)
	second, secondFetches := startJWKSServer(t)
	app := newTestApp(t)

	for _, server := range []*httptest.Server{first, second} {
		r := identityRequestWithConfig(t, makeValidIDToken(t, "user:1"), map[string]string{sdkconfig.AppURL: server.URL})
		if _, reason := app.deriveCompletionUserID(r); reason != "" {
			t.Fatalf("unexpected reason %q for %s", reason, server.URL)
		}
	}

	if firstFetches.Load() != 1 || secondFetches.Load() != 1 {
		t.Fatalf("fetches = (%d, %d), want (1, 1)", firstFetches.Load(), secondFetches.Load())
	}
}
