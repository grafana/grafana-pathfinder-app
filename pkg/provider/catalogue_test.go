package provider

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	authlib "github.com/grafana/authlib/types"
	"github.com/grafana/grafana-app-sdk/app"
	sdkplugin "github.com/grafana/grafana-app-sdk/plugin"
	"github.com/grafana/grafana-app-sdk/resource"
	"github.com/grafana/grafana-pathfinder-app/pkg/resourceaccess"
	"k8s.io/client-go/rest"
)

func TestCatalogueSDKResponse(t *testing.T) {
	for _, tc := range []struct {
		name           string
		upstream, want int
		available      bool
		reason         string
	}{
		{"available", 200, 200, true, ""},
		{"forbidden", 403, 200, false, "upstream-403"},
		{"unavailable", 503, 503, false, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(tc.upstream)
				if tc.upstream == 200 {
					_, _ = w.Write([]byte(`{"metadata":{},"items":[{"spec":{"id":"guide","title":"Guide","status":"published","blocks":[{"secret":"large content"}],"manifest":{"type":"guide","stats":{"version":1},"tracks":"invalid"}}}]}`))
				} else {
					_, _ = w.Write([]byte(`{"kind":"Status","apiVersion":"v1","status":"Failure","code":` + jsonNumber(tc.upstream) + `}`))
				}
			}))
			defer server.Close()
			store, err := resourceaccess.NewGuideStore(sdkplugin.BuildClientGenerator(rest.Config{Host: server.URL, APIPath: "/apis"}))
			if err != nil {
				t.Fatal(err)
			}
			recorder := httptest.NewRecorder()
			ctx := authlib.WithAuthInfo(context.Background(), testIdentity{namespace: "default"})
			err = catalogueReadHandler(store)(ctx, recorder, &app.CustomRouteRequest{Method: http.MethodGet, ResourceIdentifier: resource.FullIdentifier{Namespace: "default"}})
			if err != nil || recorder.Code != tc.want {
				t.Fatalf("status=%d error=%v", recorder.Code, err)
			}
			if tc.want == 503 {
				if recorder.Header().Get("Retry-After") != "30" {
					t.Fatal("missing retry hint")
				}
				return
			}
			var response catalogueResponse
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
				t.Fatal(err)
			}
			if response.Capability.Available != tc.available || response.Capability.Reason != tc.reason {
				t.Fatalf("capability=%+v", response.Capability)
			}
			if tc.available {
				if len(response.Guides) != 1 || response.Guides[0].Manifest.Stats != nil || len(response.Guides[0].Manifest.Tracks) != 0 {
					t.Fatalf("guides=%+v", response.Guides)
				}
				if strings.Contains(recorder.Body.String(), "large content") {
					t.Fatal("catalogue includes blocks")
				}
			}
		})
	}
}

func jsonNumber(value int) string { body, _ := json.Marshal(value); return string(body) }
