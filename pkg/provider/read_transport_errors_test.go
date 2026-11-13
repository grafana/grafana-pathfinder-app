package provider

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	authlib "github.com/grafana/authlib/types"
	"github.com/grafana/grafana-app-sdk/app"
	sdkplugin "github.com/grafana/grafana-app-sdk/plugin"
	"github.com/grafana/grafana-app-sdk/resource"
	"github.com/grafana/grafana-app-sdk/simple"
	"github.com/grafana/grafana-pathfinder-app/pkg/resourceaccess"
	"github.com/grafana/grafana-pathfinder-app/pkg/services"
	"k8s.io/client-go/rest"
)

type failedReadTransport struct{ err error }

func (transport failedReadTransport) RoundTrip(*http.Request) (*http.Response, error) {
	return nil, transport.err
}

func TestResourceRoutesPreserveTransportFailureCause(t *testing.T) {
	for _, failure := range []struct {
		name   string
		err    error
		reason string
	}{
		{"deadline", context.DeadlineExceeded, "timeout"},
		{"cancellation", context.Canceled, "cancelled"},
		{"connection", &net.OpError{Op: "dial", Net: "tcp", Err: errors.New("connection refused")}, "network-error"},
	} {
		t.Run(failure.name, func(t *testing.T) {
			generator := sdkplugin.BuildClientGenerator(rest.Config{Host: "https://read-failure.invalid", APIPath: "/apis", Transport: failedReadTransport{err: failure.err}})
			settings, err := resourceaccess.NewSettingsStore(generator)
			if err != nil {
				t.Fatal(err)
			}
			guides, err := resourceaccess.NewGuideStore(generator)
			if err != nil {
				t.Fatal(err)
			}
			writer, err := resourceaccess.NewCompletionWriter(generator)
			if err != nil {
				t.Fatal(err)
			}
			write := func(ctx context.Context, w app.CustomRouteResponseWriter, request *app.CustomRouteRequest) error {
				err := writer.Create(ctx, request.ResourceIdentifier.Namespace, services.CompletionRecordObject{Metadata: services.CompletionRecordObjectMeta{Name: "test-record"}})
				if !errors.Is(err, failure.err) {
					t.Fatalf("lost transport error: %v", err)
				}
				return writeCompletionSDKError(w, err)
			}
			for _, route := range []struct {
				name      string
				handler   simple.AppCustomRouteHandler
				status    int
				retry     string
				resource  string
				operation string
			}{
				{"completion write", write, 503, "30", "completionrecords", "create"},
				{"settings", settingsReadHandler(settings.Read), 502, "", "pathfindersettings", "get"},
				{"catalogue", catalogueReadHandler(guides), 503, "30", "interactiveguides", "list"},
			} {
				t.Run(route.name, func(t *testing.T) {
					ctx := authlib.WithAuthInfo(context.Background(), testIdentity{namespace: "default"})
					response := httptest.NewRecorder()
					err := route.handler(ctx, response, &app.CustomRouteRequest{Method: http.MethodGet, ResourceIdentifier: resource.FullIdentifier{Namespace: "default"}})
					if err != nil {
						t.Fatal(err)
					}
					var body struct {
						Diagnostics services.ProxyDiagnostic `json:"diagnostics"`
					}
					if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
						t.Fatal(err)
					}
					expected := services.ProxyDiagnostic{Stage: "app-platform", Resource: route.resource, Operation: route.operation, Outcome: "error", Reason: failure.reason}
					if body.Diagnostics.Reason != expected.Reason || body.Diagnostics.UpstreamStatus != 0 || body.Diagnostics.Resource != expected.Resource || body.Diagnostics.Operation != expected.Operation {
						t.Fatalf("diagnostics=%+v, expected=%+v", body.Diagnostics, expected)
					}
					if response.Code != route.status || response.Header().Get("Retry-After") != route.retry {
						t.Fatalf("status=%d retry=%q body=%s", response.Code, response.Header().Get("Retry-After"), response.Body)
					}
				})
			}
		})
	}
}

