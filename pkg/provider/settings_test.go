package provider

import (
	"context"
	"encoding/json"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"testing"

	authlib "github.com/grafana/authlib/types"
	"github.com/grafana/grafana-app-sdk/app"
	"github.com/grafana/grafana-app-sdk/resource"
)

func TestSettingsRouteRejectsBeforeReading(t *testing.T) {
	for _, tc := range []struct {
		method, namespace string
		status            int
	}{
		{http.MethodGet, "stacks-other", http.StatusForbidden},
		{http.MethodPost, "stacks-1", http.StatusMethodNotAllowed},
	} {
		t.Run(tc.method+tc.namespace, func(t *testing.T) {
			handler := settingsReadHandler(func(context.Context, string) (json.RawMessage, error) {
				t.Fatal("unauthorized request reached storage")
				return nil, nil
			})
			ctx := authlib.WithAuthInfo(context.Background(), testIdentity{namespace: "stacks-1"})
			recorder := httptest.NewRecorder()
			err := handler(ctx, recorder, &app.CustomRouteRequest{Method: tc.method, ResourceIdentifier: resource.FullIdentifier{Namespace: tc.namespace}})
			if err != nil || recorder.Code != tc.status {
				t.Fatalf("status=%d error=%v", recorder.Code, err)
			}
			if recorder.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("response can be cached")
			}
		})
	}
}

func TestSettingsRoutePreservesResource(t *testing.T) {
	ctx := authlib.WithAuthInfo(context.Background(), testIdentity{namespace: "stacks-1"})
	body := json.RawMessage(`{"metadata":{"resourceVersion":"42"},"spec":{"futureField":true}}`)
	handler := settingsReadHandler(func(got context.Context, namespace string) (json.RawMessage, error) {
		if _, ok := authlib.AuthInfoFrom(got); !ok || namespace != "stacks-1" {
			t.Fatal("lost caller identity")
		}
		return body, nil
	})
	recorder := httptest.NewRecorder()
	err := handler(ctx, recorder, &app.CustomRouteRequest{Method: http.MethodGet, ResourceIdentifier: resource.FullIdentifier{Namespace: "stacks-1"}})
	if err != nil || recorder.Code != http.StatusOK || recorder.Body.String() != string(body)+"\n" {
		t.Fatalf("status=%d body=%s error=%v", recorder.Code, recorder.Body.String(), err)
	}
}

func TestSettingsRouteDistinguishesMissingSingleton(t *testing.T) {
	body, err := os.ReadFile("../plugin/testdata/upstream/pathfindersettings-not-found.json")
	if err != nil {
		t.Fatal(err)
	}
	var missing metav1.Status
	if err := json.Unmarshal(body, &missing); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, query string
		code        int
		resource    string
		want        int
	}{
		{"explicit absence", "absence=explicit", 404, "default", 200},
		{"legacy absence", "", 404, "default", 404},
		{"another resource", "absence=explicit", 404, "other", 404},
		{"forbidden", "absence=explicit", 403, "default", 403},
		{"unauthorized upstream", "", 401, "default", 502},
		{"transient", "", 503, "default", 503},
	} {
		t.Run(tc.name, func(t *testing.T) {
			status := missing.DeepCopy()
			status.Code = int32(tc.code)
			status.Details.Name = tc.resource
			handler := settingsReadHandler(func(context.Context, string) (json.RawMessage, error) {
				return nil, &apierrors.StatusError{ErrStatus: *status}
			})
			ctx := authlib.WithAuthInfo(context.Background(), testIdentity{namespace: "stacks-1"})
			recorder := httptest.NewRecorder()
			err := handler(ctx, recorder, &app.CustomRouteRequest{Method: http.MethodGet, URL: &url.URL{RawQuery: tc.query}, ResourceIdentifier: resource.FullIdentifier{Namespace: "stacks-1"}})
			if err != nil || recorder.Code != tc.want {
				t.Fatalf("status=%d body=%s error=%v", recorder.Code, recorder.Body.String(), err)
			}
			if tc.want == 200 && recorder.Body.String() != "{\"state\":\"not-configured\"}\n" {
				t.Fatalf("body=%s", recorder.Body.String())
			}
		})
	}
}
