package plugin

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

func TestIsCodaAuthError(t *testing.T) {
	tests := []struct {
		name     string
		err      error
		expected bool
	}{
		{"nil error", nil, false},
		{"unrelated error", errors.New("connection timeout"), false},
		{"prose-only auth message", errors.New("authentication failed"), false},
		{"local auth setup failure", &codaAuthSetupError{err: errors.New("refresh token invalid or revoked")}, true},
		{"upstream 401", &codaUpstreamError{status: http.StatusUnauthorized, msg: "nope"}, true},
		{"upstream 403", &codaUpstreamError{status: http.StatusForbidden, msg: "nope"}, false},
		{"upstream 500", &codaUpstreamError{status: http.StatusInternalServerError, msg: "boom"}, false},
		{"upstream 500 with auth text in body", &codaUpstreamError{status: http.StatusInternalServerError, msg: "unexpected status code 500: authentication failed"}, false},
		{"wrapped upstream 401", fmt.Errorf("list: %w", &codaUpstreamError{status: http.StatusUnauthorized, msg: "nope"}), true},
		{"wrapped local auth setup failure", fmt.Errorf("list: %w", &codaAuthSetupError{err: errors.New("boom")}), true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isCodaAuthError(tt.err); got != tt.expected {
				t.Errorf("isCodaAuthError(%v) = %v, want %v", tt.err, got, tt.expected)
			}
		})
	}
}

func TestIsCodaNotFoundError(t *testing.T) {
	tests := []struct {
		name     string
		err      error
		expected bool
	}{
		{"nil error", nil, false},
		{"prose-only not found message", errors.New("VM not found: abc-123"), false},
		{"upstream 404", &codaUpstreamError{status: http.StatusNotFound, msg: "VM not found: abc-123"}, true},
		{"upstream 401", &codaUpstreamError{status: http.StatusUnauthorized, msg: "nope"}, false},
		{"wrapped upstream 404", fmt.Errorf("get: %w", &codaUpstreamError{status: http.StatusNotFound, msg: "gone"}), true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isCodaNotFoundError(tt.err); got != tt.expected {
				t.Errorf("isCodaNotFoundError(%v) = %v, want %v", tt.err, got, tt.expected)
			}
		})
	}
}

// codaAuthSetupError preserves the message shape callers previously built with
// fmt.Errorf("authentication failed: %w", err), so log output is unchanged.
func TestCodaAuthSetupErrorMessage(t *testing.T) {
	inner := errors.New("refresh token invalid or revoked, please re-register")
	err := error(&codaAuthSetupError{err: inner})

	if want := "authentication failed: " + inner.Error(); err.Error() != want {
		t.Errorf("Error() = %q, want %q", err.Error(), want)
	}
	if !errors.Is(err, inner) {
		t.Error("errors.Is did not unwrap to the inner error")
	}
}

func TestNewCodaUpstreamErrorDoesNotLeakBodyOn401(t *testing.T) {
	resp := &http.Response{
		StatusCode: http.StatusUnauthorized,
		Body:       io.NopCloser(strings.NewReader("secret upstream detail")),
	}

	err := newCodaUpstreamError(resp)

	if !isCodaAuthError(err) {
		t.Error("401 response did not classify as a Coda auth error")
	}
	if strings.Contains(err.Error(), "secret upstream detail") {
		t.Errorf("401 message leaked the upstream body: %q", err.Error())
	}
}

func TestNewCodaUpstreamErrorKeepsGenericMessageShape(t *testing.T) {
	resp := &http.Response{
		StatusCode: http.StatusBadGateway,
		Body:       io.NopCloser(strings.NewReader("upstream down")),
	}

	err := newCodaUpstreamError(resp)

	if want := "unexpected status code 502: upstream down"; err.Error() != want {
		t.Errorf("Error() = %q, want %q", err.Error(), want)
	}
	if isCodaAuthError(err) {
		t.Error("502 must not classify as a Coda auth error")
	}
}

// codaSuccessBody decodes cleanly into every Coda response type used by the
// resource handlers, so one fake upstream body serves every route.
const codaSuccessBody = `{"id":"vm-1","vms":[],"apps":[],"scenarios":[]}`

func codaTestServer(t *testing.T, status int, body string) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/auth/refresh" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = io.WriteString(w, body)
	}))
	t.Cleanup(srv.Close)
	return srv
}

// codaTestApp builds an App whose Coda client targets apiURL. When tokenValid
// is false the cached access token is empty, forcing a refresh that the fake
// upstream rejects — the local auth-setup failure path.
func codaTestApp(apiURL string, tokenValid bool) *App {
	client := &CodaClient{
		apiURL:       apiURL,
		refreshToken: "stale-refresh-token",
		client:       &http.Client{Timeout: 5 * time.Second},
	}
	if tokenValid {
		client.accessToken = "test-access-token"
		client.tokenExpiry = time.Now().Add(time.Hour)
	}
	return &App{logger: log.DefaultLogger, coda: client}
}

