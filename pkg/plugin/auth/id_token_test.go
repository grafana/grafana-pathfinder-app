package auth

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync/atomic"
	"testing"

	"github.com/grafana/authlib/authn"
)

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

	verifier, err := NewIDTokenVerifier(server.URL)
	if err != nil {
		t.Fatalf("NewIDTokenVerifier(%q): %v", server.URL, err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	if _, err := verifier.Verify(ctx, tokenWithUnpublishedKID(t)); err == nil {
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
		verifier, err := NewIDTokenVerifier(appURL)
		if err != nil {
			t.Fatalf("NewIDTokenVerifier(%q): %v", appURL, err)
		}
		_, err = verifier.Verify(context.Background(), tokenWithUnpublishedKID(t))
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
		verifier, err := NewIDTokenVerifier(stack.URL + "/same-host")
		if err != nil {
			t.Fatalf("NewIDTokenVerifier: %v", err)
		}
		_, err = verifier.Verify(context.Background(), tokenWithUnpublishedKID(t))
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
