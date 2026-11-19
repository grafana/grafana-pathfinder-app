package sdkingress

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"
	"github.com/grafana/authlib/authn"
	"github.com/stretchr/testify/require"
)

func TestVerifiedAccessRequiresExpiryAndAudience(t *testing.T) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)
	set, err := json.Marshal(jose.JSONWebKeySet{Keys: []jose.JSONWebKey{{KeyID: "current", Key: &key.PublicKey}}})
	require.NoError(t, err)
	t.Setenv("GF_JWKS", string(set))
	for _, n := range []string{"GF_JWKS_URL", "GRAFANA_JWKS_URL"} {
		t.Setenv(n, "")
	}
	gate, err := FromEnvironment("plugin", "group")
	require.NoError(t, err)
	signer, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.ES256, Key: key}, (&jose.SignerOptions{}).WithType("at+jwt").WithHeader("kid", "current"))
	require.NoError(t, err)
	for _, tc := range []struct {
		aud string
		exp *jwt.NumericDate
		ok  bool
	}{{"plugin", jwt.NewNumericDate(time.Now().Add(time.Hour)), true}, {"group", jwt.NewNumericDate(time.Now().Add(time.Hour)), true}, {"group", nil, false}, {"other", jwt.NewNumericDate(time.Now().Add(time.Hour)), false}} {
		token, err := jwt.Signed(signer).Claims(jwt.Claims{Subject: "user:42", Audience: jwt.Audience{tc.aud}, Expiry: tc.exp}).Claims(authn.AccessTokenClaims{Namespace: "stacks-1"}).Serialize()
		require.NoError(t, err)
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.Header.Set("X-Access-Token", token)
		info, err := gate.Authenticate(req.Context(), authn.NewHTTPTokenProvider(req))
		if tc.ok {
			require.NoError(t, err)
			require.Equal(t, "stacks-1", info.GetNamespace())
		} else {
			require.Error(t, err)
		}
	}
}
func TestRemovedRemoteKeyAndOffOriginRedirect(t *testing.T) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)
	set := jose.JSONWebKeySet{Keys: []jose.JSONWebKey{{KeyID: "old", Key: &key.PublicKey}}}
	var removed atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if removed.Load() {
			_, _ = w.Write([]byte(`{"keys":[]}`))
			return
		}
		_ = json.NewEncoder(w).Encode(set)
	}))
	defer server.Close()
	now := time.Now()
	keys := rotatingKeys{source: server.URL, now: func() time.Time { return now }}
	_, err = keys.Get(context.Background(), "old")
	require.NoError(t, err)
	removed.Store(true)
	now = now.Add(5 * time.Minute)
	_, err = keys.Get(context.Background(), "old")
	require.Error(t, err)
	var reached atomic.Bool
	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { reached.Store(true); _ = json.NewEncoder(w).Encode(set) }))
	defer other.Close()
	redirect := httptest.NewServer(http.RedirectHandler(other.URL, http.StatusTemporaryRedirect))
	defer redirect.Close()
	remote := rotatingKeys{source: redirect.URL, now: time.Now}
	_, err = remote.Get(context.Background(), "old")
	require.Error(t, err)
	require.False(t, reached.Load())
}