func serveCoda(app *App, method, path, body string) *httptest.ResponseRecorder {
	mux := http.NewServeMux()
	app.registerRoutes(mux)

	var reqBody io.Reader
	if body != "" {
		reqBody = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, reqBody)
	req.Header.Set("X-Grafana-User", "tester")

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

// TestCodaHandlerStatusClassification pins the HTTP status every Coda-backed
// route returns for each upstream outcome. Before the typed-error change,
// /sample-apps and /alloy-scenarios returned 500 for an upstream 401.
func TestCodaHandlerStatusClassification(t *testing.T) {
	routes := []struct {
		name        string
		method      string
		path        string
		requestBody string
		wantSuccess int
		extra       []struct {
			name           string
			upstreamStatus int
			wantStatus     int
		}
	}{
		{name: "sample apps", method: http.MethodGet, path: "/sample-apps", wantSuccess: http.StatusOK},
		{name: "alloy scenarios", method: http.MethodGet, path: "/alloy-scenarios", wantSuccess: http.StatusOK},
		{name: "list vms", method: http.MethodGet, path: "/vms", wantSuccess: http.StatusOK},
		{
			name:        "create vm",
			method:      http.MethodPost,
			path:        "/vms",
			requestBody: `{"template":"vm-aws"}`,
			wantSuccess: http.StatusCreated,
			extra: []struct {
				name           string
				upstreamStatus int
				wantStatus     int
			}{
				{"upstream 429 quota", http.StatusTooManyRequests, http.StatusInternalServerError},
				{"upstream 409 conflict", http.StatusConflict, http.StatusInternalServerError},
			},
		},
		{
			name:        "get vm",
			method:      http.MethodGet,
			path:        "/vms/vm-1",
			wantSuccess: http.StatusOK,
			extra: []struct {
				name           string
				upstreamStatus int
				wantStatus     int
			}{
				{"upstream 404", http.StatusNotFound, http.StatusNotFound},
			},
		},
		{name: "delete vm", method: http.MethodDelete, path: "/vms/vm-1", wantSuccess: http.StatusNoContent},
	}

	for _, route := range routes {
		t.Run(route.name, func(t *testing.T) {
			t.Run("upstream 401 returns 401", func(t *testing.T) {
				srv := codaTestServer(t, http.StatusUnauthorized, `{"error":"token expired"}`)
				rec := serveCoda(codaTestApp(srv.URL, true), route.method, route.path, route.requestBody)
				assertStatus(t, rec, http.StatusUnauthorized)
			})

			t.Run("upstream 500 returns 500", func(t *testing.T) {
				srv := codaTestServer(t, http.StatusInternalServerError, `{"error":"boom"}`)
				rec := serveCoda(codaTestApp(srv.URL, true), route.method, route.path, route.requestBody)
				assertStatus(t, rec, http.StatusInternalServerError)
			})

			t.Run("upstream 503 returns 500", func(t *testing.T) {
				srv := codaTestServer(t, http.StatusServiceUnavailable, `{"error":"unavailable"}`)
				rec := serveCoda(codaTestApp(srv.URL, true), route.method, route.path, route.requestBody)
				assertStatus(t, rec, http.StatusInternalServerError)
			})

			t.Run("local auth setup failure returns 401", func(t *testing.T) {
				srv := codaTestServer(t, http.StatusOK, codaSuccessBody)
				rec := serveCoda(codaTestApp(srv.URL, false), route.method, route.path, route.requestBody)
				assertStatus(t, rec, http.StatusUnauthorized)
			})

			t.Run("success", func(t *testing.T) {
				srv := codaTestServer(t, http.StatusOK, codaSuccessBody)
				rec := serveCoda(codaTestApp(srv.URL, true), route.method, route.path, route.requestBody)
				assertStatus(t, rec, route.wantSuccess)
			})

			for _, extra := range route.extra {
				t.Run(extra.name, func(t *testing.T) {
					srv := codaTestServer(t, extra.upstreamStatus, `{"error":"nope"}`)
					rec := serveCoda(codaTestApp(srv.URL, true), route.method, route.path, route.requestBody)
					assertStatus(t, rec, extra.wantStatus)
				})
			}
		})
	}
}

// TestCodaListRoutesSurfaceReRegisterHint covers the user-visible half of the
// fix: an expired token must tell the frontend to re-register, not report a
// generic upstream failure.
func TestCodaListRoutesSurfaceReRegisterHint(t *testing.T) {
	for _, path := range []string{"/sample-apps", "/alloy-scenarios"} {
		t.Run(path, func(t *testing.T) {
			srv := codaTestServer(t, http.StatusUnauthorized, `{"error":"token expired"}`)
			rec := serveCoda(codaTestApp(srv.URL, true), http.MethodGet, path, "")

			assertStatus(t, rec, http.StatusUnauthorized)
			if !strings.Contains(rec.Body.String(), "re-register") {
				t.Errorf("body = %q, want a re-register hint", rec.Body.String())
			}
		})
	}
}

func TestCodaHandlersUnavailableWithoutClient(t *testing.T) {
	for _, tc := range []struct {
		method string
		path   string
		body   string
	}{
		{http.MethodGet, "/sample-apps", ""},
		{http.MethodGet, "/alloy-scenarios", ""},
		{http.MethodGet, "/vms", ""},
		{http.MethodPost, "/vms", `{"template":"vm-aws"}`},
		{http.MethodGet, "/vms/vm-1", ""},
		{http.MethodDelete, "/vms/vm-1", ""},
	} {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			rec := serveCoda(newTestApp(t), tc.method, tc.path, tc.body)
			assertStatus(t, rec, http.StatusServiceUnavailable)
		})
	}
}

func assertStatus(t *testing.T, rec *httptest.ResponseRecorder, want int) {
	t.Helper()
	if rec.Code != want {
		t.Errorf("status = %d, want %d (body: %s)", rec.Code, want, rec.Body.String())
	}
}
