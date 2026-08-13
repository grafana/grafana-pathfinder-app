package plugin

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"
	gojwt "github.com/go-jose/go-jose/v4/jwt"
	"github.com/grafana/grafana-plugin-sdk-go/backend"
	sdkconfig "github.com/grafana/grafana-plugin-sdk-go/config"
)

// testSigningKeyID is the `kid` the shared test JWKS server publishes and
// makeIDToken signs with by default.
const testSigningKeyID = "test-key-1"

var (
	testSigningKeyOnce sync.Once
	testSigningKey     *ecdsa.PrivateKey

	testJWKSServerOnce sync.Once
	testJWKSServerAddr string
)

// testIDTokenSigningKey lazily generates the ES256 key pair the shared test
// JWKS server publishes, once per test binary run, so every test validates
// against the same key without regenerating one per test.
func testIDTokenSigningKey() *ecdsa.PrivateKey {
	testSigningKeyOnce.Do(func() {
		key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		if err != nil {
			panic("generate test ES256 signing key: " + err.Error())
		}
		testSigningKey = key
	})
	return testSigningKey
}

// testJWKSServerURL starts (once per test binary run) an httptest server
// serving the test signing key's public JWKS at /api/signing-keys/keys,
// mirroring Grafana's own unauthenticated signing-keys endpoint. Tests set it
// as the Grafana config app URL so the identity verifier fetches real keys
// from a real HTTP endpoint, the same way it does in production.
func testJWKSServerURL() string {
	testJWKSServerOnce.Do(func() {
		key := testIDTokenSigningKey()
		jwks := jose.JSONWebKeySet{Keys: []jose.JSONWebKey{
			{Key: key.Public(), KeyID: testSigningKeyID, Algorithm: "ES256", Use: "sig"},
		}}
		mux := http.NewServeMux()
		mux.HandleFunc("/api/signing-keys/keys", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(jwks)
		})
		testJWKSServerAddr = httptest.NewServer(mux).URL
	})
	return testJWKSServerAddr
}

// signIDToken builds a real ES256-signed JWT with the given header/claim
// overrides (exp == 0 omits the claim), so tests can exercise forged or
// malformed signatures against the real verifier rather than a filler one.
func signIDToken(t *testing.T, key *ecdsa.PrivateKey, kid, typ, sub string, exp int64) string {
	t.Helper()
	signer, err := jose.NewSigner(jose.SigningKey{
		Algorithm: jose.ES256,
		Key:       jose.JSONWebKey{Key: key, KeyID: kid, Algorithm: string(jose.ES256), Use: "sig"},
	}, (&jose.SignerOptions{}).WithType(jose.ContentType(typ)))
	if err != nil {
		t.Fatalf("build test signer: %v", err)
	}

	claims := map[string]any{}
	if sub != "" {
		claims["sub"] = sub
	}
	if exp != 0 {
		claims["exp"] = exp
	}
	token, err := gojwt.Signed(signer).Claims(claims).Serialize()
	if err != nil {
		t.Fatalf("sign test token: %v", err)
	}
	return token
}

// makeIDToken builds a validly-signed ID token (matching the shared test JWKS
// server's key and kid, type "jwt") with the given claims.
func makeIDToken(t *testing.T, sub string, exp int64) string {
	t.Helper()
	return signIDToken(t, testIDTokenSigningKey(), testSigningKeyID, "jwt", sub, exp)
}

// identityTestRequest builds a GET request carrying the given ID-token header
// (may be empty) and a Grafana config whose app URL points at the shared test
// JWKS server.
func identityTestRequest(t *testing.T, header string) *http.Request {
	t.Helper()
	r, _ := http.NewRequest(http.MethodGet, "/", nil)
	if header != "" {
		r.Header.Set(backend.GrafanaUserSignInTokenHeaderName, header)
	}
	ctx := sdkconfig.WithGrafanaConfig(r.Context(), sdkconfig.NewGrafanaCfg(map[string]string{
		sdkconfig.AppURL: testJWKSServerURL(),
	}))
	return r.WithContext(ctx)
}

func TestDeriveCompletionUserID(t *testing.T) {
	app := newTestApp(t)
	future := time.Now().Add(time.Hour).Unix()
	// Well past authlib's one-minute default leeway, so this reads as expired
	// under real wall-clock verification regardless of when the suite runs.
	past := time.Now().Add(-2 * time.Minute).Unix()

	tests := []struct {
		name   string
		header string
		wantID string
		wantOK bool
	}{
		{
			name:   "valid token yields verbatim typed subject",
			header: makeIDToken(t, "user:abc123", future),
			wantID: "user:abc123",
			wantOK: true,
		},
		{
			name:   "typed prefix preserved verbatim",
			header: makeIDToken(t, "service-account:xyz", future),
			wantID: "service-account:xyz",
			wantOK: true,
		},
		{
			name:   "absent header fails closed",
			header: "",
			wantOK: false,
		},
		{
			name:   "malformed (not three segments) fails closed",
			header: "not-a-jwt",
			wantOK: false,
		},
		{
			name:   "empty subject fails closed",
			header: makeIDToken(t, "", future),
			wantOK: false,
		},
		{
			name:   "expired token fails closed",
			header: makeIDToken(t, "user:abc123", past),
			wantOK: false,
		},
		{
			name:   "missing exp claim fails closed",
			header: makeIDToken(t, "user:abc123", 0),
			wantOK: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			id, ok := app.deriveCompletionUserID(identityTestRequest(t, tt.header))
			if ok != tt.wantOK {
				t.Fatalf("ok = %v, want %v", ok, tt.wantOK)
			}
			if ok && id != tt.wantID {
				t.Fatalf("id = %q, want %q", id, tt.wantID)
			}
			if !ok && id != "" {
				t.Fatalf("expected empty id on failure, got %q", id)
			}
		})
	}
}

