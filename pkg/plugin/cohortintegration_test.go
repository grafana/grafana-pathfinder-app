package plugin

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
)

func TestCohortLocalIntegration(t *testing.T) {
	binary := os.Getenv("COHORT_RECOMMENDER_BINARY")
	if binary == "" {
		t.Skip("set COHORT_RECOMMENDER_BINARY to a locally built recommender")
	}
	binary, err := filepath.Abs(binary)
	if err != nil {
		t.Fatal(err)
	}
	hash := func(email string) string { sum := sha256.Sum256([]byte(email)); return hex.EncodeToString(sum[:]) }
	fixture := map[string][]string{hash("alice@example.test"): {"experiment", "community", "experiment"}, hash("bob@example.test"): {"control"}}
	// Intercept the fixture locally without disabling production URL validation.
	fixtureServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.String() != "http://8.8.8.8/cohorts.json" {
			http.Error(w, "unexpected fixture request", http.StatusBadGateway)
			return
		}
		_ = json.NewEncoder(w).Encode(fixture)
	}))
	t.Cleanup(fixtureServer.Close)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	_ = listener.Close()
	base := fmt.Sprintf("http://127.0.0.1:%d", port)
	logFile, err := os.CreateTemp(t.TempDir(), "recommender-*.log")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = logFile.Close() })
	ctx, cancel := context.WithCancel(t.Context())
	process := exec.CommandContext(ctx, binary)
	process.Env = []string{"PATH=" + os.Getenv("PATH"), "HOME=" + t.TempDir(), fmt.Sprintf("PORT=%d", port), "COHORT_MAPPER=file", "COHORT_MAPPINGS_URL=http://8.8.8.8/cohorts.json", "HTTP_PROXY=" + fixtureServer.URL, "HTTPS_PROXY=" + fixtureServer.URL, "COHORT_LOOKUP_TOKEN=local-integration-secret"}
	process.Stdout, process.Stderr = logFile, logFile
	if err := process.Start(); err != nil {
		cancel()
		t.Fatal(err)
	}
	done := make(chan struct{})
	go func() { _ = process.Wait(); close(done) }()
	t.Cleanup(func() { cancel(); <-done })
	client := &http.Client{Timeout: time.Second}
	ready := false
	for deadline := time.Now().Add(15 * time.Second); time.Now().Before(deadline); {
		resp, err := client.Get(base + "/healthz")
		if err == nil {
			_ = resp.Body.Close()
			if resp.StatusCode == 200 {
				ready = true
				break
			}
		}
		time.Sleep(50 * time.Millisecond)
	}
	if !ready {
		data, _ := os.ReadFile(logFile.Name())
		t.Fatalf("recommender did not start: %s", data)
	}
	keys, _ := startJWKSServer(t)
	previous := signingKeysURL
	signingKeysURL = keys.URL + "/api/signing-keys/keys"
	t.Cleanup(func() { signingKeysURL = previous })
	instance, err := NewApp(t.Context(), backend.AppInstanceSettings{DecryptedSecureJSONData: map[string]string{"cohortLookupToken": "local-integration-secret"}})
	if err != nil {
		t.Fatal(err)
	}
	app := instance.(*App)
	var upstreamCalls atomic.Int32
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	t.Cleanup(transport.CloseIdleConnections)
	localURL, _ := url.Parse(base)
	app.cohortClient.Transport = cohortTransport(func(r *http.Request) (*http.Response, error) {
		if r.URL.String() != cohortLookupURL {
			return nil, fmt.Errorf("unexpected upstream destination")
		}
		upstreamCalls.Add(1)
		clone := r.Clone(r.Context())
		clone.URL.Scheme = localURL.Scheme
		clone.URL.Host = localURL.Host
		return transport.RoundTrip(clone)
	})
	mux := http.NewServeMux()
	app.registerRoutes(mux)
	pluginServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r = r.WithContext(backend.WithPluginContext(r.Context(), backend.PluginContext{Namespace: testNamespace}))
		mux.ServeHTTP(w, r)
	}))
	t.Cleanup(pluginServer.Close)
	for _, tc := range []struct {
		name, email, namespace, query string
		expiry                        int64
		status                        int
		want                          string
	}{
		{"alice memberships", "alice@example.test", testNamespace, "", 3600, 200, `{"cohorts":["community","experiment"]}`},
		{"bob isolated", "bob@example.test", testNamespace, "", 3600, 200, `{"cohorts":["control"]}`},
		{"unknown user", "unknown@example.test", testNamespace, "", 3600, 200, `{"cohorts":[]}`},
		{"alice again no cross-user cache", "alice@example.test", testNamespace, "", 3600, 200, `{"cohorts":["community","experiment"]}`},
		{"anonymous", "", testNamespace, "", 3600, 401, ""},
		{"wrong stack", "alice@example.test", "stacks-other", "", 3600, 401, ""},
		{"expired", "alice@example.test", testNamespace, "", -3600, 401, ""},
		{"caller supplied identity", "alice@example.test", testNamespace, "?email_hash=" + hash("bob@example.test"), 3600, 400, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			before := upstreamCalls.Load()
			req, _ := http.NewRequest("GET", pluginServer.URL+"/cohorts/my"+tc.query, nil)
			if tc.email != "" {
				req.Header.Set(backend.GrafanaUserSignInTokenHeaderName, signIDToken(t, idToken{sub: "user:" + tc.email, exp: time.Now().Add(time.Duration(tc.expiry) * time.Second).Unix(), kid: testSigningKeyID, typ: "jwt", key: testSigningKey(), namespace: tc.namespace, email: tc.email, emailVerified: true}))
			}
			resp, err := client.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			data, _ := io.ReadAll(resp.Body)
			_ = resp.Body.Close()
			if resp.StatusCode != tc.status {
				t.Fatalf("status %d body %s", resp.StatusCode, data)
			}
			if tc.want != "" && strings.TrimSpace(string(data)) != tc.want {
				t.Fatalf("body %s", data)
			}
			if resp.Header.Get("Cache-Control") != "no-store" {
				t.Fatal("missing no-store")
			}
			if strings.Contains(string(data), "email") || strings.Contains(string(data), "local-integration-secret") {
				t.Fatal("identity or secret exposed")
			}
			if tc.status != 200 && upstreamCalls.Load() != before {
				t.Fatal("unauthorized upstream call")
			}
		})
	}
	for _, token := range []string{"", "wrong"} {
		t.Run("direct lookup rejects "+token, func(t *testing.T) {
			req, _ := http.NewRequest("POST", base+"/api/v1/cohorts", strings.NewReader(`{"email_hash":"`+hash("alice@example.test")+`"}`))
			req.Header.Set("Authorization", "Bearer "+token)
			req.Header.Set("Origin", "https://example.grafana.net")
			resp, err := client.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			_ = resp.Body.Close()
			if resp.StatusCode != 401 {
				t.Fatalf("status %d", resp.StatusCode)
			}
		})
	}
}
