package plugin

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/grafana/grafana-pathfinder-app/pkg/plugin/auth"
	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	sdkconfig "github.com/grafana/grafana-plugin-sdk-go/config"
)

func customGuidesTestApp(t *testing.T, upstream http.HandlerFunc, mintStatus int) (*App, map[string]string) {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc(auth.SigningKeysPath, func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write(jwksBody(testSigningKeyID, testSigningKey()))
	})
	mux.HandleFunc("/mint", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(mintStatus)
		_, _ = w.Write([]byte(`{"data":{"token":"caller-token"}}`))
	})
	mux.HandleFunc("/apis/", upstream)
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	app := newTestApp(t)
	exchanger, err := auth.New("cap-token", server.URL+"/mint")
	if err != nil {
		t.Fatal(err)
	}
	app.oboExchanger = exchanger
	cfg := testGrafanaConfig()
	cfg[sdkconfig.AppURL] = server.URL
	return app, cfg
}

func TestCustomGuidesProxyPreservesResourcesAndDrainsPages(t *testing.T) {
	const first = `{"apiVersion":"pathfinderbackend.ext.grafana.app/v1alpha1","kind":"InteractiveGuide","metadata":{"name":"guide-a","resourceVersion":"42","uid":"uid-a","creationTimestamp":"2026-10-01T00:00:00Z","annotations":{"source":"editor"},"labels":{"team":"observability"}},"spec":{"status":"draft","blocks":[{"type":"markdown","content":"Hello"}]},"futureField":{"preserve":true}}`
	const second = `{"metadata":{"name":"guide-b"},"spec":{"status":"published"}}`
	tokens := make(chan string, 3)
	app, cfg := customGuidesTestApp(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/apis/"+customGuideGroupVersion+"/namespaces/"+testNamespace+"/interactiveguides" {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		if r.URL.Query().Get("limit") != "100" || r.Header.Get(auth.AccessTokenHeader) != "caller-token" {
			t.Error("missing full-resource page limit or caller token")
		}
		for _, header := range []string{"Cookie", "Authorization", backend.GrafanaUserSignInTokenHeaderName} {
			if r.Header.Get(header) != "" {
				t.Errorf("forwarded %s", header)
			}
		}
		token := r.URL.Query().Get("continue")
		tokens <- token
		switch token {
		case "":
			_, _ = w.Write([]byte(`{"metadata":{"continue":"next+/="},"items":[` + first + ` ]}`))
		case "next+/=":
			_, _ = w.Write([]byte(`{"items":[` + second + `]}`))
		default:
			t.Errorf("unexpected continue token %s", token)
		}
	}, http.StatusOK)
	recorder := httptest.NewRecorder()
	mux := http.NewServeMux()
	app.registerRoutes(mux)
	mux.ServeHTTP(recorder, customGuideRequestWithConfig(t, "/custom-guides?namespace=stacks-other", "user:1", cfg))
	if recorder.Code != http.StatusOK || recorder.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("status=%d headers=%v body=%s", recorder.Code, recorder.Header(), recorder.Body.String())
	}
	var got customGuidesResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if len(got.Items) != 2 || len(tokens) != 2 {
		t.Fatalf("items=%d pages=%d", len(got.Items), len(tokens))
	}
	gotTokens := []string{<-tokens, <-tokens}
	if !reflect.DeepEqual(gotTokens, []string{"", "next+/="}) {
		t.Fatalf("continue tokens %v", gotTokens)
	}
	for i, want := range []string{first, second} {
		var actual, expected any
		if err := json.Unmarshal(got.Items[i], &actual); err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal([]byte(want), &expected); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(actual, expected) {
			t.Fatalf("resource %d changed: %s", i, got.Items[i])
		}
	}
}

