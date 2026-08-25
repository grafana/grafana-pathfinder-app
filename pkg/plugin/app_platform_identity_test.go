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

	// namespace is the stack the token was minted for, in Grafana's
	// '<type>-<id>' form. Empty omits the claim, which the gate must refuse.
	namespace string

	// Optional authlib profile claims; empty values are omitted so a test can
	// pin what an absent claim yields.
	username string
	name     string
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
	if tok.namespace != "" {
		claims["namespace"] = tok.namespace
	}
	if tok.username != "" {
		claims["username"] = tok.username
	}
	if tok.name != "" {
		claims["name"] = tok.name
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
	return signIDToken(t, idToken{
		sub: sub, exp: exp, kid: testSigningKeyID, typ: "jwt",
		key: testSigningKey(), namespace: testNamespace,
	})
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
	return identityRequestForNamespace(t, token, cfg, testNamespace)
}

// identityRequestForNamespace is identityRequestWithConfig with the
// server-derived namespace under the caller's control; "" models a plugin
// context that carries none.
func identityRequestForNamespace(t *testing.T, token string, cfg map[string]string, namespace string) *http.Request {
	t.Helper()
	r, _ := http.NewRequest(http.MethodGet, "/", nil)
	if token != "" {
		r.Header.Set(backend.GrafanaUserSignInTokenHeaderName, token)
	}
	ctx := backend.WithPluginContext(r.Context(), backend.PluginContext{Namespace: namespace})
	if cfg != nil {
		ctx = sdkconfig.WithGrafanaConfig(ctx, sdkconfig.NewGrafanaCfg(cfg))
	}
	return r.WithContext(ctx)
}

// makeIDTokenWithProfile signs a token carrying sub/exp plus the authlib profile
// claims: `username` (login) and `name` (display name). Empty values are omitted
// so a caller can pin what an absent claim yields.
func makeIDTokenWithProfile(t *testing.T, sub string, exp int64, username, name string) string {
	t.Helper()
	return signIDToken(t, idToken{
		sub: sub, exp: exp, kid: testSigningKeyID, typ: "jwt", key: testSigningKey(),
		namespace: testNamespace, username: username, name: name,
	})
}

// makeValidIDTokenWithProfile is makeIDTokenWithProfile with a wall-clock `exp`,
// so it verifies under withFrozenTime (authlib checks expiry against time.Now).
func makeValidIDTokenWithProfile(t *testing.T, sub, username, name string) string {
	t.Helper()
	return makeIDTokenWithProfile(t, sub, time.Now().Add(time.Hour).Unix(), username, name)
}

