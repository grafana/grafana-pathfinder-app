package provider

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/grafana/grafana-app-sdk/app"
	"github.com/grafana/grafana-app-sdk/resource"
	"github.com/grafana/grafana-app-sdk/simple"
)

// Personal responses must never be stored by a shared HTTP cache. See the route recipe in docs/design/BACKEND_PROXY_PATTERN.md (step 4).
func TestPersonalReadHandlersForbidHTTPCaching(t *testing.T) {
	handlers := map[string]simple.AppCustomRouteHandler{
		"completion-records/my":         completionReadHandler(nil, false),
		"completion-records/capability": completionReadHandler(nil, true),
		"custom-guide-repository":       catalogueReadHandler(nil),
	}
	requests := map[string]*app.CustomRouteRequest{
		"unauthenticated":    {Method: http.MethodGet, ResourceIdentifier: resource.FullIdentifier{Namespace: "default"}},
		"method not allowed": {Method: http.MethodPost, ResourceIdentifier: resource.FullIdentifier{Namespace: "default"}},
	}
	for name, handler := range handlers {
		for caseName, request := range requests {
			t.Run(name+"/"+caseName, func(t *testing.T) {
				recorder := httptest.NewRecorder()
				if err := handler(context.Background(), recorder, request); err != nil {
					t.Fatal(err)
				}
				if got := recorder.Header().Get("Cache-Control"); got != "no-store" {
					t.Fatalf("Cache-Control=%q, want no-store", got)
				}
			})
		}
	}
}