// TestDeriveCompletionUserID_NoLoginFallback proves the fail-closed contract:
// a present X-Grafana-User login does NOT rescue a missing/invalid ID token.
func TestDeriveCompletionUserID_NoLoginFallback(t *testing.T) {
	app := newTestApp(t)
	r := identityTestRequest(t, "garbage")
	r.Header.Set("X-Grafana-User", "admin")
	if id, ok := app.deriveCompletionUserID(r); ok {
		t.Fatalf("expected fail-closed, got id=%q ok=true", id)
	}
}

// validIDToken is the verified-but-subjectless layer for routes with no
// per-user need: it must apply the same signature/exp discipline without
// requiring a subject.
func TestValidIDToken(t *testing.T) {
	app := newTestApp(t)
	future := time.Now().Add(time.Hour).Unix()
	past := time.Now().Add(-2 * time.Minute).Unix()

	cases := []struct {
		name   string
		header string
		want   bool
	}{
		{"valid token", makeIDToken(t, "user:1", future), true},
		{"no subject still valid", makeIDToken(t, "", future), true},
		{"missing exp rejected", makeIDToken(t, "user:1", 0), false},
		{"expired rejected", makeIDToken(t, "user:1", past), false},
		{"absent rejected", "", false},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			if got := app.validIDToken(identityTestRequest(t, tt.header)); got != tt.want {
				t.Fatalf("validIDToken = %v, want %v", got, tt.want)
			}
		})
	}
}

// TestValidIDToken_SignatureVerification exercises the JWKS-backed
// verification layer directly: structural validity (well-formed JWT, exp
// present and unexpired) is no longer sufficient on its own — the token must
// also carry a correct signature from a key the stack's JWKS actually
// publishes, of the expected type.
func TestValidIDToken_SignatureVerification(t *testing.T) {
	app := newTestApp(t)
	future := time.Now().Add(time.Hour).Unix()

	forgedKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate forged key: %v", err)
	}

	cases := []struct {
		name   string
		header string
		want   bool
	}{
		{
			name:   "validly signed token accepted",
			header: makeIDToken(t, "user:1", future),
			want:   true,
		},
		{
			name:   "forged signature (attacker key, legitimate kid) rejected",
			header: signIDToken(t, forgedKey, testSigningKeyID, "jwt", "user:1", future),
			want:   false,
		},
		{
			name:   "unknown kid rejected",
			header: signIDToken(t, testIDTokenSigningKey(), "no-such-key", "jwt", "user:1", future),
			want:   false,
		},
		{
			name:   "wrong typ header rejected",
			header: signIDToken(t, testIDTokenSigningKey(), testSigningKeyID, "JWT", "user:1", future),
			want:   false,
		},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			if got := app.validIDToken(identityTestRequest(t, tt.header)); got != tt.want {
				t.Fatalf("validIDToken = %v, want %v", got, tt.want)
			}
		})
	}
}

// TestValidIDToken_JWKSUnreachableFailsClosed proves the identity gate fails
// closed, not open, when the JWKS endpoint cannot be reached at all (e.g. a
// transient outage on the stack's own signing-keys endpoint) — distinct from
// an unknown kid, which is a reachable JWKS that simply doesn't recognize the
// token's key.
func TestValidIDToken_JWKSUnreachableFailsClosed(t *testing.T) {
	app := newTestApp(t)
	token := makeIDToken(t, "user:1", time.Now().Add(time.Hour).Unix())

	r, _ := http.NewRequest(http.MethodGet, "/", nil)
	r.Header.Set(backend.GrafanaUserSignInTokenHeaderName, token)
	ctx := sdkconfig.WithGrafanaConfig(r.Context(), sdkconfig.NewGrafanaCfg(map[string]string{
		sdkconfig.AppURL: "http://127.0.0.1:1", // nothing listens here
	}))

	if app.validIDToken(r.WithContext(ctx)) {
		t.Fatal("expected JWKS-unreachable to fail closed, got validIDToken = true")
	}
}

// TestValidIDToken_UnresolvedConfigFailsClosed documents the
// BACKEND_PROXY_PATTERN.md §4 sequencing constraint: the identity gate runs
// before the rest of config resolution, so a request with no Grafana config
// in context yet (verification needs the app URL to locate the JWKS) fails
// closed via the same path as any other identity failure, rather than being
// promoted into its own pre-identity resolution step.
func TestValidIDToken_UnresolvedConfigFailsClosed(t *testing.T) {
	app := newTestApp(t)
	r, _ := http.NewRequest(http.MethodGet, "/", nil)
	r.Header.Set(backend.GrafanaUserSignInTokenHeaderName, makeIDToken(t, "user:1", time.Now().Add(time.Hour).Unix()))

	if app.validIDToken(r) {
		t.Fatal("expected unresolved Grafana config to fail closed")
	}
}