// idTokenProfile reads authlib's IDTokenClaims profile fields: `username` is the
// login, `name` is the display name. Legacy `login`/`preferred_username` claims
// are NOT read.
func TestIDTokenProfile(t *testing.T) {
	tests := []struct {
		name      string
		token     string
		wantLogin string
		wantName  string
	}{
		{"username and name claims", makeIDTokenWithProfile(t, "user:1", 1, "alice", "Alice Anderson"), "alice", "Alice Anderson"},
		{"username only", makeIDTokenWithProfile(t, "user:1", 1, "bob", ""), "bob", ""},
		{"no profile claims", makeIDTokenWithProfile(t, "user:1", 1, "", ""), "", ""},
		{"legacy login claim ignored", `x.` + base64.RawURLEncoding.EncodeToString([]byte(`{"login":"legacy","preferred_username":"legacy2"}`)) + `.y`, "", ""},
		{"malformed token", "not-a-jwt", "", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			login, name := idTokenProfile(tt.token)
			if login != tt.wantLogin || name != tt.wantName {
				t.Fatalf("idTokenProfile = (%q, %q), want (%q, %q)", login, name, tt.wantLogin, tt.wantName)
			}
		})
	}
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
			name:       "verified token yields verbatim typed subject",
			token:      makeValidIDToken(t, "user:abc123"),
			wantID:     "user:abc123",
			wantStatus: identityVerified,
		},
		{
			name:       "typed prefix preserved verbatim",
			token:      makeValidIDToken(t, "service-account:xyz"),
			wantID:     "service-account:xyz",
			wantStatus: identityVerified,
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
			token:      signIDToken(t, idToken{sub: "user:victim", exp: validExp, kid: testSigningKeyID, typ: "jwt", key: foreignKey, namespace: testNamespace}),
			wantStatus: identityRejected,
		},
		{
			name:       "unrecognized kid fails closed",
			token:      signIDToken(t, idToken{sub: "user:abc123", exp: validExp, kid: "not-a-real-key", typ: "jwt", key: testSigningKey(), namespace: testNamespace}),
			wantStatus: identityRejected,
		},
		{
			name:       "missing kid fails closed",
			token:      signIDToken(t, idToken{sub: "user:abc123", exp: validExp, typ: "jwt", key: testSigningKey(), namespace: testNamespace}),
			wantStatus: identityRejected,
		},
		{
			// An access token is signed by the same keys but is not an identity
			// attestation; type confusion must not authenticate a caller.
			name:       "access-token type fails closed",
			token:      signIDToken(t, idToken{sub: "user:abc123", exp: validExp, kid: testSigningKeyID, typ: "at+jwt", key: testSigningKey(), namespace: testNamespace}),
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
		{name: "verified token", token: makeValidIDToken(t, "user:1"), wantStatus: identityVerified},
		{name: "no subject still authorizes", token: makeValidIDToken(t, ""), wantStatus: identityVerified},
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
// the three routes cannot invent their own. Every failing status names one, and
// the three failures name three DIFFERENT ones: the envelope alone has to say
// whether the caller, the stack, or our signing-keys address is at fault.
func TestIdentityStatus_CapabilityReason(t *testing.T) {
	cases := map[identityStatus]string{
		// The zero value is a non-verdict: it must not read as verified, and it
		// must still name a reason rather than serving an envelope with none.
		identityUnknown:         reasonIdentityUnavailable,
		identityVerified:        "",
		identityRejected:        reasonIdentityUnavailable,
		identityUnverifiable:    reasonIdentityUnverifiable,
		identitySigningKeysDown: reasonSigningKeysUnreachable,
	}
	seen := map[string]identityStatus{}
	for status, reason := range cases {
		if reason == "" || status == identityUnknown {
			continue
		}
		if other, dup := seen[reason]; dup {
			t.Errorf("statuses %v and %v both report %q; the envelope cannot tell them apart", other, status, reason)
		}
		seen[reason] = status
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
		// A request with no Grafana config at all resolves to the same place as one
		// whose config omits the app URL: GrafanaConfigFromContext substitutes an
		// empty config, whose AppURL() errors.
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

// --- No reachable signing-keys source: a standing condition, not a 503 -------
//
// The signing-keys URL resolves fine, the FETCH fails everywhere. A 503 would
// darken every gated surface at once for the whole client cache TTL — the
// front-end lumps 503 into its not-rolled-out set and renders empty without
// retrying — and reaching nothing at all points at the configured address far
// more often than at a brief outage. So it takes the soft envelope, under its
// OWN reason token: an operator must not have to guess whether they are looking
// at the normal Grafana Cloud shape or at broken config.

// identityRouteProbe exercises one gated route and reports the status it served
// plus the capability reason it carried.
type identityRouteProbe struct {
	name string
	do   func(*testing.T, map[string]string) (*httptest.ResponseRecorder, string)
}

func gatedReadRoutes() []identityRouteProbe {
	return []identityRouteProbe{
		{
			name: "custom-guide-repository",
			do: func(t *testing.T, cfg map[string]string) (*httptest.ResponseRecorder, string) {
				rr, body := doCustomGuideReq(t, customGuideRequestWithConfig(t, "/custom-guide-repository", "user:1", cfg))
				return rr, body.Capability.Reason
			},
		},
		{
			name: "completion-records/my",
			do: func(t *testing.T, cfg map[string]string) (*httptest.ResponseRecorder, string) {
				rr, body := doMyCompletionsReq(t, completionRequestWithConfig(t, "/completion-records/my", "user:1", cfg))
				return rr, body.Capability.Reason
			},
		},
		{
			name: "completion-records/capability",
			do: func(t *testing.T, cfg map[string]string) (*httptest.ResponseRecorder, string) {
				rr := httptest.NewRecorder()
				newTestApp(t).handleCompletionCapability(rr,
					completionRequestWithConfig(t, "/completion-records/capability", "user:1", cfg))
				var body completionCapability
				if rr.Body.Len() > 0 {
					if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
						t.Fatalf("decode capability: %v (raw %s)", err, rr.Body.String())
					}
				}
				return rr, body.Reason
			},
		},
	}
}

func TestIdentityGate_NoReachableSigningKeysSourceIsASoftStandingCondition(t *testing.T) {
	fiveHundred := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	t.Cleanup(fiveHundred.Close)

	refused, _ := startJWKSServer(t)
	refused.Close()

	// auth-api is unreachable too, so NO source answers — the whole point of
	// this test. TestMain already points it at a dead origin; make it explicit.
	unreachableAuthAPI, _ := startJWKSServer(t)
	unreachableAuthAPI.Close()
	withSigningKeysURL(t, unreachableAuthAPI.URL+"/v1/keys")

	// Healthy listers and both toggles on, so nothing but the identity gate can
	// decide these responses.
	withLister(t, singlePageLister())
	withGuideLister(t, singlePageGuideLister())

	origins := []struct{ name, appURL string }{
		{name: "signing keys 5xx", appURL: fiveHundred.URL},
		{name: "signing keys unreachable", appURL: refused.URL},
	}

	for _, origin := range origins {
		cfg := map[string]string{
			featuretoggles.EnabledFeatures: pathfinderBackendAggregationToggle + "," + customGuideAggregationToggle,
			sdkconfig.AppURL:               origin.appURL,
		}
		for _, route := range gatedReadRoutes() {
			t.Run(origin.name+"/"+route.name, func(t *testing.T) {
				rr, reason := route.do(t, cfg)
				if rr.Code != http.StatusOK {
					t.Fatalf("status = %d, want 200 (body %s)", rr.Code, rr.Body.String())
				}
				if got := rr.Header().Get("Retry-After"); got != "" {
					t.Errorf("Retry-After = %q on a standing condition, want none", got)
				}
				if reason != reasonSigningKeysUnreachable {
					t.Fatalf("reason = %q, want %q", reason, reasonSigningKeysUnreachable)
				}
			})
		}
	}
}

// The two ways a key lookup comes up empty are different faults with different
// owners, so they must not collapse into one envelope token. A stack answering
// `{"keys":null}` is the normal Grafana Cloud shape; nothing answering at all
// almost always means our own address is wrong.
func TestIdentityGate_KeyLookupCausesReportDistinctReasons(t *testing.T) {
	withLister(t, singlePageLister())
	withGuideLister(t, singlePageGuideLister())

	unreachable, _ := startJWKSServer(t)
	unreachable.Close()

	cases := []struct {
		name string
		// setUp configures the auth-api source and returns the stack app URL.
		setUp      func(*testing.T) string
		wantReason string
	}{
		{
			// Both sources answer, neither publishes the `kid`: the key is
			// genuinely unknown, so this is a verdict on the caller's token.
			name: "a source answers with an empty key set",
			setUp: func(t *testing.T) string {
				withSigningKeysURL(t, emptyAuthAPIJWKS(t))
				return cloudStack(t)
			},
			wantReason: reasonIdentityUnavailable,
		},
		{
			name: "no source answers at all",
			setUp: func(t *testing.T) string {
				withSigningKeysURL(t, unreachable.URL+"/v1/keys")
				return unreachable.URL
			},
			wantReason: reasonSigningKeysUnreachable,
		},
	}

	for _, tt := range cases {
		for _, route := range gatedReadRoutes() {
			t.Run(tt.name+"/"+route.name, func(t *testing.T) {
				cfg := map[string]string{
					featuretoggles.EnabledFeatures: pathfinderBackendAggregationToggle + "," + customGuideAggregationToggle,
					sdkconfig.AppURL:               tt.setUp(t),
				}
				rr, reason := route.do(t, cfg)
				if rr.Code != http.StatusOK {
					t.Fatalf("status = %d, want 200 (body %s)", rr.Code, rr.Body.String())
				}
				if reason != tt.wantReason {
					t.Fatalf("reason = %q, want %q", reason, tt.wantReason)
				}
			})
		}
	}
}

// emptyAuthAPIJWKS serves the auth-api key-set path with no keys, so the source
// ANSWERS rather than failing to fetch.
func emptyAuthAPIJWKS(t *testing.T) string {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/keys" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"keys":null}`))
	}))
	t.Cleanup(server.Close)
	return server.URL + "/v1/keys"
}

