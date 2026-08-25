package auth

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/grafana/authlib/authn"
)

// authAPIKeysPath is the path half of DefaultSigningKeysURL, so the stub
// endpoints below sit where the real one does.
const authAPIKeysPath = "/v1/keys"

// The host and path are the whole operational risk of this change: get them
// wrong and the fetch fails rather than answering empty, which every proxy route
// serves as a 503. Pin both, and pin that they share a host with the
// token-exchange endpoint the plugin already reaches in production.
func TestDefaultSigningKeysURL(t *testing.T) {
	const want = "http://api-lb.auth.svc.cluster.local." + authAPIKeysPath
	if DefaultSigningKeysURL != want {
		t.Fatalf("DefaultSigningKeysURL = %q, want %q", DefaultSigningKeysURL, want)
	}
	if !strings.HasPrefix(DefaultTokenExchangeURL, authAPIBaseURL) {
		t.Fatalf("token exchange URL %q does not share the auth-api host %q", DefaultTokenExchangeURL, authAPIBaseURL)
	}
}

func TestSigningKeysURL(t *testing.T) {
	cases := map[string]string{
		"http://grafana.example":              "http://grafana.example/api/signing-keys/keys",
		"http://grafana.example/":             "http://grafana.example/api/signing-keys/keys",
		"https://stack.grafana.net/grafana":   "https://stack.grafana.net/grafana/api/signing-keys/keys",
		"https://stack.grafana.net/grafana//": "https://stack.grafana.net/grafana/api/signing-keys/keys",
	}
	for appURL, want := range cases {
		t.Run(appURL, func(t *testing.T) {
			got, err := signingKeysURL(appURL)
			if err != nil {
				t.Fatalf("signingKeysURL(%q): %v", appURL, err)
			}
			if got != want {
				t.Errorf("signingKeysURL(%q) = %q, want %q", appURL, got, want)
			}
		})
	}
}

