package provider

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	authlib "github.com/grafana/authlib/types"
	"github.com/grafana/grafana-app-sdk/app"
	sdkplugin "github.com/grafana/grafana-app-sdk/plugin"
	"github.com/grafana/grafana-app-sdk/resource"
	"github.com/grafana/grafana-pathfinder-app/pkg/resourceaccess"
	"github.com/grafana/grafana-pathfinder-app/pkg/services"
	"k8s.io/client-go/rest"
)

type cooldownTransport struct {
	calls  int
	status int
	body   string
	err    error
}

func (tr *cooldownTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	tr.calls++
	if tr.err != nil {
		return nil, tr.err
	}
	return &http.Response{StatusCode: tr.status, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(tr.body)), Request: req}, nil
}

func TestCompletionFailureCooldownPreservesCauseAndCallerIsolation(t *testing.T) {
	for _, tc := range []struct {
		name   string
		status int
		body   string
		err    error
		calls  int
	}{
		{name: "unauthorized", status: 401, calls: 2},
		{name: "forbidden", status: 403, calls: 2},
		{name: "missing", status: 404, calls: 1},
		{name: "throttled", status: 429, calls: 1},
		{name: "outage", status: 503, calls: 1},
		{name: "cancelled", err: context.Canceled, calls: 2},
		{name: "deadline", err: context.DeadlineExceeded, calls: 1},
		{name: "network", err: &net.OpError{Op: "dial", Net: "tcp", Err: errors.New("refused")}, calls: 1},
		{name: "malformed", status: 200, body: "not-json", calls: 2},
	} {
		t.Run(tc.name, func(t *testing.T) {
			services.ResetCompletionCache()
			t.Cleanup(services.ResetCompletionCache)
			tr := &cooldownTransport{status: tc.status, body: tc.body, err: tc.err}
			store, err := resourceaccess.NewCompletionStore(sdkplugin.BuildClientGenerator(rest.Config{Host: "https://cooldown.invalid", APIPath: "/apis", Transport: tr}))
			if err != nil {
				t.Fatal(err)
			}
			handler := completionReadHandler(store, false)
			read := func(subject string) {
				ctx := authlib.WithAuthInfo(context.Background(), completionIdentity{testIdentity: testIdentity{namespace: "default"}, subject: subject})
				if err := handler(ctx, httptest.NewRecorder(), &app.CustomRouteRequest{Method: http.MethodGet, ResourceIdentifier: resource.FullIdentifier{Namespace: "default"}}); err != nil {
					t.Fatal(err)
				}
			}
			read("user:one")
			read("user:one")
			if tr.calls != tc.calls {
				t.Fatalf("same caller upstream calls=%d, want %d", tr.calls, tc.calls)
			}
			read("user:two")
			if tr.calls != tc.calls+1 {
				t.Fatalf("another caller inherited failure: upstream calls=%d", tr.calls)
			}
		})
	}
}