// --- Grafana Cloud: auth-api holds the signing key ---------------------------
//
// A Grafana Cloud stack issues ID tokens but does not sign them, and serves
// `{"keys":null}` at its own signing-keys endpoint. Verifying against that
// endpoint alone resolved no `kid` for any caller, so every proxy route reported
// identity-unavailable on every Cloud stack.

// authAPIJWKS serves testSigningKey where auth-api publishes its key set.
func authAPIJWKS(t *testing.T) string {
	t.Helper()
	body := jwksBody(testSigningKeyID, testSigningKey())
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/keys" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(body)
	}))
	t.Cleanup(server.Close)
	return server.URL + "/v1/keys"
}

// cloudStack is a stack whose signing-keys endpoint answers exactly as a
// measured Grafana Cloud stack does: 200, and a null key list.
func cloudStack(t *testing.T) string {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != auth.SigningKeysPath {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"keys":null}`))
	}))
	t.Cleanup(server.Close)
	return server.URL
}

func TestIdentityGate_CloudStackVerifiesAgainstAuthAPI(t *testing.T) {
	withSigningKeysURL(t, authAPIJWKS(t))
	withLister(t, singlePageLister())
	withGuideLister(t, singlePageGuideLister())

	cfg := map[string]string{
		featuretoggles.EnabledFeatures: pathfinderBackendAggregationToggle + "," + customGuideAggregationToggle,
		sdkconfig.AppURL:               cloudStack(t),
	}

	t.Run("custom-guide-repository", func(t *testing.T) {
		rr, body := doCustomGuideReq(t, customGuideRequestWithConfig(t, "/custom-guide-repository", "user:1", cfg))
		if rr.Code != http.StatusOK || !body.Capability.Available {
			t.Fatalf("status = %d, available = %v, reason = %q", rr.Code, body.Capability.Available, body.Capability.Reason)
		}
	})
	t.Run("completion-records/my", func(t *testing.T) {
		rr, body := doMyCompletionsReq(t, completionRequestWithConfig(t, "/completion-records/my", "user:1", cfg))
		if rr.Code != http.StatusOK || !body.Capability.Available {
			t.Fatalf("status = %d, available = %v, reason = %q", rr.Code, body.Capability.Available, body.Capability.Reason)
		}
	})
}

// A wrong auth-api host would fail its fetch rather than answer empty. That must
// not turn every proxy route into a hard 503 on a stack that answers: while any
// signing-keys endpoint is reachable, an unresolvable `kid` stays the soft-200
// refusal it was before auth-api was consulted at all.
func TestIdentityGate_UnreachableAuthAPIWithAnAnsweringStackStaysSoft(t *testing.T) {
	unreachable, _ := startJWKSServer(t)
	unreachable.Close()
	withSigningKeysURL(t, unreachable.URL+"/v1/keys")
	withLister(t, singlePageLister())
	withGuideLister(t, singlePageGuideLister())

	cfg := map[string]string{
		featuretoggles.EnabledFeatures: pathfinderBackendAggregationToggle + "," + customGuideAggregationToggle,
		sdkconfig.AppURL:               cloudStack(t),
	}

	rr, body := doCustomGuideReq(t, customGuideRequestWithConfig(t, "/custom-guide-repository", "user:1", cfg))
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body %s)", rr.Code, rr.Body.String())
	}
	if body.Capability.Available || body.Capability.Reason != reasonIdentityUnavailable {
		t.Fatalf("available = %v, reason = %q, want reason %q", body.Capability.Available, body.Capability.Reason, reasonIdentityUnavailable)
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
		namespace: testNamespace,
	})
	activeToken := signIDToken(t, idToken{
		sub: "user:1", exp: validExp, kid: "active-key", typ: "jwt", key: activeKey,
		namespace: testNamespace,
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

// The five-minute bound caps how long a retired key stays trusted; it must not
// also delay a newly published one, or a rotation would reject live tokens for
// up to that long. Authlib re-fetches on an unknown `kid`, so the new key is
// accepted mid-window — and the retired one still verifies, because that
// re-fetch adds to the cached set rather than replacing it.
func TestVerifyIDToken_NewKeyAcceptedMidWindow(t *testing.T) {
	advance := withFrozenTime(t, time.Unix(1_700_000_000, 0))
	firstKey := testSigningKey()
	secondKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate second key: %v", err)
	}

	var currentJWKS atomic.Value
	currentJWKS.Store(jwksBody("first-key", firstKey))
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != auth.SigningKeysPath {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(currentJWKS.Load().([]byte))
	}))
	t.Cleanup(server.Close)

	validExp := time.Now().Add(time.Hour).Unix()
	firstToken := signIDToken(t, idToken{sub: "user:1", exp: validExp, kid: "first-key", typ: "jwt", key: firstKey, namespace: testNamespace})
	secondToken := signIDToken(t, idToken{sub: "user:1", exp: validExp, kid: "second-key", typ: "jwt", key: secondKey, namespace: testNamespace})
	cfg := map[string]string{sdkconfig.AppURL: server.URL}
	app := newTestApp(t)
	verify := func(token string) identityStatus {
		t.Helper()
		_, status := app.deriveCompletionUserID(identityRequestWithConfig(t, token, cfg))
		return status
	}

	if status := verify(firstToken); status != identityVerified {
		t.Fatalf("first token: status = %v, want verified", status)
	}
	currentJWKS.Store(jwksBody("second-key", secondKey))
	advance(idTokenVerifierMaxAge / 2)
	if status := verify(secondToken); status != identityVerified {
		t.Fatalf("newly published key mid-window: status = %v, want verified", status)
	}
	if status := verify(firstToken); status != identityVerified {
		t.Fatalf("previous key mid-window: status = %v, want verified", status)
	}
}

// One App serves every request, so the cached verifier is read on the hot path
// while another request replaces it. Without a test that drives that
// concurrently, -race over the cache proves nothing.
func TestVerifyIDToken_VerifierCacheUnderConcurrentRebuilds(t *testing.T) {
	first, _ := startJWKSServer(t)
	second, _ := startJWKSServer(t)
	app := newTestApp(t)
	token := makeValidIDToken(t, "user:1")
	// Alternating app URLs makes most requests miss the cache, so readers and
	// replacements collide on purpose.
	cfgs := []map[string]string{{sdkconfig.AppURL: first.URL}, {sdkconfig.AppURL: second.URL}}

	var wg sync.WaitGroup
	for i := range 32 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := range 8 {
				r := identityRequestWithConfig(t, token, cfgs[(i+j)%len(cfgs)])
				if _, status := app.deriveCompletionUserID(r); status != identityVerified {
					t.Errorf("goroutine %d iteration %d: status = %v, want verified", i, j, status)
				}
			}
		}()
	}
	wg.Wait()
}

// The one-minute expiry leeway is a transitive default (go-jose, via authlib),
// not something this repo sets, so pin it: it matches what Grafana core's own
// verifiers accept, and a silent upstream change either widens the window or
// starts rejecting tokens Grafana considers live.
func TestVerifyIDToken_ExpiryLeeway(t *testing.T) {
	cases := []struct {
		name       string
		expiredAgo time.Duration
		want       identityStatus
	}{
		{name: "inside the leeway", expiredAgo: 30 * time.Second, want: identityVerified},
		{name: "past the leeway", expiredAgo: 2 * time.Minute, want: identityRejected},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			token := makeIDToken(t, "user:1", time.Now().Add(-tt.expiredAgo).Unix())
			if _, status := newTestApp(t).deriveCompletionUserID(identityRequest(t, token)); status != tt.want {
				t.Fatalf("status = %v, want %v", status, tt.want)
			}
		})
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

// --- The stack binding -------------------------------------------------------
//
// auth-api's key set is CELL-WIDE: every Grafana Cloud stack in a cell is signed
// by the same keys, so from #1604 onwards a valid signature proves auth-api
// issued the token and nothing about which stack it was issued FOR. Combined
// with #1568 — `X-Grafana-Id` survives to the plugin whenever the authenticated
// requester has no ID token of its own — a caller on stack B could otherwise
// present their own genuine token from stack A and be served stack A's identity.
// The `namespace` claim, bound to the trusted plugin-context namespace, is what
// closes that.

// makeIDTokenForNamespace signs a token that is valid in every respect except
// that it was minted for the given namespace.
func makeIDTokenForNamespace(t *testing.T, sub, namespace string) string {
	t.Helper()
	return signIDToken(t, idToken{
		sub: sub, exp: time.Now().Add(time.Hour).Unix(), kid: testSigningKeyID,
		typ: "jwt", key: testSigningKey(), namespace: namespace,
	})
}

func TestVerifyIDToken_BindsTokenNamespaceToThePluginContext(t *testing.T) {
	cases := []struct {
		name string
		// The namespace the token was minted for; "" omits the claim.
		tokenNamespace string
		// The server-derived namespace on the plugin context.
		stackNamespace string
		wantID         string
		wantStatus     identityStatus
	}{
		{
			name:           "token minted for this stack verifies",
			tokenNamespace: testNamespace, stackNamespace: testNamespace,
			wantID: "user:abc123", wantStatus: identityVerified,
		},
		{
			name:           "genuine token from a sibling stack is rejected",
			tokenNamespace: "stacks-2", stackNamespace: testNamespace,
			wantStatus: identityRejected,
		},
		{
			name:           "token carrying no namespace claim is rejected",
			tokenNamespace: "", stackNamespace: testNamespace,
			wantStatus: identityRejected,
		},
		{
			// A deployment property, not a token fault: no re-auth populates a
			// missing plugin-context namespace, so it must not take the status
			// the write path defines as retryable.
			name:           "no server-derived namespace is unverifiable, not rejected",
			tokenNamespace: testNamespace, stackNamespace: "",
			wantStatus: identityUnverifiable,
		},
	}

	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			r := identityRequestForNamespace(t,
				makeIDTokenForNamespace(t, "user:abc123", tt.tokenNamespace),
				testGrafanaConfig(), tt.stackNamespace)

			id, status := newTestApp(t).deriveCompletionUserID(r)
			if status != tt.wantStatus {
				t.Fatalf("status = %v, want %v", status, tt.wantStatus)
			}
			if id != tt.wantID {
				t.Fatalf("id = %q, want %q", id, tt.wantID)
			}

			// The catalogue layer takes the same gate: the binding cannot be
			// bypassed by picking the route that needs no subject.
			if got := newTestApp(t).validIDToken(r); got != tt.wantStatus {
				t.Fatalf("validIDToken = %v, want %v", got, tt.wantStatus)
			}
		})
	}
}

// The headline cell-wide case, end to end on the routes that serve per-user and
// per-namespace data: the sibling stack's token is signed by the very key set
// this plugin fetches, so only the binding can refuse it — and no data may be
// served when it does.
func TestIdentityGate_SiblingStackTokenServesNoData(t *testing.T) {
	withSigningKeysURL(t, authAPIJWKS(t))
	withLister(t, singlePageLister(
		rec("user:abc123", "bundled", "guide-a", "Guide A", "interactive", "", "manual", "2026-07-20T14:02:11Z", 100)))
	withGuideLister(t, singlePageGuideLister(guideEntry("fe-guide-1", "Guide one", "published", "guide")))

	cfg := map[string]string{
		featuretoggles.EnabledFeatures: pathfinderBackendAggregationToggle + "," + customGuideAggregationToggle,
		sdkconfig.AppURL:               cloudStack(t),
	}
	siblingToken := makeIDTokenForNamespace(t, "user:abc123", "stacks-2")

	withToken := func(r *http.Request) *http.Request {
		r.Header.Set(backend.GrafanaUserSignInTokenHeaderName, siblingToken)
		return r
	}

	t.Run("custom-guide-repository", func(t *testing.T) {
		rr, body := doCustomGuideReq(t,
			withToken(customGuideRequestWithConfig(t, "/custom-guide-repository", "user:abc123", cfg)))
		if rr.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200 (body %s)", rr.Code, rr.Body.String())
		}
		if body.Capability.Available || body.Capability.Reason != reasonIdentityUnavailable {
			t.Fatalf("available = %v, reason = %q, want reason %q",
				body.Capability.Available, body.Capability.Reason, reasonIdentityUnavailable)
		}
		if len(body.Guides) != 0 {
			t.Fatalf("served %d catalogue guides to a sibling stack's token, want 0", len(body.Guides))
		}
	})

	t.Run("completion-records/my", func(t *testing.T) {
		rr, body := doMyCompletionsReq(t,
			withToken(completionRequestWithConfig(t, "/completion-records/my", "user:abc123", cfg)))
		if rr.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200 (body %s)", rr.Code, rr.Body.String())
		}
		if body.Capability.Available || body.Capability.Reason != reasonIdentityUnavailable {
			t.Fatalf("available = %v, reason = %q, want reason %q",
				body.Capability.Available, body.Capability.Reason, reasonIdentityUnavailable)
		}
		if len(body.Completions) != 0 {
			t.Fatalf("served %d completions to a sibling stack's token, want 0", len(body.Completions))
		}
		if body.UserID != "" {
			t.Fatalf("echoed userId %q for a sibling stack's token, want none", body.UserID)
		}
	})
}
