package provider

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
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

func TestReadRoutesPreserveTransportFailureCause(t *testing.T) {
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
			for _, route := range []struct {
				name      string
				handler   simple.AppCustomRouteHandler
				status    int
				retry     string
				resource  string
				operation string
			}{
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
