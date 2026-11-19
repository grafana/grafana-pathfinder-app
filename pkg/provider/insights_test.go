package provider

import (
	"context"
	"encoding/base64"
	authlib "github.com/grafana/authlib/types"
	"github.com/grafana/grafana-app-sdk/app"
	"github.com/grafana/grafana-app-sdk/resource"
	"github.com/grafana/grafana-pathfinder-app/pkg/services"
	"github.com/stretchr/testify/require"
	"k8s.io/client-go/rest"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

func TestInsightsAuthorizationPrecedesReadsAndPeriodParsing(t *testing.T) {
	handler := insightsReadHandler(nil, nil, nil, nil)
	for _, role := range []string{"Viewer", "Editor", "Admin"} {
		t.Run(role, func(t *testing.T) {
			payload := `{"sub":"user:1","namespace":"default","role":"` + role + `"}`
			identity := adminIdentity{completionIdentity: completionIdentity{testIdentity: testIdentity{namespace: "default"}, subject: "user:1"}, idToken: "header." + base64.RawURLEncoding.EncodeToString([]byte(payload)) + ".signature"}
			ctx := authlib.WithAuthInfo(context.Background(), identity)
			u, _ := url.Parse("http://local/insights?from=invalid")
			w := httptest.NewRecorder()
			if err := handler(ctx, w, &app.CustomRouteRequest{Method: http.MethodGet, URL: u, ResourceIdentifier: resource.FullIdentifier{Namespace: "default"}, Headers: http.Header{"X-Grafana-Role": []string{"Admin"}}}); err != nil {
				t.Fatal(err)
			}
			want := http.StatusForbidden
			if role == "Admin" {
				want = http.StatusBadRequest
			}
			if w.Code != want {
				t.Fatalf("status %d want %d body %s", w.Code, want, w.Body.String())
			}
		})
	}
}

func TestInsightsUsesBoundNamespaceAndReauthorizesEveryRead(t *testing.T) {
	var paths []string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"metadata":{},"items":[]}`))
	}))
	defer upstream.Close()
	application, err := newApp(app.Config{KubeConfig: rest.Config{Host: upstream.URL, APIPath: "/apis", WrapTransport: func(rt http.RoundTripper) http.RoundTripper { return rt }}}, nil, func() services.PathGuideSource { return nil }, nil)
	require.NoError(t, err)
	query, _ := url.Parse("/?namespace=sibling")
	for _, role := range []string{"Admin", "Viewer"} {
		claims := `{"sub":"user:1","namespace":"default","role":"` + role + `"}`
		id := adminIdentity{completionIdentity: completionIdentity{testIdentity{namespace: "default"}, "user:1"}, idToken: "header." + base64.RawURLEncoding.EncodeToString([]byte(claims)) + ".signature"}
		w := httptest.NewRecorder()
		err = application.CallCustomRoute(authlib.WithAuthInfo(context.Background(), id), w, &app.CustomRouteRequest{Method: "GET", Path: "backend/learning-insights", URL: query, ResourceIdentifier: resource.FullIdentifier{Namespace: "default", Version: "v1alpha1"}})
		require.NoError(t, err)
		if role == "Admin" {
			require.Equal(t, 200, w.Code)
		} else {
			require.Equal(t, 403, w.Code)
		}
	}
	require.Equal(t, []string{"/apis/pathfinderbackend.ext.grafana.app/v1alpha1/namespaces/default/completionrecords", "/apis/pathfinderbackend.ext.grafana.app/v1alpha1/namespaces/default/assignments"}, paths)
}
