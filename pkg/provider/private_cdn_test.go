package provider

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	authlib "github.com/grafana/authlib/types"
	"github.com/grafana/grafana-app-sdk/app"
	sdkplugin "github.com/grafana/grafana-app-sdk/plugin"
	"github.com/grafana/grafana-app-sdk/resource"
	"github.com/stretchr/testify/require"
	"k8s.io/client-go/rest"
)

func privateCDNIdentity(namespace, subject, token string) context.Context {
	return authlib.WithAuthInfo(context.Background(), adminIdentity{
		completionIdentity: completionIdentity{testIdentity: testIdentity{namespace: namespace}, subject: subject},
		accessToken:        token,
	})
}

func privateCDNRequest(method, namespace, body string) *app.CustomRouteRequest {
	return &app.CustomRouteRequest{Method: method, URL: &url.URL{}, Body: io.NopCloser(strings.NewReader(body)), ResourceIdentifier: resource.FullIdentifier{Version: "v1alpha1", Namespace: namespace}}
}

func TestPrivateCDNDelegatesUsingSDKTransport(t *testing.T) {
	var exchanges, signed atomic.Int32
	exchange := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			Namespace    string   `json:"namespace"`
			Audiences    []string `json:"audiences"`
			SubjectToken string   `json:"subjectToken"`
		}
		require.NoError(t, json.NewDecoder(r.Body).Decode(&input))
		require.Equal(t, "stacks-1", input.Namespace)
		require.Equal(t, []string{privateCDNAudience}, input.Audiences)
		require.Equal(t, "trusted-caller-token", input.SubjectToken)
		exchanges.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"data":{"token":"delegated-token"}}`)
	}))
	defer exchange.Close()
	signer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "Bearer delegated-token", r.Header.Get("Authorization"))
		require.Equal(t, "delegated-token", r.Header.Get("X-Access-Token"))
		require.Empty(t, r.Header.Get("Cookie"))
		require.Empty(t, r.Header.Get("X-Grafana-Id"))
		require.Equal(t, "/sign", r.URL.Path)
		signed.Add(1)
		_, _ = io.WriteString(w, `{"url":"https://interactive-learning-private.grafana-dev.net/test","source":"private-cdn"}`)
	}))
	defer signer.Close()
	t.Setenv("PATHFINDER_PRIVATE_CDN_NAMESPACE", "stacks-1")
	t.Setenv(sdkplugin.EnvVarAPIAccessCAPToken, "synthetic-cap")
	t.Setenv(sdkplugin.EnvVarAPIAccessTokenExchangeURL, exchange.URL)
	client, err := privateCDNFromEnvironment()
	require.NoError(t, err)
	client.baseURL = signer.URL
	w := httptest.NewRecorder()
	ctx := privateCDNIdentity("stacks-1", "user:one", "trusted-caller-token")
	req := privateCDNRequest("POST", "stacks-1", `{"guide":"`+privateCDNGuide+`","asset":"content.json"}`)
	require.NoError(t, privateCDNHandler(client, "sign")(ctx, w, req))
	require.Equal(t, 200, w.Code)
	require.EqualValues(t, 1, exchanges.Load())
	require.EqualValues(t, 1, signed.Load())
	require.NotContains(t, w.Body.String(), "delegated-token")
	require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
}

func TestPrivateCDNRejectsBeforeNetwork(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name, subject, identityNamespace, routeNamespace, token, method, body, query string
		status                                                                       int
	}{
		{name: "anonymous", status: 401},
		{name: "no signed token", subject: "user:one", identityNamespace: "stacks-1", routeNamespace: "stacks-1", status: 403},
		{name: "service account", subject: "service-account:one", identityNamespace: "stacks-1", routeNamespace: "stacks-1", token: "trusted", status: 403},
		{name: "cross namespace", subject: "user:one", identityNamespace: "stacks-2", routeNamespace: "stacks-1", token: "trusted", status: 403},
		{name: "unconfigured stack", subject: "user:one", identityNamespace: "stacks-2", routeNamespace: "stacks-2", token: "trusted", status: 403},
		{name: "wildcard", subject: "user:one", identityNamespace: "*", routeNamespace: "*", token: "trusted", status: 403},
		{name: "wrong method", subject: "user:one", identityNamespace: "stacks-1", routeNamespace: "stacks-1", token: "trusted", method: "GET", status: 405},
		{name: "arbitrary guide", subject: "user:one", identityNamespace: "stacks-1", routeNamespace: "stacks-1", token: "trusted", method: "POST", body: `{"guide":"other","asset":"content.json"}`, status: 400},
		{name: "shared index", subject: "user:one", identityNamespace: "stacks-1", routeNamespace: "stacks-1", token: "trusted", method: "POST", body: `{"guide":"` + privateCDNGuide + `","asset":"repository.json"}`, status: 400},
		{name: "path traversal", subject: "user:one", identityNamespace: "stacks-1", routeNamespace: "stacks-1", token: "trusted", method: "POST", body: `{"guide":"` + privateCDNGuide + `","asset":"../content.json"}`, status: 400},
		{name: "body identity", subject: "user:one", identityNamespace: "stacks-1", routeNamespace: "stacks-1", token: "trusted", method: "POST", body: `{"guide":"` + privateCDNGuide + `","asset":"content.json","subject":"user:two"}`, status: 400},
		{name: "extra JSON", subject: "user:one", identityNamespace: "stacks-1", routeNamespace: "stacks-1", token: "trusted", method: "POST", body: `{"guide":"` + privateCDNGuide + `","asset":"content.json"}{}`, status: 400},
		{name: "oversized body", subject: "user:one", identityNamespace: "stacks-1", routeNamespace: "stacks-1", token: "trusted", method: "POST", body: strings.Repeat("x", 1025), status: 400},
		{name: "query override", subject: "user:one", identityNamespace: "stacks-1", routeNamespace: "stacks-1", token: "trusted", method: "POST", query: "namespace=stacks-2", status: 400},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			client := &privateCDNClient{namespace: "stacks-1"}
			ctx := context.Background()
			if tc.subject != "" {
				ctx = privateCDNIdentity(tc.identityNamespace, tc.subject, tc.token)
			}
			req := privateCDNRequest(tc.method, tc.routeNamespace, tc.body)
			req.URL.RawQuery = tc.query
			w := httptest.NewRecorder()
			require.NoError(t, privateCDNHandler(client, "sign")(ctx, w, req))
			require.Equal(t, tc.status, w.Code)
			require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
		})
	}
}

func TestPrivateCDNUpstreamFailuresNeverFallBack(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name           string
		upstreamStatus int
		body           string
		want           int
	}{
		{"unauthorized", 401, "sensitive upstream error", 401},
		{"denied", 403, "sensitive upstream error", 403},
		{"missing", 404, "sensitive upstream error", 502},
		{"unavailable", 503, "sensitive upstream error", 502},
		{"rate limited", 429, "sensitive upstream error", 429},
		{"redirect", 302, "sensitive upstream error", 502},
		{"malformed response", 200, "sensitive upstream error", 502},
		{"oversized response", 200, strings.Repeat("x", 64*1024+1), 502},
		{"denied catalogue", 200, "[]", 200},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			var requests atomic.Int32
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				requests.Add(1)
				w.Header().Set("Location", "/unexpected-target")
				w.WriteHeader(tc.upstreamStatus)
				_, _ = io.WriteString(w, tc.body)
			}))
			defer upstream.Close()
			client := &privateCDNClient{namespace: "stacks-1", baseURL: upstream.URL, httpClient: &http.Client{Timeout: time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
			w := httptest.NewRecorder()
			require.NoError(t, privateCDNHandler(client, "catalogue")(privateCDNIdentity("stacks-1", "user:one", "trusted"), w, privateCDNRequest("GET", "stacks-1", "")))
			require.Equal(t, tc.want, w.Code)
			require.EqualValues(t, 1, requests.Load())
			require.Empty(t, w.Header().Get("Location"))
			require.NotContains(t, w.Body.String(), "sensitive")
		})
	}
}

func TestPrivateCDNDisabledRoutesAreRegistered(t *testing.T) {
	t.Setenv("PATHFINDER_PRIVATE_CDN_NAMESPACE", "")
	application, err := newApp(app.Config{KubeConfig: rest.Config{Host: "http://unused", WrapTransport: func(rt http.RoundTripper) http.RoundTripper { return rt }}}, nil, nil, nil)
	require.NoError(t, err)
	for _, tc := range []struct{ method, operation string }{{"GET", "catalogue"}, {"POST", "sign"}, {"GET", "identity"}} {
		t.Run(tc.operation, func(t *testing.T) {
			req := privateCDNRequest(tc.method, "stacks-1", "")
			req.Path = "backend/private-cdn/" + tc.operation
			w := httptest.NewRecorder()
			require.NoError(t, application.CallCustomRoute(privateCDNIdentity("stacks-1", "user:one", "trusted"), w, req))
			require.Equal(t, 503, w.Code)
			require.Contains(t, w.Body.String(), "private-cdn-unavailable")
		})
	}
}

func TestPrivateCDNIdentityUsesVerifiedContext(t *testing.T) {
	t.Parallel()
	client := &privateCDNClient{namespace: "stacks-1"}
	w := httptest.NewRecorder()
	ctx := privateCDNIdentity("stacks-1", "user:one", "trusted-caller-token")
	req := privateCDNRequest("GET", "stacks-1", `{"subject":"user:two"}`)
	require.NoError(t, privateCDNHandler(client, "identity")(ctx, w, req))
	require.Equal(t, 200, w.Code)
	require.JSONEq(t, `{"subject":"user:one","namespace":"stacks-1"}`, w.Body.String())
	require.NotContains(t, w.Body.String(), "trusted-caller-token")
	require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
}

func TestPrivateCDNReadsOperatorSDKEnvironment(t *testing.T) {
	t.Setenv("PATHFINDER_PRIVATE_CDN_NAMESPACE", "stacks-1")
	t.Setenv(sdkplugin.EnvVarAPIAccessCAPToken, "")
	t.Setenv(sdkplugin.EnvVarAPIAccessTokenExchangeURL, "")
	t.Setenv("API_ACCESS_CAP_TOKEN", "synthetic-legacy-cap")
	t.Setenv("API_ACCESS_TOKEN_EXCHANGE_URL", "http://exchange.invalid")
	client, err := privateCDNFromEnvironment()
	require.NoError(t, err)
	require.Equal(t, privateCDNURL, client.baseURL)
	t.Setenv(sdkplugin.EnvVarAPIAccessCAPToken, "synthetic-prefixed-cap")
	require.Equal(t, "synthetic-prefixed-cap", privateCDNSDKEnv(sdkplugin.EnvVarAPIAccessCAPToken))
}

func TestPrivateCDNConfigurationFailsClosed(t *testing.T) {
	t.Setenv("PATHFINDER_PRIVATE_CDN_NAMESPACE", "")
	client, err := privateCDNFromEnvironment()
	require.NoError(t, err)
	require.Nil(t, client)
	t.Setenv("PATHFINDER_PRIVATE_CDN_NAMESPACE", "*")
	_, err = privateCDNFromEnvironment()
	require.Error(t, err)
	t.Setenv("PATHFINDER_PRIVATE_CDN_NAMESPACE", "stacks-1")
	t.Setenv(sdkplugin.EnvVarAPIAccessCAPToken, "")
	t.Setenv(sdkplugin.EnvVarAPIAccessTokenExchangeURL, "")
	t.Setenv("API_ACCESS_CAP_TOKEN", "")
	t.Setenv("API_ACCESS_TOKEN_EXCHANGE_URL", "")
	t.Setenv("GF_API_ACCESS_BEARER_TOKEN", "shared-token")
	_, err = privateCDNFromEnvironment()
	require.Error(t, err)
}
