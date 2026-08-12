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
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	sdkconfig "github.com/grafana/grafana-plugin-sdk-go/config"
	"github.com/grafana/grafana-plugin-sdk-go/experimental/featuretoggles"

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
	body := jwksBody(testSigningKeyID, testSigningKey())

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

func jwksBody(kid string, key *ecdsa.PrivateKey) []byte {
	point, err := key.PublicKey.Bytes()
	if err != nil {
		panic(fmt.Sprintf("encode test public key: %v", err))
	}
	body, err := json.Marshal(map[string]any{"keys": []map[string]string{{
		"kty": "EC",
		"crv": "P-256",
		"alg": "ES256",
		"use": "sig",
		"kid": kid,
		"x":   base64.RawURLEncoding.EncodeToString(point[1:33]),
		"y":   base64.RawURLEncoding.EncodeToString(point[33:]),
	}}})
	if err != nil {
		panic(fmt.Sprintf("marshal test JWKS: %v", err))
	}
	return body
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
		wantStatus identityStatus
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
			wantStatus: identityRejected,
		},
		{
			name:       "malformed (not three segments) fails closed",
			token:      "not-a-jwt",
			wantStatus: identityRejected,
		},
		{
			name:       "empty subject fails closed",
			token:      makeValidIDToken(t, ""),
			wantStatus: identityRejected,
		},
		{
			name:       "expired token fails closed",
			token:      makeIDToken(t, "user:abc123", time.Now().Add(-time.Hour).Unix()),
			wantStatus: identityRejected,
		},
		{
			name:       "missing exp claim fails closed",
			token:      makeIDToken(t, "user:abc123", 0),
			wantStatus: identityRejected,
		},
		{
			// The whole point of #1568: a client-forged header naming any subject
			// is worthless without the stack's signing key.
			name:       "signature from a foreign key fails closed",
			token:      signIDToken(t, idToken{sub: "user:victim", exp: validExp, kid: testSigningKeyID, typ: "jwt", key: foreignKey}),
			wantStatus: identityRejected,
		},
		{
			name:       "unrecognized kid fails closed",
			token:      signIDToken(t, idToken{sub: "user:abc123", exp: validExp, kid: "not-a-real-key", typ: "jwt", key: testSigningKey()}),
			wantStatus: identityRejected,
		},
		{
			name:       "missing kid fails closed",
			token:      signIDToken(t, idToken{sub: "user:abc123", exp: validExp, typ: "jwt", key: testSigningKey()}),
			wantStatus: identityRejected,
		},
		{
			// An access token is signed by the same keys but is not an identity
			// attestation; type confusion must not authenticate a caller.
			name:       "access-token type fails closed",
			token:      signIDToken(t, idToken{sub: "user:abc123", exp: validExp, kid: testSigningKeyID, typ: "at+jwt", key: testSigningKey()}),
			wantStatus: identityRejected,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			id, status := newTestApp(t).deriveCompletionUserID(identityRequest(t, tt.token))
			if status != tt.wantStatus {
				t.Fatalf("status = %v, want %v", status, tt.wantStatus)
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
	if id, status := newTestApp(t).deriveCompletionUserID(r); status == identityVerified {
		t.Fatalf("expected fail-closed, got id=%q", id)
	}
}

// validIDToken is the layer for routes with no per-user need: same verification
// discipline, but a verified token needs no subject to authorize the caller.
func TestValidIDToken(t *testing.T) {
	cases := []struct {
		name       string
		token      string
		wantStatus identityStatus
	}{
		{name: "verified token", token: makeValidIDToken(t, "user:1")},
		{name: "no subject still authorizes", token: makeValidIDToken(t, "")},
		{name: "missing exp rejected", token: makeIDToken(t, "user:1", 0), wantStatus: identityRejected},
		{name: "expired rejected", token: makeIDToken(t, "user:1", time.Now().Add(-time.Hour).Unix()), wantStatus: identityRejected},
		{name: "absent rejected", token: "", wantStatus: identityRejected},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			if status := newTestApp(t).validIDToken(identityRequest(t, tt.token)); status != tt.wantStatus {
				t.Fatalf("validIDToken = %v, want %v", status, tt.wantStatus)
			}
		})
	}
}

