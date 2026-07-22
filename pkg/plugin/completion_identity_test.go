package plugin

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"testing"
	"time"
)

// makeIDToken builds a JWT with the given claims. The signature segment is
// filler — the proxy validates structurally and trusts Grafana's forwarding
// boundary (see deriveCompletionUserID), so tests need no real signing key.
func makeIDToken(t *testing.T, sub string, exp int64) string {
	t.Helper()
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"RS256","typ":"JWT"}`))
	claims := map[string]any{}
	if sub != "" {
		claims["sub"] = sub
	}
	if exp != 0 {
		claims["exp"] = exp
	}
	payloadBytes, err := json.Marshal(claims)
	if err != nil {
		t.Fatalf("marshal claims: %v", err)
	}
	payload := base64.RawURLEncoding.EncodeToString(payloadBytes)
	sig := base64.RawURLEncoding.EncodeToString([]byte("signature"))
	return header + "." + payload + "." + sig
}

func TestDeriveCompletionUserID(t *testing.T) {
	withFrozenTime(t, time.Unix(1_600_000_000, 0))

	tests := []struct {
		name   string
		header string
		wantID string
		wantOK bool
	}{
		{
			name:   "valid token yields verbatim typed subject",
			header: makeIDToken(t, "user:abc123", 1_600_000_500),
			wantID: "user:abc123",
			wantOK: true,
		},
		{
			name:   "typed prefix preserved verbatim",
			header: makeIDToken(t, "service-account:xyz", 0),
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
			header: makeIDToken(t, "", 1_600_000_500),
			wantOK: false,
		},
		{
			name:   "expired token fails closed",
			header: makeIDToken(t, "user:abc123", 1_599_999_999),
			wantOK: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r, _ := http.NewRequest(http.MethodGet, "/completion-records/my", nil)
			if tt.header != "" {
				r.Header.Set(grafanaIDTokenHeader, tt.header)
			}
			id, ok := deriveCompletionUserID(r)
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
	withFrozenTime(t, time.Unix(1_600_000_000, 0))
	r, _ := http.NewRequest(http.MethodGet, "/completion-records/my", nil)
	r.Header.Set("X-Grafana-User", "admin")
	r.Header.Set("X-Grafana-Id", "garbage")
	if id, ok := deriveCompletionUserID(r); ok {
		t.Fatalf("expected fail-closed, got id=%q ok=true", id)
	}
}
