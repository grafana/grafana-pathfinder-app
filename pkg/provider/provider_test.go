package provider

import (
	"context"
	"net/http"
	"net/http/httptest"
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
	application, err := newApp(app.Config{KubeConfig: rest.Config{Host: upstream.URL, APIPath: "/apis"}}, nil, nil, nil)
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
