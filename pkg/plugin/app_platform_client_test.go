package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

func TestBuildAppPlatformURL(t *testing.T) {
	got := buildAppPlatformURL("http://grafana.example/", "pathfinderbackend.ext.grafana.app/v1alpha1", "stacks-1", "completionrecords")
	want := "http://grafana.example/apis/pathfinderbackend.ext.grafana.app/v1alpha1/namespaces/stacks-1/completionrecords"
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

// TestCompletionHTTPClient_Create_WireComposition composes the production
// completionHTTPClient.Create over the real HTTP adapter and pins the on-the-wire
// contract the CRD sees: the completionrecords collection URL, the forwarded
// identity headers, and the COMPLETE serialized CompletionRecord object
// (apiVersion/kind/metadata + full spec). The handler and adapter layers can each
// pass in isolation while this composition drifts — finding 5.
func TestCompletionHTTPClient_Create_WireComposition(t *testing.T) {
	var gotPath string
	var gotHeaders http.Header
	var gotBody []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotHeaders = r.Header.Clone()
		gotBody, _ = io.ReadAll(r.Body)
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"metadata":{"name":"completion-abc"}}`))
	}))
	defer srv.Close()

	client := newCompletionHTTPClient(srv.URL, "id-token-abc", log.DefaultLogger)
	spec := completionRecordWriteSpec{
		GuideID: "first-dashboard", GuideSource: "bundled", GuideTitle: "First dashboard",
		PathID: "", Source: "objectives", CompletedAt: "2026-07-20T10:00:00Z",
		DurationSeconds: 4, CompletionPercent: 100, GuideCategory: "interactive", Platform: "cloud",
		UserID: "user:abc", UserLogin: "alice", UserDisplayName: "Alice",
		RecordedAt: "2026-07-20T10:00:01Z", OrgID: 7, StackNamespace: "stacks-1", SchemaVersion: 1,
	}
	obj := completionRecordObject{Metadata: completionRecordObjectMeta{Name: "completion-abc"}, Spec: spec}
	if err := client.Create(context.Background(), "stacks-1", obj); err != nil {
		t.Fatalf("Create: %v", err)
	}

	wantPath := "/apis/pathfinderbackend.ext.grafana.app/v1alpha1/namespaces/stacks-1/completionrecords"
	if gotPath != wantPath {
		t.Errorf("path = %q, want %q", gotPath, wantPath)
	}
	if got := gotHeaders.Get("Authorization"); got != "Bearer id-token-abc" {
		t.Errorf("Authorization = %q, want Bearer id-token-abc", got)
	}
	if got := gotHeaders.Get(backend.GrafanaUserSignInTokenHeaderName); got != "id-token-abc" {
		t.Errorf("%s = %q, want id-token-abc", backend.GrafanaUserSignInTokenHeaderName, got)
	}
	if got := gotHeaders.Get("Content-Type"); got != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", got)
	}

	// The wire object must carry the coordinates the client stamps plus the full
	// spec — decode and compare the whole object, not a substring.
	var wire completionRecordObject
	if err := json.Unmarshal(gotBody, &wire); err != nil {
		t.Fatalf("wire body is not a CompletionRecord: %v (body: %s)", err, gotBody)
	}
	if wire.APIVersion != completionRecordsGroupVersion || wire.Kind != "CompletionRecord" {
		t.Errorf("coordinates = %s/%s, want %s/CompletionRecord", wire.APIVersion, wire.Kind, completionRecordsGroupVersion)
	}
	if wire.Metadata.Name != "completion-abc" || wire.Metadata.Namespace != "stacks-1" {
		t.Errorf("metadata = %+v, want name=completion-abc namespace=stacks-1", wire.Metadata)
	}
	if wire.Spec != spec {
		t.Errorf("wire spec = %+v, want %+v", wire.Spec, spec)
	}

	// Decoding into the Go struct cannot distinguish an omitted key from an empty
	// one, so pin the raw spec key set: every CRD-required field must be present
	// on the wire, including zero-valued ones. pathId is the specific empty field
	// finding 5 flagged — it must serialize as an explicit "" key, not be dropped.
	var envelope struct {
		Spec map[string]json.RawMessage `json:"spec"`
	}
	if err := json.Unmarshal(gotBody, &envelope); err != nil {
		t.Fatalf("wire spec not decodable as an object: %v (body: %s)", err, gotBody)
	}
	for _, key := range []string{
		"guideId", "guideSource", "guideTitle", "pathId", "source", "completedAt",
		"durationSeconds", "completionPercent", "guideCategory", "platform",
		"userId", "userLogin", "userDisplayName", "recordedAt", "orgId",
		"stackNamespace", "schemaVersion",
	} {
		if _, ok := envelope.Spec[key]; !ok {
			t.Errorf("wire spec missing required key %q (zero-valued fields must still be present)", key)
		}
	}
	if got := string(envelope.Spec["pathId"]); got != `""` {
		t.Errorf("pathId on the wire = %s, want an explicit empty string", got)
	}
}

// TestCompletionHTTPClient_Create_OversizedSuccessBodyIsNotRetryable pins
// finding 1 through the production wrapper: a 201 whose body exceeds the write
// cap is a success, never a retryable error — the record is already durable and
// a retry would mint a fresh name and duplicate it.
func TestCompletionHTTPClient_Create_OversizedSuccessBodyIsNotRetryable(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(strings.Repeat("x", completionWriteMaxBytes+1)))
	}))
	defer srv.Close()

	client := newCompletionHTTPClient(srv.URL, "id-token-abc", log.DefaultLogger)
	obj := completionRecordObject{Metadata: completionRecordObjectMeta{Name: "completion-abc"}}
	if err := client.Create(context.Background(), "stacks-1", obj); err != nil {
		t.Fatalf("Create returned error on an over-cap 201 body: %v (must be treated as success)", err)
	}
}

// errAfterStatusBody returns a non-EOF read error, simulating a body that fails
// to arrive intact AFTER the success status line was received.
type errAfterStatusBody struct{}

func (errAfterStatusBody) Read([]byte) (int, error) { return 0, fmt.Errorf("simulated body read failure") }
func (errAfterStatusBody) Close() error             { return nil }

// successThenBodyReadErrorTransport answers every request with a bare 201 whose
// body errors on the first Read.
type successThenBodyReadErrorTransport struct{}

func (successThenBodyReadErrorTransport) RoundTrip(*http.Request) (*http.Response, error) {
	return &http.Response{
		StatusCode: http.StatusCreated,
		Status:     "201 Created",
		Header:     make(http.Header),
		Body:       errAfterStatusBody{},
	}, nil
}

// TestAppPlatformCreateClient_SuccessBodyReadErrorIsNotRetryable pins the other
// half of finding 1: a body-read error AFTER a 200/201 must still return success.
// The record is already durable and the body is unused, so surfacing the read
// error would mask a committed write as a retryable failure.
func TestAppPlatformCreateClient_SuccessBodyReadErrorIsNotRetryable(t *testing.T) {
	client := &appPlatformListClient{
		appURL:     "http://example.invalid",
		idToken:    "id-token-abc",
		httpClient: &http.Client{Transport: successThenBodyReadErrorTransport{}},
		logger:     log.DefaultLogger,
	}
	if _, err := client.create(context.Background(), "g/v1", "stacks-1", "things", []byte(`{}`), 1024); err != nil {
		t.Fatalf("create returned error on a post-201 body read failure: %v (must be treated as success)", err)
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
		// A 201 whose body exceeds the cap is NOT an error: the record is already
		// durable, the body is unused, and turning it into a retryable failure
		// would mint a fresh name on retry and duplicate the record (finding 1).
		{"oversized body on 201 is still success", http.StatusCreated, strings.Repeat("x", 17), 16, "", false, 0, ""},
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
