package sdkingress

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"sync"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/grafana/authlib/authn"
	"github.com/grafana/authlib/types"
	sdkplugin "github.com/grafana/grafana-app-sdk/plugin"
)

type authenticator struct{ verifier *authn.AccessTokenVerifier }

func (a authenticator) Authenticate(ctx context.Context, p authn.TokenProvider) (types.AuthInfo, error) {
	token, ok := p.AccessToken(ctx)
	if !ok {
		return nil, authn.ErrMissingRequiredToken
	}
	claims, err := a.verifier.Verify(ctx, token)
	if err != nil {
		return nil, err
	}
	if claims.Expiry == nil {
		return nil, errors.New("access token missing expiry")
	}
	return authn.NewAccessTokenAuthInfo(*claims), nil
}

type staticKeys map[string]*jose.JSONWebKey

func (s staticKeys) Get(_ context.Context, id string) (*jose.JSONWebKey, error) {
	if key := s[id]; key != nil {
		return key, nil
	}
	return nil, authn.ErrInvalidSigningKey
}

type rotatingKeys struct {
	mu     sync.Mutex
	source string
	now    func() time.Time
	until  time.Time
	keys   authn.KeyRetriever
}

func (r *rotatingKeys) Get(ctx context.Context, id string) (*jose.JSONWebKey, error) {
	r.mu.Lock()
	now := r.now()
	if !now.Before(r.until) {
		client := &http.Client{Timeout: 5 * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error {
			from := via[0].URL
			if len(via) >= 10 || req.URL.Scheme != from.Scheme || req.URL.Host != from.Host {
				return errors.New("untrusted signing key redirect")
			}
			return nil
		}}
		r.keys = authn.NewKeyRetriever(authn.KeyRetrieverConfig{SigningKeysURL: r.source}, authn.WithHTTPClientKeyRetrieverOpt(client))
		r.until = now.Add(5 * time.Minute)
	}
	keys := r.keys
	r.mu.Unlock()
	return keys.Get(ctx, id)
}

func FromEnvironment(pluginID, group string) (authn.Authenticator, error) {
	source := os.Getenv(sdkplugin.EnvVarGrafanaJWKSURL)
	if source == "" {
		source = os.Getenv("GRAFANA_JWKS_URL")
	}
	raw := os.Getenv(sdkplugin.EnvVarGrafanaJWKS)
	if raw == "" {
		raw = os.Getenv("GRAFANA_JWKS")
	}
	var keys authn.KeyRetriever
	switch {
	case source != "" && raw != "":
		return nil, errors.New("configure only one SDK signing key source")
	case source != "":
		u, err := url.Parse(source)
		if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
			return nil, errors.New("invalid SDK signing key URL")
		}
		keys = &rotatingKeys{source: source, now: time.Now}
	case raw != "":
		var set jose.JSONWebKeySet
		if err := json.Unmarshal([]byte(raw), &set); err != nil {
			return nil, fmt.Errorf("invalid SDK signing keys: %w", err)
		}
		if len(set.Keys) == 0 {
			return nil, errors.New("empty SDK signing key set")
		}
		m := staticKeys{}
		for i := range set.Keys {
			key := &set.Keys[i]
			if key.KeyID == "" || !key.Valid() || !key.IsPublic() || (key.Use != "" && key.Use != "sig") || m[key.KeyID] != nil {
				return nil, errors.New("invalid SDK public signing key")
			}
			m[key.KeyID] = key
		}
		keys = m
	default:
		// Older hosts still use the plugin resource adapter; protocol v3 must reject unsigned requests.
		keys = staticKeys{}
	}
	return authenticator{authn.NewAccessTokenVerifier(authn.VerifierConfig{AllowedAudiences: []string{pluginID, group}}, keys)}, nil
}