func TestCustomGuidesProxyFailures(t *testing.T) {
	for _, tc := range []struct {
		name                 string
		upstream, mint, want int
		body                 string
	}{
		{"upstream 401", 401, 200, 502, ""},
		{"upstream 403", 403, 200, 403, ""},
		{"upstream 503", 503, 200, 503, ""},
		{"invalid JSON", 200, 200, 502, "invalid"},
		{"oversized page", 200, 200, 502, strings.Repeat(" ", customGuideListMaxBytes+1)},
		{"failed token exchange", 200, 403, 502, `{"items":[]}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			app, cfg := customGuidesTestApp(t, func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(tc.upstream)
				_, _ = w.Write([]byte(tc.body))
			}, tc.mint)
			recorder := httptest.NewRecorder()
			app.handleCustomGuides(recorder, customGuideRequestWithConfig(t, "/custom-guides", "user:1", cfg))
			if recorder.Code != tc.want || recorder.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("status=%d want=%d body=%s", recorder.Code, tc.want, recorder.Body.String())
			}
		})
	}
}

func TestCustomGuidesProxyIdentityAndMethodGates(t *testing.T) {
	app := newTestApp(t)
	for _, method := range []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodDelete} {
		recorder := httptest.NewRecorder()
		app.handleCustomGuides(recorder, httptest.NewRequest(method, "/custom-guides", nil))
		want := http.StatusMethodNotAllowed
		if method == http.MethodGet {
			want = http.StatusForbidden
		}
		if recorder.Code != want || recorder.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("%s status=%d want=%d", method, recorder.Code, want)
		}
	}
	recorder := httptest.NewRecorder()
	app.handleCustomGuides(recorder, customGuideRequest(t, "/custom-guides", "user:1"))
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("missing OBO credential: %d", recorder.Code)
	}
}

func TestCustomGuidesDrainByteBudget(t *testing.T) {
	const item = `{"metadata":{"name":"guide"},"spec":{"blocks":[]}}`
	for _, paginated := range []bool{false, true} {
		t.Run(map[bool]string{false: "within page", true: "across pages"}[paginated], func(t *testing.T) {
			var calls atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				if !paginated {
					_, _ = w.Write([]byte(`{"metadata":{"continue":"unused"},"items":[` + item + `,` + item + `]}`))
				} else {
					_, _ = w.Write([]byte(`{"metadata":{"continue":"next"},"items":[` + item + `]}`))
				}
			}))
			defer server.Close()
			logger := newCapturingLogger()
			client := newAppPlatformListClient(server.URL, &stubMinter{token: "token"}, "id", logger)
			maxBytes := int64(len(`{"items":[]}`) + len(item))
			got, err := client.drainGuideResources(context.Background(), testNamespace, maxBytes)
			wantCalls := 1
			if paginated {
				wantCalls = 2
			}
			if err != nil || len(got) != 1 || int(calls.Load()) != wantCalls || !logger.warnedWith("list truncated") {
				t.Fatalf("items=%d calls=%d err=%v logs=%v", len(got), calls.Load(), err, *logger.lines)
			}
		})
	}
}

func TestCustomGuidesProxyDoesNotCacheAcrossCallers(t *testing.T) {
	var calls atomic.Int32
	app, cfg := customGuidesTestApp(t, func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		_, _ = w.Write([]byte(`{"items":[]}`))
	}, http.StatusOK)
	for _, user := range []string{"user:1", "user:2"} {
		recorder := httptest.NewRecorder()
		app.handleCustomGuides(recorder, customGuideRequestWithConfig(t, "/custom-guides", user, cfg))
		if recorder.Code != http.StatusOK || strings.TrimSpace(recorder.Body.String()) != `{"items":[]}` {
			t.Fatalf("empty list response %d %s", recorder.Code, recorder.Body.String())
		}
	}
	if calls.Load() != 2 {
		t.Fatalf("expected each caller to fetch, got %d requests", calls.Load())
	}
}

func TestCustomGuidesDrainHonorsCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	client := newAppPlatformListClient("http://localhost", &stubMinter{token: "token"}, "id", log.DefaultLogger)
	_, err := client.drainGuideResources(ctx, testNamespace, customGuidesMaxBytes)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected cancellation, got %v", err)
	}
}
