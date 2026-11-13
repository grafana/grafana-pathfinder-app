package provider

import (
	"context"
	"encoding/base64"
	authlib "github.com/grafana/authlib/types"
	"github.com/grafana/grafana-app-sdk/app"
	"github.com/grafana/grafana-app-sdk/resource"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"
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

func TestInsightsRateLimitPrecedesResourceReads(t *testing.T) {
	payload := `{"sub":"user:1","namespace":"default","role":"Admin"}`
	identity := adminIdentity{completionIdentity: completionIdentity{testIdentity: testIdentity{namespace: "default"}, subject: "user:1"}, idToken: "header." + base64.RawURLEncoding.EncodeToString([]byte(payload)) + ".signature"}
	handler := insightsReadHandler(nil, nil, nil, func(namespace, subject string) (bool, time.Duration) {
		if namespace != "default" || subject != "user:1" {
			t.Fatal("untrusted rate-limit key")
		}
		return false, 1500 * time.Millisecond
	})
	w := httptest.NewRecorder()
	if err := handler(authlib.WithAuthInfo(context.Background(), identity), w, &app.CustomRouteRequest{Method: http.MethodGet, ResourceIdentifier: resource.FullIdentifier{Namespace: "default"}}); err != nil {
		t.Fatal(err)
	}
	if w.Code != 429 || w.Header().Get("Retry-After") != "2" || w.Body.String() != "{\"error\":\"rate-limited\"}\n" {
		t.Fatalf("unexpected limit response: %d %s", w.Code, w.Body.String())
	}
}