// capabilityReason is the single place a status turns into an envelope token, so
// the three routes cannot invent their own. The transient status has none: it is
// served as a 503, never in an envelope.
func TestIdentityStatus_CapabilityReason(t *testing.T) {
	cases := map[identityStatus]string{
		identityVerified:        "",
		identityRejected:        reasonIdentityUnavailable,
		identityUnverifiable:    reasonIdentityUnverifiable,
		identitySigningKeysDown: "",
	}
	for status, want := range cases {
		if got := status.capabilityReason(); got != want {
			t.Errorf("status %v: capabilityReason = %q, want %q", status, got, want)
		}
	}
}

// --- Fail-closed when verification is impossible -----------------------------
//
// A verifiable-identity gate that cannot reach the signing keys must reject, not
// wave the caller through. The distinct reason keeps a JWKS outage from reading
// as a crowd of logged-out users.

// No signing-keys URL is resolvable at all, so verification can never succeed
// on this stack: a standing condition, served in-band as capability=false.
func TestVerifyIDToken_UnverifiableFailsClosed(t *testing.T) {
	cases := []struct {
		name string
		cfg  map[string]string
	}{
		{name: "no grafana config on context", cfg: nil},
		{name: "config carries no app URL", cfg: map[string]string{}},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			r := identityRequestWithConfig(t, makeValidIDToken(t, "user:1"), tt.cfg)
			id, status := newTestApp(t).deriveCompletionUserID(r)
			if status != identityUnverifiable {
				t.Fatalf("status = %v, want identityUnverifiable", status)
			}
			if status.capabilityReason() != reasonIdentityUnverifiable {
				t.Fatalf("reason = %q, want %q", status.capabilityReason(), reasonIdentityUnverifiable)
			}
			if id != "" {
				t.Fatalf("expected empty id when unverifiable, got %q", id)
			}
		})
	}
}

// --- Signing-keys outage: a transient 503, not a capability envelope ---------
//
// The signing-keys URL resolves fine, the FETCH fails. §7 reserves the in-band
// capability envelope for "never works here", and the front-end caches an empty
// capability=false result without retrying — so reporting a 30-second JWKS blip
// that way darkens the gated surfaces past the end of the outage. Every route
// that gates on identity therefore serves the transient path instead.

func TestIdentityGate_SigningKeysOutageIsTransient503(t *testing.T) {
	fiveHundred := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	t.Cleanup(fiveHundred.Close)

	refused, _ := startJWKSServer(t)
	refused.Close()

	// Healthy listers and both toggles on: nothing but the identity gate can
	// 503 these routes, so the status pins the gate's behavior.
	withLister(t, singlePageLister())
	withGuideLister(t, singlePageGuideLister())

	origins := []struct{ name, appURL string }{
		{name: "signing keys 5xx", appURL: fiveHundred.URL},
		{name: "signing keys unreachable", appURL: refused.URL},
	}
	routes := []struct {
		name string
		do   func(*testing.T, map[string]string) *httptest.ResponseRecorder
	}{
		{
			name: "custom-guide-repository",
			do: func(t *testing.T, cfg map[string]string) *httptest.ResponseRecorder {
				rr, _ := doCustomGuideReq(t, customGuideRequestWithConfig(t, "/custom-guide-repository", "user:1", cfg))
				return rr
			},
		},
		{
			name: "completion-records/my",
			do: func(t *testing.T, cfg map[string]string) *httptest.ResponseRecorder {
				rr, _ := doMyCompletionsReq(t, completionRequestWithConfig(t, "/completion-records/my", "user:1", cfg))
				return rr
			},
		},
		{
			name: "completion-records/capability",
			do: func(t *testing.T, cfg map[string]string) *httptest.ResponseRecorder {
				rr := httptest.NewRecorder()
				newTestApp(t).handleCompletionCapability(rr,
					completionRequestWithConfig(t, "/completion-records/capability", "user:1", cfg))
				return rr
			},
		},
	}

	for _, origin := range origins {
		cfg := map[string]string{
			featuretoggles.EnabledFeatures: pathfinderBackendAggregationToggle + "," + customGuideAggregationToggle,
			sdkconfig.AppURL:               origin.appURL,
		}
		for _, route := range routes {
			t.Run(origin.name+"/"+route.name, func(t *testing.T) {
				rr := route.do(t, cfg)
				if rr.Code != http.StatusServiceUnavailable {
					t.Fatalf("status = %d, want 503 (body %s)", rr.Code, rr.Body.String())
				}
				if got := rr.Header().Get("Retry-After"); got == "" {
					t.Errorf("expected a Retry-After hint on a transient 503")
				}
				if body := rr.Body.String(); !strings.Contains(body, "-unavailable") {
					t.Errorf("expected a machine error token, got %s", body)
				}
			})
		}
	}
}

