package plugin

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

func TestBuildAppPlatformURL(t *testing.T) {
	got := buildAppPlatformURL("http://grafana.example/", "pathfinderbackend.ext.grafana.com/v1alpha1", "stacks-1", "completionrecords")
	want := "http://grafana.example/apis/pathfinderbackend.ext.grafana.com/v1alpha1/namespaces/stacks-1/completionrecords"
	if got != want {
		t.Fatalf("url = %q, want %q", got, want)
	}

	escaped := buildAppPlatformURL("http://grafana.example", "g/v1", "stacks/../1", "res")
	if escaped != "http://grafana.example/apis/g/v1/namespaces/stacks%2F..%2F1/res" {
		t.Fatalf("namespace not path-escaped: %q", escaped)
	}
}

// The on-the-wire outbound identity contract: Authorization Bearer + ID-token
// header derived from the caller's ID token, and never a Cookie or a replayed
// inbound Authorization value.
func TestAppPlatformListClient_OutboundIdentityAndPagination(t *testing.T) {
	var gotHeaders []http.Header
	var gotQueries []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotHeaders = append(gotHeaders, r.Header.Clone())
		gotQueries = append(gotQueries, r.URL.RawQuery)
		cont := ""
		if len(gotQueries) == 1 {
			cont = "tok-2"
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"metadata": map[string]any{"continue": cont},
			"items":    []map[string]any{{"spec": map[string]any{"userId": "user:1"}}},
		})
	}))
	defer srv.Close()

	c := newCompletionHTTPClient(srv.URL, "id-token-abc", log.DefaultLogger)

	page1, err := c.ListPage(context.Background(), "stacks-1", "")
	if err != nil {
		t.Fatalf("page 1: %v", err)
	}
	if page1.Continue != "tok-2" {
		t.Fatalf("continue = %q, want tok-2", page1.Continue)
	}
	if _, err := c.ListPage(context.Background(), "stacks-1", page1.Continue); err != nil {
		t.Fatalf("page 2: %v", err)
	}

	for i, h := range gotHeaders {
		if got := h.Get("Authorization"); got != "Bearer id-token-abc" {
			t.Errorf("request %d: Authorization = %q, want Bearer id-token-abc", i, got)
		}
		if got := h.Get(backend.GrafanaUserSignInTokenHeaderName); got != "id-token-abc" {
			t.Errorf("request %d: %s = %q, want id-token-abc", i, backend.GrafanaUserSignInTokenHeaderName, got)
		}
		if got := h.Get("Cookie"); got != "" {
			t.Errorf("request %d: Cookie must never be forwarded, got %q", i, got)
		}
	}
	if gotQueries[0] != "limit=500" {
		t.Errorf("first query = %q, want limit=500", gotQueries[0])
	}
	if gotQueries[1] != "continue=tok-2&limit=500" {
		t.Errorf("second query = %q, want continue token + limit", gotQueries[1])
	}
}

func TestAppPlatformListClient_UpstreamErrorClassification(t *testing.T) {
	cases := []struct {
		status         int
		transient      bool
		identityScoped bool
	}{
		{http.StatusTooManyRequests, true, false},
		{http.StatusBadGateway, true, false},
		{http.StatusUnauthorized, false, true},
		{http.StatusForbidden, false, true},
		{http.StatusNotFound, false, false},
		{http.StatusAccepted, true, false},
	}
	for _, tt := range cases {
		if got := isTransientUpstreamStatus(tt.status); got != tt.transient {
			t.Errorf("isTransientUpstreamStatus(%d) = %v, want %v", tt.status, got, tt.transient)
		}
		if got := isIdentityScopedUpstreamStatus(tt.status); got != tt.identityScoped {
			t.Errorf("isIdentityScopedUpstreamStatus(%d) = %v, want %v", tt.status, got, tt.identityScoped)
		}
	}
}

func TestAppPlatformCreateClient_RequestContract(t *testing.T) {
	const payload = `{"apiVersion":"g/v1","kind":"Thing"}`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("method = %s, want POST", r.Method)
		}
		if r.URL.Path != "/apis/g/v1/namespaces/stacks-1/things" {
			t.Errorf("path = %q", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer id-token-abc" {
			t.Errorf("Authorization = %q", got)
		}
		if got := r.Header.Get(backend.GrafanaUserSignInTokenHeaderName); got != "id-token-abc" {
			t.Errorf("%s = %q", backend.GrafanaUserSignInTokenHeaderName, got)
		}
		if got := r.Header.Get("Content-Type"); got != "application/json" {
			t.Errorf("Content-Type = %q", got)
		}
		body, _ := io.ReadAll(r.Body)
		if string(body) != payload {
			t.Errorf("body = %q", body)
		}
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"metadata":{"name":"created"}}`))
	}))
	defer srv.Close()

	client := newAppPlatformListClient(srv.URL, "id-token-abc", log.DefaultLogger)
	body, err := client.create(context.Background(), "g/v1", "stacks-1", "things", []byte(payload), 1024)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if string(body) != `{"metadata":{"name":"created"}}` {
		t.Fatalf("response body = %q", body)
	}
}

func TestAppPlatformCreateClient_ResponseContract(t *testing.T) {
	tests := []struct {
		name           string
		status         int
		response       string
		maxBytes       int64
		retryAfter     string
		wantErr        bool
		wantStatus     int
		wantRetryAfter string
	}{
		{"200 accepted", http.StatusOK, `{}`, 16, "", false, 0, ""},
		{"201 accepted", http.StatusCreated, `{}`, 16, "", false, 0, ""},
		{"202 rejected", http.StatusAccepted, `{}`, 16, "", true, http.StatusAccepted, ""},
		{"429 preserves retry-after", http.StatusTooManyRequests, `{}`, 16, "12", true, http.StatusTooManyRequests, "12"},
		{"oversized response", http.StatusCreated, strings.Repeat("x", 17), 16, "", true, 0, ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if tc.retryAfter != "" {
					w.Header().Set("Retry-After", tc.retryAfter)
				}
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.response))
			}))
			defer srv.Close()

			client := newAppPlatformListClient(srv.URL, "id-token-abc", log.DefaultLogger)
			_, err := client.create(context.Background(), "g/v1", "stacks-1", "things", []byte(`{}`), tc.maxBytes)
			if (err != nil) != tc.wantErr {
				t.Fatalf("error = %v, wantErr %v", err, tc.wantErr)
			}
			if tc.wantStatus != 0 {
				if got, ok := upstreamStatusOf(err); !ok || got != tc.wantStatus {
					t.Fatalf("upstream status = %d, %v; want %d", got, ok, tc.wantStatus)
				}
			}
			if got := upstreamRetryAfterOf(err); got != tc.wantRetryAfter {
				t.Fatalf("Retry-After = %q, want %q", got, tc.wantRetryAfter)
			}
		})
	}
}
