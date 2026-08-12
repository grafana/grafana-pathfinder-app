package auth

import (
	"errors"
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
