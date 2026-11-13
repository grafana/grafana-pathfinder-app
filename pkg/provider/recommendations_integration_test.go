package provider

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"strings"
	"sync/atomic"
	"testing"

	authlib "github.com/grafana/authlib/types"
	"github.com/grafana/grafana-app-sdk/app"
	"github.com/grafana/grafana-app-sdk/resource"
	"github.com/grafana/grafana-pathfinder-app/pkg/publiccontent"
)

type recommendationCDNTransport struct {
	t        *testing.T
	scenario string
	calls    atomic.Int32
}

func (transport *recommendationCDNTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	transport.calls.Add(1)
	if request.URL.Host != "interactive-learning.grafana.net" || request.Method != http.MethodGet {
		transport.t.Errorf("unexpected CDN request: %s %s", request.Method, request.URL)
	}
	for _, header := range []string{"Authorization", "Cookie", "X-Grafana-User", "X-Grafana-Org-Id"} {
		if request.Header.Get(header) != "" {
			transport.t.Errorf("private header sent to CDN: %s", header)
		}
	}
	status := 200
	body := `{"guide":{"path":"guide/v1","title":"Guide","type":"guide","targeting":{"match":{"urlPrefix":"/explore"}}}}`
	if strings.HasSuffix(request.URL.Path, "/manifest.json") {
		body = `{"id":"guide","type":"guide","milestones":["first"]}`
	} else if transport.scenario == "unavailable" {
		status, body = 503, "unavailable"
	} else if transport.scenario == "malformed" {
		body = "not-json"
	}
	return &http.Response{StatusCode: status, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(body)), Request: request}, nil
}

func TestRecommendationsSDKFetchAndSharedCache(t *testing.T) {
	scenario := os.Getenv("PATHFINDER_RECOMMENDATIONS_CHILD")
	if scenario == "" {
		for _, scenario := range []string{"success", "unavailable", "malformed"} {
			t.Run(scenario, func(t *testing.T) {
				command := exec.Command(os.Args[0], "-test.run=^TestRecommendationsSDKFetchAndSharedCache$", "-test.count=1")
				command.Env = append(os.Environ(), "PATHFINDER_RECOMMENDATIONS_CHILD="+scenario)
				if output, err := command.CombinedOutput(); err != nil {
					t.Fatalf("%v\n%s", err, output)
				}
			})
		}
		return
	}
	// Each child starts with an empty process-wide public cache.
	transport := &recommendationCDNTransport{t: t, scenario: scenario}
	previous := http.DefaultTransport
	http.DefaultTransport = transport
	t.Cleanup(func() { http.DefaultTransport = previous })
	handler := recommendationsHandler(publiccontent.ReadRecommendations)
	for index, namespace := range []string{"default", "other"} {
		ctx := context.Background()
		if index == 1 {
			ctx = authlib.WithAuthInfo(ctx, completionIdentity{testIdentity: testIdentity{namespace: namespace}, subject: "user:other"})
		}
		response := httptest.NewRecorder()
		if err := handler(ctx, response, &app.CustomRouteRequest{Method: http.MethodGet, ResourceIdentifier: resource.FullIdentifier{Namespace: namespace}}); err != nil {
			t.Fatal(err)
		}
		var body struct {
			BaseURL     string                       `json:"baseUrl"`
			Packages    []publiccontent.PackageEntry `json:"packages"`
			Error       string                       `json:"error"`
			Diagnostics struct {
				Outcome, Reason, Cache string
				UpstreamStatus         int
				CacheAgeMS             int64
			}
		}
		if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		cache := "refresh"
		if index == 1 {
			cache = "hit"
		}
		if body.Diagnostics.Cache != cache || body.Diagnostics.CacheAgeMS < 0 {
			t.Fatalf("diagnostics=%+v", body.Diagnostics)
		}
		if response.Header().Get("Content-Type") != "application/json" {
			t.Fatal("missing JSON content type")
		}
		if scenario == "success" {
			if response.Code != 200 || body.BaseURL != "https://interactive-learning.grafana.net/packages/" || len(body.Packages) != 1 || body.Packages[0].ID != "guide" || body.Packages[0].Manifest["id"] != "guide" || body.Packages[0].Manifest["type"] != "guide" || body.Diagnostics.Outcome != "ok" {
				t.Fatalf("response=%s", response.Body)
			}
			if transport.calls.Load() != 2 {
				t.Fatalf("expected index and manifest once, calls=%d", transport.calls.Load())
			}
		} else {
			reason, status := "invalid-json", 0
			if scenario == "unavailable" {
				reason, status = "http-error", 503
			}
			if response.Code != 503 || body.Error != "package-index-unavailable" || body.Diagnostics.Reason != reason || body.Diagnostics.UpstreamStatus != status || transport.calls.Load() != 1 {
				t.Fatalf("response=%s calls=%d", response.Body, transport.calls.Load())
			}
		}
	}
}