// A canceled caller must not fail the JWKS fetch: authlib dedupes it across
// concurrent callers with singleflight, so the leader's cancellation would
// otherwise surface as a signing-keys outage for every waiter too.
func TestVerify_KeyFetchDetachedFromCallerCancellation(t *testing.T) {
	var fetches atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != SigningKeysPath {
			http.NotFound(w, r)
			return
		}
		fetches.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"keys":[]}`))
	}))
	t.Cleanup(server.Close)

	verifier, err := NewIDTokenVerifier("", server.URL)
	if err != nil {
		t.Fatalf("NewIDTokenVerifier(%q): %v", server.URL, err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	if _, err := verifier.Verify(ctx, tokenWithUnpublishedKID(t), testNamespace); err == nil {
		t.Fatal("expected rejection for a kid the JWKS does not publish")
	} else if SigningKeysUnavailable(err) {
		t.Fatalf("caller cancellation leaked into the key fetch: %v", err)
	}
	if got := fetches.Load(); got != 1 {
		t.Fatalf("JWKS fetched %d times, want 1", got)
	}
}

// A redirect off the stack's host must not be followed: whatever origin it
// landed on would supply the key set, and any `sub` signed by that origin's key
// would then verify. A redirect that stays on the host is fine — a legitimate
// http→https hop changes the port, so the guard keys on hostname alone.
func TestVerify_SigningKeysRedirect(t *testing.T) {
	var rogueFetches atomic.Int32
	rogue := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		rogueFetches.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"keys":[]}`))
	}))
	t.Cleanup(rogue.Close)

	const sameHostPath = "/api/other-signing-keys"
	var sameHostFetches atomic.Int32
	stack := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case SigningKeysPath:
			http.Redirect(w, r, rogue.URL+SigningKeysPath, http.StatusFound)
		case "/same-host" + SigningKeysPath:
			http.Redirect(w, r, sameHostPath, http.StatusFound)
		case sameHostPath:
			sameHostFetches.Add(1)
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"keys":[]}`))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(stack.Close)

	// The stack's own host, spelled differently from the rogue server's, so the
	// hostname guard has something to compare. Both listen on the loopback
	// address, which "localhost" also resolves to.
	stackURL, err := url.Parse(stack.URL)
	if err != nil {
		t.Fatalf("parse stack URL: %v", err)
	}
	appURL := "http://localhost:" + stackURL.Port()

	t.Run("off-host redirect refused", func(t *testing.T) {
		verifier, err := NewIDTokenVerifier("", appURL)
		if err != nil {
			t.Fatalf("NewIDTokenVerifier(%q): %v", appURL, err)
		}
		_, err = verifier.Verify(context.Background(), tokenWithUnpublishedKID(t), testNamespace)
		if err == nil {
			t.Fatal("expected the off-host redirect to fail the fetch")
		}
		if !SigningKeysUnavailable(err) {
			t.Fatalf("want a signing-keys fetch failure, got %v", err)
		}
		if got := rogueFetches.Load(); got != 0 {
			t.Fatalf("rogue origin served the key set %d times, want 0", got)
		}
	})

	t.Run("same-host redirect followed", func(t *testing.T) {
		verifier, err := NewIDTokenVerifier("", stack.URL+"/same-host")
		if err != nil {
			t.Fatalf("NewIDTokenVerifier: %v", err)
		}
		_, err = verifier.Verify(context.Background(), tokenWithUnpublishedKID(t), testNamespace)
		if err == nil {
			t.Fatal("expected rejection for a kid the JWKS does not publish")
		}
		if SigningKeysUnavailable(err) {
			t.Fatalf("same-host redirect should have been followed, got %v", err)
		}
		if got := sameHostFetches.Load(); got != 1 {
			t.Fatalf("redirect target fetched %d times, want 1", got)
		}
	})
}

// tokenWithUnpublishedKID is a well-formed ES256 JWT naming a `kid` no JWKS
// publishes, so authlib reaches the key fetch and stops there — before it would
// ever look at the (deliberately bogus) signature.
func tokenWithUnpublishedKID(t *testing.T) string {
	t.Helper()
	enc := func(v any) string {
		b, err := json.Marshal(v)
		if err != nil {
			t.Fatalf("marshal token part: %v", err)
		}
		return base64.RawURLEncoding.EncodeToString(b)
	}
	return enc(map[string]string{"alg": "ES256", "typ": "jwt", "kid": "unpublished"}) + "." +
		enc(map[string]string{"sub": "user:1"}) + "." +
		base64.RawURLEncoding.EncodeToString(make([]byte, 64))
}

// The classifier must be narrow on the outage side: anything it does not
// recognize is treated as a bad token, so a caller is never told "try again
// later" when their token is simply forged.
func TestSigningKeysUnavailable(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want bool
	}{
		{name: "fetch failure", err: authn.ErrFetchingSigningKey, want: true},
		{name: "wrapped fetch failure", err: errors.Join(errors.New("get keys"), authn.ErrFetchingSigningKey), want: true},
		{name: "expired token", err: authn.ErrExpiredToken},
		{name: "unparseable token", err: authn.ErrParseToken},
		{name: "unrecognized signing key", err: authn.ErrInvalidSigningKey},
		{name: "wrong token type", err: authn.ErrInvalidTokenType},
		{name: "no exp claim", err: ErrMissingExpiry},
		{name: "unknown error", err: errors.New("boom")},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			if got := SigningKeysUnavailable(tt.err); got != tt.want {
				t.Errorf("SigningKeysUnavailable(%v) = %v, want %v", tt.err, got, tt.want)
			}
		})
	}
}

// --- Source-chain fixtures ---------------------------------------------------
//
// The verifier resolves a `kid` against auth-api first and the stack's own
// signing-keys endpoint second. These tests sign real ES256 tokens and serve the
// matching public key from local JWKS endpoints, so nothing sits between the
// verifier and authlib: a token accepted here is accepted for the same reason
// production would accept it.

const testKID = "pathfinder-test-key"

// testNamespace is the stack this test binary's tokens are minted for, in
// Grafana's '<type>-<id>' namespace form.
const testNamespace = "stacks-1"

func newSigningKey(t *testing.T) *ecdsa.PrivateKey {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate signing key: %v", err)
	}
	return key
}

func jwksBody(t *testing.T, kid string, key *ecdsa.PrivateKey) []byte {
	t.Helper()
	point, err := key.PublicKey.Bytes()
	if err != nil {
		t.Fatalf("encode public key: %v", err)
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
		t.Fatalf("marshal JWKS: %v", err)
	}
	return body
}

// emptyKeySet is what a Grafana Cloud stack actually serves at
// SigningKeysPath: a 200 carrying a null key list.
var emptyKeySet = []byte(`{"keys":null}`)

// jwksServer serves body at path and 404s everything else.
func jwksServer(t *testing.T, path string, body []byte) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != path {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(body)
	}))
	t.Cleanup(server.Close)
	return server
}

// unreachableURL is an origin nothing listens on, so a fetch fails outright
// rather than answering with an empty key set.
func unreachableURL(t *testing.T) string {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	server.Close()
	return server.URL
}

// signToken ES256-signs a well-formed ID token naming kid, minted for
// testNamespace.
func signToken(t *testing.T, kid string, key *ecdsa.PrivateKey) string {
	t.Helper()
	return signTokenForNamespace(t, kid, key, testNamespace)
}

// signTokenForNamespace is signToken with the `namespace` claim under the
// caller's control; namespace == "" omits the claim entirely.
func signTokenForNamespace(t *testing.T, kid string, key *ecdsa.PrivateKey, namespace string) string {
	t.Helper()
	header, err := json.Marshal(map[string]string{"alg": "ES256", "typ": "jwt", "kid": kid})
	if err != nil {
		t.Fatalf("marshal header: %v", err)
	}
	claimSet := map[string]any{"sub": "user:1", "exp": time.Now().Add(time.Hour).Unix()}
	if namespace != "" {
		claimSet["namespace"] = namespace
	}
	claims, err := json.Marshal(claimSet)
	if err != nil {
		t.Fatalf("marshal claims: %v", err)
	}
	signingInput := base64.RawURLEncoding.EncodeToString(header) + "." + base64.RawURLEncoding.EncodeToString(claims)
	digest := sha256.Sum256([]byte(signingInput))
	r, s, err := ecdsa.Sign(rand.Reader, key, digest[:])
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	// JWS ES256 signatures are the fixed-width R‖S pair, not ecdsa.SignASN1's
	// ASN.1 encoding.
	sig := append(r.FillBytes(make([]byte, 32)), s.FillBytes(make([]byte, 32))...)
	return signingInput + "." + base64.RawURLEncoding.EncodeToString(sig)
}

// --- The source chain --------------------------------------------------------

// Grafana Cloud signs ID tokens at auth-api and its stacks publish nothing;
// self-hosted Grafana signs its own and publishes them. Both sources are full
// ES256 verification, so every combination below either verifies a genuinely
// signed token or refuses one, and none of them degrades to a structural check.
func TestNewIDTokenVerifier_SourceChain(t *testing.T) {
	signingKey := newSigningKey(t)
	foreignKey := newSigningKey(t)

	authAPIKeys := func(t *testing.T) string {
		return jwksServer(t, authAPIKeysPath, jwksBody(t, testKID, signingKey)).URL + authAPIKeysPath
	}
	authAPIEmpty := func(t *testing.T) string {
		return jwksServer(t, authAPIKeysPath, emptyKeySet).URL + authAPIKeysPath
	}
	authAPIDown := func(t *testing.T) string { return unreachableURL(t) + authAPIKeysPath }

	stackKeys := func(t *testing.T) string {
		return jwksServer(t, SigningKeysPath, jwksBody(t, testKID, signingKey)).URL
	}
	stackEmpty := func(t *testing.T) string {
		return jwksServer(t, SigningKeysPath, emptyKeySet).URL
	}
	stackDown := func(t *testing.T) string { return unreachableURL(t) }
	noStack := func(*testing.T) string { return "" }

	cases := []struct {
		name string
		// what each source is doing
		authAPI, stack func(*testing.T) string
		// the token presented
		token func(*testing.T) string
		// expectations
		wantVerified bool
		wantOutage   bool
	}{
		{
			name: "grafana cloud: auth-api serves the key, stack publishes none",
			// The shape this fix exists for. Before it, the empty stack key set
			// was the only source and every caller was reported unavailable.
			authAPI: authAPIKeys, stack: stackEmpty,
			token:        func(t *testing.T) string { return signToken(t, testKID, signingKey) },
			wantVerified: true,
		},
		{
			name:    "self-hosted: auth-api absent, the stack serves the key",
			authAPI: authAPIDown, stack: stackKeys,
			token:        func(t *testing.T) string { return signToken(t, testKID, signingKey) },
			wantVerified: true,
		},
		{
			name:    "self-hosted: auth-api answers with no keys, the stack serves the key",
			authAPI: authAPIEmpty, stack: stackKeys,
			token:        func(t *testing.T) string { return signToken(t, testKID, signingKey) },
			wantVerified: true,
		},
		{
			name:    "no stack app URL: auth-api alone verifies",
			authAPI: authAPIKeys, stack: noStack,
			token:        func(t *testing.T) string { return signToken(t, testKID, signingKey) },
			wantVerified: true,
		},
		{
			name: "both sources answer with no keys: rejected, not an outage",
			// The `kid` is genuinely unknown, so the caller must be told their
			// token is unacceptable rather than told to retry.
			authAPI: authAPIEmpty, stack: stackEmpty,
			token: func(t *testing.T) string { return signToken(t, testKID, signingKey) },
		},
		{
			name: "auth-api unreachable and the stack has no keys: rejected, not an outage",
			// A wrong auth-api host must degrade to the pre-existing soft
			// refusal, never to a hard 503 across every proxy route.
			authAPI: authAPIDown, stack: stackEmpty,
			token: func(t *testing.T) string { return signToken(t, testKID, signingKey) },
		},
		{
			name:    "no source reachable: a retryable outage",
			authAPI: authAPIDown, stack: stackDown,
			token:      func(t *testing.T) string { return signToken(t, testKID, signingKey) },
			wantOutage: true,
		},
		{
			name: "token signed by a key no source publishes is refused",
			// #1568's forged header, under a `kid` both sources do publish: the
			// key is found and the signature does not match it.
			authAPI: authAPIKeys, stack: stackKeys,
			token: func(t *testing.T) string { return signToken(t, testKID, foreignKey) },
		},
		{
			name:    "token naming an unpublished kid is refused",
			authAPI: authAPIKeys, stack: stackKeys,
			token: func(t *testing.T) string { return signToken(t, "not-a-real-key", signingKey) },
		},
	}

	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			verifier, err := NewIDTokenVerifier(tt.authAPI(t), tt.stack(t))
			if err != nil {
				t.Fatalf("NewIDTokenVerifier: %v", err)
			}
			sub, err := verifier.Verify(context.Background(), tt.token(t), testNamespace)

			if tt.wantVerified {
				if err != nil {
					t.Fatalf("Verify: %v", err)
				}
				if sub != "user:1" {
					t.Fatalf("sub = %q, want %q", sub, "user:1")
				}
				return
			}
			if err == nil {
				t.Fatal("expected the token to be refused")
			}
			if got := SigningKeysUnavailable(err); got != tt.wantOutage {
				t.Fatalf("SigningKeysUnavailable = %v, want %v (err: %v)", got, tt.wantOutage, err)
			}
		})
	}
}

// auth-api is the issuer wherever it answers, so its key set decides. Both
// sources publish a key under the same `kid` here; only auth-api's verifies.
func TestNewIDTokenVerifier_AuthAPIWinsOverTheStack(t *testing.T) {
	authAPIKey := newSigningKey(t)
	stackKey := newSigningKey(t)

	authAPI := jwksServer(t, authAPIKeysPath, jwksBody(t, testKID, authAPIKey))
	stack := jwksServer(t, SigningKeysPath, jwksBody(t, testKID, stackKey))

	verifier, err := NewIDTokenVerifier(authAPI.URL+authAPIKeysPath, stack.URL)
	if err != nil {
		t.Fatalf("NewIDTokenVerifier: %v", err)
	}

	if _, err := verifier.Verify(context.Background(), signToken(t, testKID, authAPIKey), testNamespace); err != nil {
		t.Fatalf("auth-api-signed token: %v", err)
	}
	if _, err := verifier.Verify(context.Background(), signToken(t, testKID, stackKey), testNamespace); err == nil {
		t.Fatal("stack-signed token verified under a kid auth-api already claims")
	}
}

// A verifier with nowhere to look would report every caller unverifiable, which
// reads as a standing property of the stack. Fail to build instead.
func TestNewIDTokenVerifier_NoSource(t *testing.T) {
	if _, err := NewIDTokenVerifier("", ""); err == nil {
		t.Fatal("expected an error when neither source is configured")
	}
}

// --- The stack binding -------------------------------------------------------
//
// auth-api's key set is cell-wide: every Grafana Cloud stack in a cell is signed
// by the same keys, so a valid signature proves auth-api issued the token and
// nothing about which stack it was issued FOR. The `namespace` claim carries
// that, and Verify binds it to the server-derived namespace.

func TestVerify_BindsNamespaceToTheStack(t *testing.T) {
	signingKey := newSigningKey(t)
	authAPI := jwksServer(t, authAPIKeysPath, jwksBody(t, testKID, signingKey)).URL + authAPIKeysPath

	cases := []struct {
		name string
		// The namespace the token is minted for; "" omits the claim.
		tokenNamespace string
		// The server-derived namespace the caller binds against.
		expected     string
		wantVerified bool
	}{
		{
			name:           "token minted for this stack verifies",
			tokenNamespace: testNamespace, expected: testNamespace, wantVerified: true,
		},
		{
			// The headline case: a genuine, correctly signed, unexpired token
			// from a sibling stack in the same cell. Nothing about the signature
			// is wrong — the binding is what refuses it.
			name:           "genuine token from a sibling stack is refused",
			tokenNamespace: "stacks-2", expected: testNamespace,
		},
		{
			name:           "token carrying no namespace claim is refused",
			tokenNamespace: "", expected: testNamespace,
		},
		{
			name:           "no server-derived namespace fails closed",
			tokenNamespace: testNamespace, expected: "",
		},
	}

	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			verifier, err := NewIDTokenVerifier(authAPI, "")
			if err != nil {
				t.Fatalf("NewIDTokenVerifier: %v", err)
			}
			token := signTokenForNamespace(t, testKID, signingKey, tt.tokenNamespace)

			sub, err := verifier.Verify(context.Background(), token, tt.expected)
			if tt.wantVerified {
				if err != nil {
					t.Fatalf("Verify: %v", err)
				}
				if sub != "user:1" {
					t.Fatalf("sub = %q, want %q", sub, "user:1")
				}
				return
			}
			if err == nil {
				t.Fatalf("expected refusal, got sub %q", sub)
			}
			if SigningKeysUnavailable(err) {
				t.Fatalf("a namespace refusal must not read as an outage: %v", err)
			}
		})
	}
}

// The gate logs both namespaces, so the mismatch has to be recoverable from the
// error rather than folded into a message.
func TestVerify_NamespaceMismatchCarriesBothNamespaces(t *testing.T) {
	signingKey := newSigningKey(t)
	authAPI := jwksServer(t, authAPIKeysPath, jwksBody(t, testKID, signingKey)).URL + authAPIKeysPath
	verifier, err := NewIDTokenVerifier(authAPI, "")
	if err != nil {
		t.Fatalf("NewIDTokenVerifier: %v", err)
	}

	_, err = verifier.Verify(context.Background(),
		signTokenForNamespace(t, testKID, signingKey, "stacks-2"), testNamespace)

	var mismatch *NamespaceMismatchError
	if !errors.As(err, &mismatch) {
		t.Fatalf("err = %v, want a *NamespaceMismatchError", err)
	}
	if mismatch.Got != "stacks-2" || mismatch.Want != testNamespace {
		t.Fatalf("mismatch = {Got: %q, Want: %q}, want {%q, %q}",
			mismatch.Got, mismatch.Want, "stacks-2", testNamespace)
	}
}

func TestVerify_NoExpectedNamespaceIsReportedDistinctly(t *testing.T) {
	signingKey := newSigningKey(t)
	authAPI := jwksServer(t, authAPIKeysPath, jwksBody(t, testKID, signingKey)).URL + authAPIKeysPath
	verifier, err := NewIDTokenVerifier(authAPI, "")
	if err != nil {
		t.Fatalf("NewIDTokenVerifier: %v", err)
	}

	_, err = verifier.Verify(context.Background(), signToken(t, testKID, signingKey), "")
	if !errors.Is(err, ErrUnknownNamespace) {
		t.Fatalf("err = %v, want ErrUnknownNamespace", err)
	}
}

// --- Per-source budget -------------------------------------------------------

// A stalling first source must not consume the budget the second one needs.
// Self-hosted Grafana resolving api-lb.auth.svc.cluster.local. to somewhere that
// accepts and then hangs would otherwise turn a stack publishing a perfectly
// good key set into a hard 503 on every proxy route.
func TestVerify_StallingSourceLeavesTheNextOneTimeToAnswer(t *testing.T) {
	withFetchTimeout(t, 600*time.Millisecond)

	signingKey := newSigningKey(t)
	// Stalls until its request context is canceled, so the source's own share of
	// the budget is what ends it — a refused connection would fail fast and prove
	// nothing.
	stalling := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		<-r.Context().Done()
	}))
	t.Cleanup(stalling.Close)
	stack := jwksServer(t, SigningKeysPath, jwksBody(t, testKID, signingKey))

	verifier, err := NewIDTokenVerifier(stalling.URL+authAPIKeysPath, stack.URL)
	if err != nil {
		t.Fatalf("NewIDTokenVerifier: %v", err)
	}

	sub, err := verifier.Verify(context.Background(), signToken(t, testKID, signingKey), testNamespace)
	if err != nil {
		t.Fatalf("Verify: %v (signing-keys outage: %v)", err, SigningKeysUnavailable(err))
	}
	if sub != "user:1" {
		t.Fatalf("sub = %q, want %q", sub, "user:1")
	}
}

// The per-source share must not lift the ceiling on the chain as a whole: the
// identity gate runs inline on every proxy route and cannot be allowed to hang.
func TestVerify_WholeChainStaysBounded(t *testing.T) {
	const budget = 400 * time.Millisecond
	withFetchTimeout(t, budget)

	stalling := func(t *testing.T) *httptest.Server {
		t.Helper()
		server := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
			<-r.Context().Done()
		}))
		t.Cleanup(server.Close)
		return server
	}

	verifier, err := NewIDTokenVerifier(stalling(t).URL+authAPIKeysPath, stalling(t).URL)
	if err != nil {
		t.Fatalf("NewIDTokenVerifier: %v", err)
	}

	start := time.Now()
	_, err = verifier.Verify(context.Background(), signToken(t, testKID, newSigningKey(t)), testNamespace)
	elapsed := time.Since(start)

	if !SigningKeysUnavailable(err) {
		t.Fatalf("err = %v, want a signing-keys outage when no source answers", err)
	}
	if elapsed > 4*budget {
		t.Fatalf("chain took %v, want it bounded near the %v budget", elapsed, budget)
	}
}

// withFetchTimeout shrinks the chain's budget for one test, so a stalling source
// costs milliseconds rather than seconds.
func withFetchTimeout(t *testing.T, d time.Duration) {
	t.Helper()
	previous := signingKeysFetchTimeout
	signingKeysFetchTimeout = d
	t.Cleanup(func() { signingKeysFetchTimeout = previous })
}

// --- Naming the source that failed -------------------------------------------
//
// The identity gate serves no data when a key lookup comes up empty, so its log
// line is the only diagnosis available. The per-source cause has to survive out
// of the chain in a form the gate can log as its own field, or an operator is
// left guessing which of the two endpoints failed and how.

func TestVerify_SigningKeysErrorNamesEverySource(t *testing.T) {
	signingKey := newSigningKey(t)

	cases := []struct {
		name string
		// authAPI and stack describe what each source is doing.
		authAPI, stack  func(*testing.T) string
		wantUnreachable bool
	}{
		{
			name:    "no source answers",
			authAPI: func(t *testing.T) string { return unreachableURL(t) + authAPIKeysPath },
			stack:   func(t *testing.T) string { return unreachableURL(t) },
			// Nothing was reached, so the address itself is in question.
			wantUnreachable: true,
		},
		{
			name: "both sources answer with no keys",
			authAPI: func(t *testing.T) string {
				return jwksServer(t, authAPIKeysPath, emptyKeySet).URL + authAPIKeysPath
			},
			stack: func(t *testing.T) string { return jwksServer(t, SigningKeysPath, emptyKeySet).URL },
		},
	}

	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			verifier, err := NewIDTokenVerifier(tt.authAPI(t), tt.stack(t))
			if err != nil {
				t.Fatalf("NewIDTokenVerifier: %v", err)
			}

			_, err = verifier.Verify(context.Background(), signToken(t, testKID, signingKey), testNamespace)

			var keysErr *SigningKeysError
			if !errors.As(err, &keysErr) {
				t.Fatalf("err = %v, want a *SigningKeysError", err)
			}
			if got := SigningKeysUnavailable(err); got != tt.wantUnreachable {
				t.Fatalf("SigningKeysUnavailable = %v, want %v (err: %v)", got, tt.wantUnreachable, err)
			}

			names := make([]string, 0, len(keysErr.Sources))
			for _, source := range keysErr.Sources {
				if source.Cause == "" {
					t.Errorf("source %q carries no cause", source.Name)
				}
				names = append(names, source.Name)
			}
			if len(names) != 2 || names[0] != "auth-api" || names[1] != "stack" {
				t.Fatalf("sources = %v, want [auth-api stack] in chain order", names)
			}
			for _, name := range names {
				if !strings.Contains(keysErr.SourceDetail(), name+": ") {
					t.Errorf("SourceDetail() = %q, does not name source %q", keysErr.SourceDetail(), name)
				}
			}
		})
	}
}

// A source that answered must never let an unreachable one's fetch failure
// reach errors.Is: that would report a token no key set knows as an address
// problem, sending an operator after the wrong fault.
func TestVerify_AnsweringSourceHidesAnUnreachableOnesFetchError(t *testing.T) {
	verifier, err := NewIDTokenVerifier(
		unreachableURL(t)+authAPIKeysPath,
		jwksServer(t, SigningKeysPath, emptyKeySet).URL,
	)
	if err != nil {
		t.Fatalf("NewIDTokenVerifier: %v", err)
	}

	_, err = verifier.Verify(context.Background(), signToken(t, testKID, newSigningKey(t)), testNamespace)
	if SigningKeysUnavailable(err) {
		t.Fatalf("an answering source must keep this a rejection, got %v", err)
	}
	if !errors.Is(err, authn.ErrInvalidSigningKey) {
		t.Fatalf("err = %v, want ErrInvalidSigningKey", err)
	}
}
