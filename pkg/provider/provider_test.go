package provider

import (
	"context"
	"github.com/stretchr/testify/require"
	"net/http"
	"net/http/httptest"
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
