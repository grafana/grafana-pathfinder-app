package plugin

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/grafana/grafana-pathfinder-app/pkg/plugin/auth"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

func TestSettingsProxyCallerAndResourceVersion(t *testing.T) {
	const body = `{"metadata":{"resourceVersion":"42"},"spec":{"enableKioskMode":true}}`
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/apis/pathfinderbackend.ext.grafana.app/v1alpha1/namespaces/stacks-35611/pathfindersettings/default" {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		if r.Header.Get(auth.AccessTokenHeader) != "caller-token" {
			t.Error("missing caller token")
		}
		for _, h := range []string{"Cookie", "Authorization", "X-Grafana-Id"} {
			if r.Header.Get(h) != "" {
				t.Errorf("forwarded %s", h)
			}
		}
		_, _ = w.Write([]byte(body))
	}))
	defer server.Close()
	minter := &stubMinter{token: "caller-token"}
	client := newAppPlatformListClient(server.URL, minter, "anonymous-id-token", log.DefaultLogger)
	got, err := client.getSettings(context.Background(), "stacks-35611")
	if err != nil || string(got) != body {
		t.Fatalf("body=%s err=%v", got, err)
	}
	if minter.gotNamespace != "stacks-35611" || minter.gotIDToken != "anonymous-id-token" {
		t.Fatal("caller identity not preserved")
	}
}

func TestSettingsProxyUpstreamFailures(t *testing.T) {
	for _, status := range []int{403, 404, 429, 503, 302} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Location", "/redirect")
				w.WriteHeader(status)
			}))
			defer server.Close()
			client := newAppPlatformListClient(server.URL, &stubMinter{token: "token"}, "id", log.DefaultLogger)
			_, err := client.getSettings(context.Background(), "stacks-1")
			got, ok := upstreamStatusOf(err)
			if !ok || got != status {
				t.Fatalf("status=%d err=%v", got, err)
			}
		})
	}
	for _, body := range []string{"invalid", strings.Repeat(" ", pathfinderSettingsMaxBytes+1)} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte(body)) }))
		client := newAppPlatformListClient(server.URL, &stubMinter{token: "token"}, "id", log.DefaultLogger)
		_, err := client.getSettings(context.Background(), "stacks-1")
		server.Close()
		if err == nil {
			t.Fatal("accepted invalid/oversized response")
		}
	}
}

func TestSettingsProxyRejectsUnverifiedCaller(t *testing.T) {
	app := newTestApp(t)
	recorder := httptest.NewRecorder()
	app.handlePathfinderSettings(recorder, httptest.NewRequest(http.MethodGet, "/pathfinder-settings?namespace=stacks-other", nil))
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("status %d", recorder.Code)
	}
	if recorder.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("settings must not be cached")
	}
}

func TestSettingsProxyAnonymousIdentityPassesVerification(t *testing.T) {
	app := newTestApp(t)
	request := customGuideRequestWithConfig(t, "/pathfinder-settings", "anonymous:0", testGrafanaConfig())
	recorder := httptest.NewRecorder()
	app.handlePathfinderSettings(recorder, request)
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("verified anonymous caller should reach missing-OBO check: %d %s", recorder.Code, recorder.Body.String())
	}
}

func TestSettingsProxyReadOnly(t *testing.T) {
	app := newTestApp(t)
	for _, method := range []string{http.MethodPost, http.MethodPut, http.MethodDelete} {
		recorder := httptest.NewRecorder()
		app.handlePathfinderSettings(recorder, httptest.NewRequest(method, "/pathfinder-settings", nil))
		if recorder.Code != http.StatusMethodNotAllowed {
			t.Fatalf("%s status %d", method, recorder.Code)
		}
	}
}

func TestGuideReadProxyPreservesContent(t *testing.T) {
	const body = `{"metadata":{"name":"welcome-lpqx"},"spec":{"status":"draft","blocks":[{"type":"markdown","content":"Welcome"}]}}`
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/apis/pathfinderbackend.ext.grafana.app/v1alpha1/namespaces/stacks-35611/interactiveguides/welcome-lpqx" {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		if r.Header.Get(auth.AccessTokenHeader) != "anonymous-obo" {
			t.Error("missing OBO token")
		}
		_, _ = w.Write([]byte(body))
	}))
	defer server.Close()
	client := newAppPlatformListClient(server.URL, &stubMinter{token: "anonymous-obo"}, "anonymous-id", log.DefaultLogger)
	got, err := client.getItem(context.Background(), "stacks-35611", "interactiveguides", "welcome-lpqx", customGuideListMaxBytes)
	if err != nil || string(got) != body {
		t.Fatalf("body=%s err=%v", got, err)
	}
}

func TestGuideReadRejectsUnsafeNames(t *testing.T) {
	app := newTestApp(t)
	for _, query := range []string{"", "name=..", "name=../settings", "name=x%2Fy", "name=x%5Cy", "name=%2500", "name=x%00"} {
		recorder := httptest.NewRecorder()
		app.handleCustomGuide(recorder, httptest.NewRequest(http.MethodGet, "/custom-guide?"+query, nil))
		if recorder.Code != http.StatusBadRequest {
			t.Errorf("%q: status %d", query, recorder.Code)
		}
	}
}

func TestAppPlatformReadErrorStatusDoesNotExpireSession(t *testing.T) {
	for _, status := range []int{401, 403, 404, 405, 429, 500, 501, 503, 302} {
		want := status
		if status == 401 || status == 302 {
			want = http.StatusBadGateway
		}
		got := appPlatformReadErrorStatus(&appPlatformUpstreamError{status: status})
		if got != want {
			t.Errorf("upstream %d: got %d, want %d", status, got, want)
		}
	}
}
