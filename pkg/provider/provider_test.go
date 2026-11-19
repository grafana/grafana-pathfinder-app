package provider

import (
	"context"
	"encoding/json"
	sdkplugin "github.com/grafana/grafana-app-sdk/plugin"
	"github.com/grafana/grafana-pathfinder-app/pkg/generated/manifestdata"
	"github.com/stretchr/testify/require"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"

	authlib "github.com/grafana/authlib/types"
	"github.com/grafana/grafana-app-sdk/app"
	"github.com/grafana/grafana-app-sdk/resource"
	"k8s.io/client-go/rest"
)

func TestProviderDispatchesSettingsRoute(t *testing.T) {
	const body = `{"metadata":{"name":"default","resourceVersion":"42"},"spec":{"futureField":true}}`
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/apis/pathfinderbackend.ext.grafana.app/v1alpha1/namespaces/stacks-1/pathfindersettings/default" {
			t.Errorf("unexpected upstream path %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(body))
	}))
	defer upstream.Close()
	application, err := newApp(app.Config{KubeConfig: rest.Config{Host: upstream.URL, APIPath: "/apis", WrapTransport: func(rt http.RoundTripper) http.RoundTripper { return rt }}}, nil, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	ctx := authlib.WithAuthInfo(context.Background(), testIdentity{namespace: "stacks-1"})
	recorder := httptest.NewRecorder()
	err = application.CallCustomRoute(ctx, recorder, &app.CustomRouteRequest{
		Method: http.MethodGet, Path: "backend/pathfinder-settings",
		ResourceIdentifier: resource.FullIdentifier{Group: "pathfinderbackend.ext.grafana.app", Version: "v1alpha1", Namespace: "stacks-1"},
	})
	if err != nil || recorder.Code != http.StatusOK || recorder.Body.String() != body+"\n" {
		t.Fatalf("status=%d body=%s error=%v", recorder.Code, recorder.Body.String(), err)
	}
}

func TestUnprovisionedAndSharedCredentialsCannotAccessTenantStores(t *testing.T) {
	var requests atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { requests.Add(1) }))
	defer upstream.Close()
	for _, cfg := range []rest.Config{{}, {Host: upstream.URL, BearerToken: "shared"}} {
		application, err := newApp(app.Config{KubeConfig: cfg}, nil, nil, nil)
		require.NoError(t, err)
		ctx := authlib.WithAuthInfo(context.Background(), completionIdentity{testIdentity{namespace: "stacks-1"}, "user:viewer"})
		for _, tc := range []struct {
			method, path string
			status       int
		}{{"GET", "completion-records/my", 200}, {"GET", "completion-records/capability", 200}, {"POST", "completion-records", 404}, {"POST", "custom-guide", 503}, {"PUT", "pathfinder-settings", 503}, {"POST", "api/v1/achievements/events", 503}, {"GET", "assignments/my", 503}} {
			w := httptest.NewRecorder()
			err = application.CallCustomRoute(ctx, w, &app.CustomRouteRequest{Method: tc.method, Path: "backend/" + tc.path, ResourceIdentifier: resource.FullIdentifier{Version: "v1alpha1", Namespace: "stacks-1"}})
			require.NoError(t, err)
			require.Equal(t, tc.status, w.Code)
			require.Contains(t, w.Body.String(), "obo-unavailable")
		}
	}
	require.Zero(t, requests.Load())
}

func TestViewerMutationUsesCallerExchangeAndPreservesUpstreamDenial(t *testing.T) {
	var exchanges, writes atomic.Int32
	exchange := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			SubjectToken string `json:"subjectToken"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil || request.SubjectToken != "viewer-context-token" {
			t.Errorf("exchange did not carry the caller")
			http.Error(w, "missing caller", 401)
			return
		}
		exchanges.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"token":"caller-bound-test-token"}}`))
	}))
	defer exchange.Close()
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer caller-bound-test-token" || r.Method != "POST" {
			t.Errorf("unexpected upstream credentials or method")
		}
		writes.Add(1)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(403)
		_, _ = w.Write([]byte(`{"kind":"Status","reason":"Forbidden","status":"Failure","code":403}`))
	}))
	defer upstream.Close()
	t.Setenv(sdkplugin.EnvVarAPIAccessRouterURL, upstream.URL)
	t.Setenv(sdkplugin.EnvVarAPIAccessCAPToken, "test-cap")
	t.Setenv(sdkplugin.EnvVarAPIAccessTokenExchangeURL, exchange.URL)
	cfg, err := sdkplugin.BuildKubeConfig(*manifestdata.LocalManifest().ManifestData)
	require.NoError(t, err)
	application, err := newApp(app.Config{KubeConfig: *cfg}, nil, nil, nil)
	require.NoError(t, err)
	ctx := authlib.WithAuthInfo(context.Background(), adminIdentity{completionIdentity: completionIdentity{testIdentity{namespace: "default"}, "user:viewer"}, accessToken: "viewer-context-token"})
	w := httptest.NewRecorder()
	body := `{"apiVersion":"pathfinderbackend.ext.grafana.app/v1alpha1","kind":"InteractiveGuide","metadata":{"name":"sample"},"spec":{"id":"sample","title":"Sample","status":"draft","schemaVersion":"1.0","blocks":[]}}`
	err = application.CallCustomRoute(ctx, w, &app.CustomRouteRequest{Path: "backend/custom-guide", Method: "POST", URL: &url.URL{}, Body: io.NopCloser(strings.NewReader(body)), ResourceIdentifier: resource.FullIdentifier{Namespace: "default", Version: "v1alpha1"}})
	require.NoError(t, err)
	require.Equal(t, 403, w.Code, w.Body.String())
	require.EqualValues(t, 1, exchanges.Load())
	require.EqualValues(t, 1, writes.Load())
}
