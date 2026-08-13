package auth

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"
)

const testKeyID = "test-key-1"

func generateTestKey(t *testing.T) *ecdsa.PrivateKey {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate test key: %v", err)
	}
	return key
}

// startJWKSServer serves the given public key at /api/signing-keys/keys,
// mirroring Grafana's own unauthenticated signing-keys endpoint.
func startJWKSServer(t *testing.T, kid string, key *ecdsa.PrivateKey) *httptest.Server {
	t.Helper()
	jwks := jose.JSONWebKeySet{Keys: []jose.JSONWebKey{
		{Key: key.Public(), KeyID: kid, Algorithm: "ES256", Use: "sig"},
	}}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(jwks)
	}))
	t.Cleanup(srv.Close)
	return srv
}

// signToken builds a real ES256-signed JWT with the given header/claim
// overrides (exp zero-value omits the claim).
func signToken(t *testing.T, key *ecdsa.PrivateKey, kid, typ, sub string, exp time.Time) string {
	t.Helper()
	signer, err := jose.NewSigner(jose.SigningKey{
		Algorithm: jose.ES256,
		Key:       jose.JSONWebKey{Key: key, KeyID: kid, Algorithm: string(jose.ES256), Use: "sig"},
	}, (&jose.SignerOptions{}).WithType(jose.ContentType(typ)))
	if err != nil {
		t.Fatalf("build signer: %v", err)
	}

	claims := map[string]any{}
	if sub != "" {
		claims["sub"] = sub
	}
	if !exp.IsZero() {
		claims["exp"] = exp.Unix()
	}
	token, err := jwt.Signed(signer).Claims(claims).Serialize()
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	return token
}

func TestIdentityVerifier_ValidTokenAccepted(t *testing.T) {
	key := generateTestKey(t)
	srv := startJWKSServer(t, testKeyID, key)
	token := signToken(t, key, testKeyID, "jwt", "user:abc123", time.Now().Add(time.Hour))

	v := NewIdentityVerifier()
	sub, err := v.VerifySubject(context.Background(), srv.URL, token)
	if err != nil {
		t.Fatalf("VerifySubject: %v", err)
	}
	if sub != "user:abc123" {
		t.Errorf("sub = %q, want %q", sub, "user:abc123")
	}
}

func TestIdentityVerifier_ForgedSignatureRejected(t *testing.T) {
	legitKey := generateTestKey(t)
	forgedKey := generateTestKey(t)
	srv := startJWKSServer(t, testKeyID, legitKey)
	// Signed with a different key than the one published under this kid.
	token := signToken(t, forgedKey, testKeyID, "jwt", "user:abc123", time.Now().Add(time.Hour))

	v := NewIdentityVerifier()
	if _, err := v.VerifySubject(context.Background(), srv.URL, token); err == nil {
		t.Fatal("expected forged signature to be rejected")
	}
}

func TestIdentityVerifier_UnknownKidRejected(t *testing.T) {
	key := generateTestKey(t)
	srv := startJWKSServer(t, testKeyID, key)
	token := signToken(t, key, "some-other-kid", "jwt", "user:abc123", time.Now().Add(time.Hour))

	v := NewIdentityVerifier()
	if _, err := v.VerifySubject(context.Background(), srv.URL, token); err == nil {
		t.Fatal("expected unknown kid to be rejected")
	}
}

func TestIdentityVerifier_WrongTypeRejected(t *testing.T) {
	key := generateTestKey(t)
	srv := startJWKSServer(t, testKeyID, key)
	// authlib's ID token verifier requires typ == "jwt" exactly (case-sensitive).
	token := signToken(t, key, testKeyID, "JWT", "user:abc123", time.Now().Add(time.Hour))

	v := NewIdentityVerifier()
	if _, err := v.VerifySubject(context.Background(), srv.URL, token); err == nil {
		t.Fatal("expected wrong typ header to be rejected")
	}
}

func TestIdentityVerifier_ExpiredRejected(t *testing.T) {
	key := generateTestKey(t)
	srv := startJWKSServer(t, testKeyID, key)
	// Well past go-jose's default one-minute leeway.
	token := signToken(t, key, testKeyID, "jwt", "user:abc123", time.Now().Add(-2*time.Minute))

	v := NewIdentityVerifier()
	if _, err := v.VerifySubject(context.Background(), srv.URL, token); err == nil {
		t.Fatal("expected expired token to be rejected")
	}
}

// TestIdentityVerifier_MissingExpiryRejected pins the gotcha this verifier
// exists to guard against: go-jose's own claims validation only rejects an
// expired token when `exp` is present at all (`if c.Expiry != nil` in
// jwt/validation.go) — a token with no exp claim otherwise sails through as
// "non-expiring". VerifySubject must reject it anyway.
func TestIdentityVerifier_MissingExpiryRejected(t *testing.T) {
	key := generateTestKey(t)
	srv := startJWKSServer(t, testKeyID, key)
	token := signToken(t, key, testKeyID, "jwt", "user:abc123", time.Time{}) // no exp claim

	v := NewIdentityVerifier()
	if _, err := v.VerifySubject(context.Background(), srv.URL, token); err == nil {
		t.Fatal("expected missing exp claim to be rejected")
	}
}

// TestIdentityVerifier_JWKSUnreachableFailsClosed proves an unreachable JWKS
// endpoint is a hard failure, not a silent pass — the fail-closed default
// this whole verifier is built around.
func TestIdentityVerifier_JWKSUnreachableFailsClosed(t *testing.T) {
	key := generateTestKey(t)
	token := signToken(t, key, testKeyID, "jwt", "user:abc123", time.Now().Add(time.Hour))

	v := NewIdentityVerifier()
	if _, err := v.VerifySubject(context.Background(), "http://127.0.0.1:1", token); err == nil {
		t.Fatal("expected unreachable JWKS to fail closed")
	}
}

func TestIdentityVerifier_EmptyInputsRejected(t *testing.T) {
	v := NewIdentityVerifier()
	if _, err := v.VerifySubject(context.Background(), "", "token"); err == nil {
		t.Error("expected empty app URL to be rejected")
	}
	if _, err := v.VerifySubject(context.Background(), "http://example.com", ""); err == nil {
		t.Error("expected empty token to be rejected")
	}
}

// TestIdentityVerifier_CachesPerAppURL is a light sanity check that
// verifiers are reused (not rebuilt) per app URL, matching the "lazily built,
// appURL-keyed" contract this type exists to provide.
func TestIdentityVerifier_CachesPerAppURL(t *testing.T) {
	v := NewIdentityVerifier()
	first := v.verifierFor("http://a.example")
	second := v.verifierFor("http://a.example")
	third := v.verifierFor("http://b.example")

	if first != second {
		t.Error("expected the same app URL to reuse the same verifier instance")
	}
	if first == third {
		t.Error("expected a different app URL to get its own verifier instance")
	}
}