func TestSettingsRoutePreservesInvalidResponseDiagnostics(t *testing.T) {
	for _, tc := range []struct{ name, body, reason string }{
		{"malformed", "not-json", "invalid-json"},
		{"oversized", strings.Repeat(" ", services.SettingsMaxBytes+1), "response-too-large"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(tc.body))
			}))
			defer server.Close()
			store, err := resourceaccess.NewSettingsStore(sdkplugin.BuildClientGenerator(resourceaccess.SettingsConfig(rest.Config{Host: server.URL, APIPath: "/apis"})))
			if err != nil {
				t.Fatal(err)
			}
			ctx := authlib.WithAuthInfo(context.Background(), testIdentity{namespace: "default"})
			response := httptest.NewRecorder()
			err = settingsReadHandler(store.Read)(ctx, response, &app.CustomRouteRequest{Method: http.MethodGet, ResourceIdentifier: resource.FullIdentifier{Namespace: "default"}})
			if err != nil {
				t.Fatal(err)
			}
			var body struct {
				Diagnostics services.ProxyDiagnostic `json:"diagnostics"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if response.Code != 502 || body.Diagnostics.Reason != tc.reason || body.Diagnostics.UpstreamStatus != 200 {
				t.Fatalf("status=%d body=%s", response.Code, response.Body)
			}
		})
	}
}

func TestSettingsRouteDoesNotMistakeUpstreamFailureForAbsence(t *testing.T) {
	const missing = `{"kind":"Status","apiVersion":"v1","status":"Failure","reason":"NotFound","code":404,"details":{"name":"default","group":"pathfinderbackend.ext.grafana.app","kind":"pathfindersettings"}}`
	for _, code := range []int{403, 503} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(code)
			_, _ = w.Write([]byte(missing))
		}))
		store, err := resourceaccess.NewSettingsStore(sdkplugin.BuildClientGenerator(resourceaccess.SettingsConfig(rest.Config{Host: server.URL, APIPath: "/apis"})))
		if err != nil {
			t.Fatal(err)
		}
		ctx := authlib.WithAuthInfo(context.Background(), testIdentity{namespace: "default"})
		response := httptest.NewRecorder()
		err = settingsReadHandler(store.Read)(ctx, response, &app.CustomRouteRequest{Method: http.MethodGet, URL: &url.URL{RawQuery: "absence=explicit"}, ResourceIdentifier: resource.FullIdentifier{Namespace: "default"}})
		server.Close()
		if err != nil || response.Code != code || strings.Contains(response.Body.String(), "not-configured") {
			t.Fatalf("upstream=%d status=%d body=%s err=%v", code, response.Code, response.Body, err)
		}
	}
}

func TestGuideRoutePreservesInvalidResponseDiagnostics(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte("not-json"))
	}))
	defer server.Close()
	store, err := resourceaccess.NewGuideStore(sdkplugin.BuildClientGenerator(resourceaccess.BoundedConfig(rest.Config{Host: server.URL, APIPath: "/apis"}, resourceaccess.GuidePageMaxBytes)))
	if err != nil {
		t.Fatal(err)
	}
	ctx := authlib.WithAuthInfo(context.Background(), testIdentity{namespace: "default"})
	response := httptest.NewRecorder()
	err = guideReadHandler(store)(ctx, response, &app.CustomRouteRequest{Method: http.MethodGet, URL: &url.URL{RawQuery: "name=test-guide"}, ResourceIdentifier: resource.FullIdentifier{Namespace: "default"}})
	if err != nil {
		t.Fatal(err)
	}
	var body struct {
		Diagnostics services.ProxyDiagnostic `json:"diagnostics"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if response.Code != 502 || body.Diagnostics.Reason != "invalid-json" || body.Diagnostics.UpstreamStatus != 200 || body.Diagnostics.Resource != "interactiveguides" {
		t.Fatalf("status=%d body=%s", response.Code, response.Body)
	}
}