// --- Key caching -------------------------------------------------------------

// The verifier is held briefly so authlib's key cache survives across requests.
func TestVerifyIDToken_KeySetFetchedOnceWithinMaxAge(t *testing.T) {
	withFrozenTime(t, time.Unix(1_700_000_000, 0))
	server, fetches := startJWKSServer(t)
	cfg := map[string]string{sdkconfig.AppURL: server.URL}
	app := newTestApp(t)

	for i := range 5 {
		r := identityRequestWithConfig(t, makeValidIDToken(t, "user:1"), cfg)
		if _, status := app.deriveCompletionUserID(r); status != identityVerified {
			t.Fatalf("request %d: unexpected status %v", i, status)
		}
	}

	if got := fetches.Load(); got != 1 {
		t.Fatalf("JWKS fetched %d times, want 1", got)
	}
}

func TestVerifyIDToken_KeySetRefreshBoundsRetiredKeyTrust(t *testing.T) {
	advance := withFrozenTime(t, time.Unix(1_700_000_000, 0))
	retiredKey := testSigningKey()
	activeKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate active key: %v", err)
	}

	var currentJWKS atomic.Value
	currentJWKS.Store(jwksBody("retired-key", retiredKey))
	var fetches atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != auth.SigningKeysPath {
			http.NotFound(w, r)
			return
		}
		fetches.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(currentJWKS.Load().([]byte))
	}))
	t.Cleanup(server.Close)

	validExp := time.Now().Add(time.Hour).Unix()
	retiredToken := signIDToken(t, idToken{
		sub: "user:1", exp: validExp, kid: "retired-key", typ: "jwt", key: retiredKey,
	})
	activeToken := signIDToken(t, idToken{
		sub: "user:1", exp: validExp, kid: "active-key", typ: "jwt", key: activeKey,
	})
	cfg := map[string]string{sdkconfig.AppURL: server.URL}
	app := newTestApp(t)
	verify := func(token string) identityStatus {
		t.Helper()
		_, status := app.deriveCompletionUserID(identityRequestWithConfig(t, token, cfg))
		return status
	}

	if status := verify(retiredToken); status != identityVerified {
		t.Fatalf("retired token before rotation: status = %v, want verified", status)
	}
	currentJWKS.Store(jwksBody("active-key", activeKey))
	advance(idTokenVerifierMaxAge - time.Second)
	if status := verify(retiredToken); status != identityVerified {
		t.Fatalf("retired token inside refresh window: status = %v, want verified", status)
	}
	advance(time.Second)
	if status := verify(retiredToken); status != identityRejected {
		t.Fatalf("retired token after refresh: status = %v, want rejected", status)
	}
	if status := verify(activeToken); status != identityVerified {
		t.Fatalf("active token after refresh: status = %v, want verified", status)
	}
	if got := fetches.Load(); got != 2 {
		t.Fatalf("JWKS fetched %d times, want 2", got)
	}
}

// A verifier built for one stack must not be reused after the app URL changes.
func TestVerifyIDToken_RebuiltWhenAppURLChanges(t *testing.T) {
	first, firstFetches := startJWKSServer(t)
	second, secondFetches := startJWKSServer(t)
	app := newTestApp(t)

	for _, server := range []*httptest.Server{first, second} {
		r := identityRequestWithConfig(t, makeValidIDToken(t, "user:1"), map[string]string{sdkconfig.AppURL: server.URL})
		if _, status := app.deriveCompletionUserID(r); status != identityVerified {
			t.Fatalf("unexpected status %v for %s", status, server.URL)
		}
	}

	if firstFetches.Load() != 1 || secondFetches.Load() != 1 {
		t.Fatalf("fetches = (%d, %d), want (1, 1)", firstFetches.Load(), secondFetches.Load())
	}
}
