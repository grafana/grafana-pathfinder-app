package plugin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"

	"github.com/grafana/grafana-pathfinder-app/pkg/plugin/auth"
)

// stubMinter stands in for auth.Exchanger so client tests never need an
// auth-api: it echoes a fixed token, or fails when err is set, and records the
// namespace + id token it was called with so tests can pin subject forwarding.
type stubMinter struct {
	token        string
	err          error
	gotNamespace string
	gotIDToken   string
}

func (s *stubMinter) Mint(_ context.Context, namespace, idToken string) (string, error) {
	s.gotNamespace = namespace
	s.gotIDToken = idToken
	if s.err != nil {
		return "", s.err
	}
	return s.token, nil
}

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

// The on-the-wire outbound credential contract: the minted access token on
// X-Access-Token, and nothing else — no ID token in either header slot, no
// Cookie, no replayed inbound Authorization value.
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

	minter := &stubMinter{token: "at-xyz"}
	c := newCompletionHTTPClient(srv.URL, minter, "id-token-abc", log.DefaultLogger)

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
		if got := h.Get(auth.AccessTokenHeader); got != "at-xyz" {
			t.Errorf("request %d: %s = %q, want the minted token at-xyz", i, auth.AccessTokenHeader, got)
		}
		// The ID token is an attestation, not a credential: it must not leave the
		// plugin, in either header slot.
		if got := h.Get("Authorization"); got != "" {
			t.Errorf("request %d: Authorization must not be sent, got %q", i, got)
		}
		if got := h.Get(backend.GrafanaUserSignInTokenHeaderName); got != "" {
			t.Errorf("request %d: %s must not be sent, got %q", i, backend.GrafanaUserSignInTokenHeaderName, got)
		}
		if got := h.Get("Cookie"); got != "" {
			t.Errorf("request %d: Cookie must never be forwarded, got %q", i, got)
		}
	}
	// Subject forwarding: the caller's ID token and the server-derived namespace
	// must reach the minter, or the OBO token would be minted for the wrong
	// user/stack.
	if minter.gotIDToken != "id-token-abc" {
		t.Errorf("minter received idToken %q, want id-token-abc", minter.gotIDToken)
	}
	if minter.gotNamespace != "stacks-1" {
		t.Errorf("minter received namespace %q, want stacks-1", minter.gotNamespace)
	}
	if gotQueries[0] != "limit=500" {
		t.Errorf("first query = %q, want limit=500", gotQueries[0])
	}
	if gotQueries[1] != "continue=tok-2&limit=500" {
		t.Errorf("second query = %q, want continue token + limit", gotQueries[1])
	}
}

// A failed exchange must abort the request rather than fall back to an
// unauthenticated call, and must stay transient (no HTTP status) so the caller
// retries instead of caching a terminal failure.
func TestAppPlatformListClient_MintFailureAbortsRequest(t *testing.T) {
	var upstreamCalls int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upstreamCalls++
		_ = json.NewEncoder(w).Encode(map[string]any{"items": []map[string]any{}})
	}))
	defer srv.Close()

	c := newCompletionHTTPClient(srv.URL, &stubMinter{err: errors.New("exchange refused")}, "id-token-abc", log.DefaultLogger)

	_, err := c.ListPage(context.Background(), "stacks-1", "")
	if err == nil {
		t.Fatal("expected an error when the exchange fails")
	}
	if upstreamCalls != 0 {
		t.Errorf("upstream was called %d times, want 0", upstreamCalls)
	}
	if isTerminalUpstreamError(err) {
		t.Errorf("mint failure should be transient, got terminal: %v", err)
	}
}

func TestAppPlatformListClient_UpstreamErrorClassification(t *testing.T) {
	cases := []struct {
		status         int
		transient      bool
		identityScoped bool
	}{
		{http.StatusTooManyRequests, true, false},
		{http.StatusRequestTimeout, true, false},
		{http.StatusBadGateway, true, false},
		{http.StatusUnauthorized, false, true},
		{http.StatusForbidden, false, true},
		{http.StatusNotFound, false, false},
		{http.StatusAccepted, true, false},
		{http.StatusFound, true, false},
		{http.StatusTemporaryRedirect, true, false},
		{http.StatusPermanentRedirect, true, false},
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

// Failure scope (may this be shared across callers?) is orthogonal to
// transient/terminal, and is an allow-list: only positively recognized
// namespace-global shapes are shareable.
func TestAppPlatformListClient_FailureScopeClassification(t *testing.T) {
	mintFailure := fmt.Errorf("%w: %w", errAccessTokenMintFailed, errors.New("exchange refused"))

	cases := []struct {
		name            string
		err             error
		namespaceGlobal bool
		terminal        bool
	}{
		{"503 upstream", &appPlatformUpstreamError{status: http.StatusServiceUnavailable}, true, false},
		{"404 upstream", &appPlatformUpstreamError{status: http.StatusNotFound}, true, true},
		{"401 upstream", &appPlatformUpstreamError{status: http.StatusUnauthorized}, false, true},
		{"403 upstream", &appPlatformUpstreamError{status: http.StatusForbidden}, false, true},
		{"mint failure", mintFailure, false, false},
		{"network failure", &url.Error{Op: "Get", Err: errors.New("connection refused")}, true, false},
		{"aggregate deadline", fmt.Errorf("app platform list: %w", context.DeadlineExceeded), true, false},
		{"decode failure", errors.New("app platform list: decode: unexpected token"), false, false},
	}
	for _, tt := range cases {
		if got := isNamespaceGlobalUpstreamError(tt.err); got != tt.namespaceGlobal {
			t.Errorf("%s: isNamespaceGlobalUpstreamError = %v, want %v", tt.name, got, tt.namespaceGlobal)
		}
		if got := isTerminalUpstreamError(tt.err); got != tt.terminal {
			t.Errorf("%s: isTerminalUpstreamError = %v, want %v", tt.name, got, tt.terminal)
		}
	}

	// A mint failure caused by an unreachable auth-api is transport-shaped, so
	// the sentinel must win over the network-error branch.
	oboNetworkFailure := fmt.Errorf("%w: %w", errAccessTokenMintFailed, &url.Error{Op: "Post", Err: errors.New("connection refused")})
	if isNamespaceGlobalUpstreamError(oboNetworkFailure) {
		t.Error("a mint failure wrapping a network error must still be caller-scoped")
	}
}

// Each proxy must gate on the aggregation toggle for ITS OWN API group — the Go
// mirror of the toggle derivation in src/utils/interactive-guides-api.ts (group,
// dots→dashes). Both routes now address the GAP `.app` group, so they share one
// toggle by design; this pins the derivation, not route availability (a real
// stack reports both the `.app` and legacy `.com` toggles true, so neither
// answers "is this route usable here?" — the capability/resolver path does).
func TestAggregationToggleMatchesGroup(t *testing.T) {
	toggleForGroupVersion := func(gv string) string {
		group := strings.SplitN(gv, "/", 2)[0]
		return "aggregation." + strings.ReplaceAll(group, ".", "-") + ".enabled"
	}

	cases := []struct {
		name         string
		groupVersion string
		toggle       string
	}{
		{"custom-guide (GAP .app)", customGuideGroupVersion, customGuideAggregationToggle},
		{"completion-records (GAP .app)", completionRecordsGroupVersion, completionRecordsAggregationToggle},
	}
	for _, tt := range cases {
		if got := toggleForGroupVersion(tt.groupVersion); got != tt.toggle {
			t.Errorf("%s: derived toggle %q, but the proxy uses %q", tt.name, got, tt.toggle)
		}
		if tt.toggle == pathfinderBackendAggregationToggle {
			t.Errorf("%s: must not gate on the legacy .com toggle %q", tt.name, pathfinderBackendAggregationToggle)
		}
	}

	// The cases above derive the expected toggle FROM the Go group constants, so
	// editing a group would move both sides together and stay green while the TS
	// literal (APP_PLATFORM_API_VERSION, src/utils/interactive-guides-api.ts)
	// kept pinning the old group. Pin the Go side to the same literal.
	if customGuideGroupVersion != "pathfinderbackend.ext.grafana.app/v1alpha1" {
		t.Errorf("customGuideGroupVersion = %q, but src/utils/interactive-guides-api.ts pins pathfinderbackend.ext.grafana.app/v1alpha1", customGuideGroupVersion)
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
		if got := r.Header.Get(auth.AccessTokenHeader); got != "at-xyz" {
			t.Errorf("%s = %q, want the minted token at-xyz", auth.AccessTokenHeader, got)
		}
		if got := r.Header.Get("Authorization"); got != "" {
			t.Errorf("Authorization must not be sent, got %q", got)
		}
		if got := r.Header.Get(backend.GrafanaUserSignInTokenHeaderName); got != "" {
			t.Errorf("%s must not be sent, got %q", backend.GrafanaUserSignInTokenHeaderName, got)
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

	client := newAppPlatformListClient(srv.URL, &stubMinter{token: "at-xyz"}, "id-token-abc", log.DefaultLogger)
	if err := client.create(context.Background(), "g/v1", "stacks-1", "things", []byte(payload), 1024); err != nil {
		t.Fatalf("create: %v", err)
	}
}

// The create path's companion to TestAppPlatformListClient_MintFailureAbortsRequest:
// a failed exchange must abort BEFORE any upstream POST (never fall back to an
// unauthenticated write), stay transient so the queued fact is retried rather
// than dropped, and be distinguishable as an exchange failure so the handler can
// log it loudly.
func TestAppPlatformCreateClient_MintFailureAbortsRequest(t *testing.T) {
	var upstreamCalls int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upstreamCalls++
		w.WriteHeader(http.StatusCreated)
	}))
	defer srv.Close()

	client := newAppPlatformListClient(srv.URL, &stubMinter{err: errors.New("exchange refused")}, "id-token-abc", log.DefaultLogger)
	err := client.create(context.Background(), "g/v1", "stacks-1", "things", []byte(`{}`), 1024)
	if err == nil {
		t.Fatal("expected an error when the exchange fails")
	}
	if upstreamCalls != 0 {
		t.Errorf("upstream was called %d times, want 0", upstreamCalls)
	}
	if _, hasStatus := upstreamStatusOf(err); hasStatus {
		t.Errorf("a mint failure must carry no upstream status (so it classifies transient): %v", err)
	}
	if isTerminalUpstreamError(err) {
		t.Errorf("mint failure should be transient, got terminal: %v", err)
	}
	if !isTokenExchangeError(err) {
		t.Errorf("mint failure must be identifiable as a token-exchange error: %v", err)
	}
}

// TestCompletionHTTPClient_Create_WireComposition composes the production
// completionHTTPClient.Create over the real HTTP adapter and pins the on-the-wire
// contract the CRD sees: the completionrecords collection URL, the outbound
// credential headers, and the COMPLETE serialized CompletionRecord object
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

	client := newCompletionHTTPClient(srv.URL, &stubMinter{token: "at-xyz"}, "id-token-abc", log.DefaultLogger)
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
	// The regression guard for the credential model: the write must carry the
	// minted on-behalf-of access token and NOTHING else. An ID token in either
	// header slot is a credential nothing on the outbound path accepts — it 401s
	// at our own stack — and stubbing the upstream is exactly what let that pass
	// green before, so assert the absence explicitly.
	if got := gotHeaders.Get(auth.AccessTokenHeader); got != "at-xyz" {
		t.Errorf("%s = %q, want the minted token at-xyz", auth.AccessTokenHeader, got)
	}
	if got := gotHeaders.Get("Authorization"); got != "" {
		t.Errorf("Authorization must not be sent on a create, got %q", got)
	}
	if got := gotHeaders.Get(backend.GrafanaUserSignInTokenHeaderName); got != "" {
		t.Errorf("%s must not be sent on a create, got %q", backend.GrafanaUserSignInTokenHeaderName, got)
	}
	if got := gotHeaders.Get("Cookie"); got != "" {
		t.Errorf("Cookie must never be forwarded, got %q", got)
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

// TestCompletionHTTPClient_Create_OversizedSuccessBodyIsNotRetryable proves a
// 201 whose body exceeds the write cap is a success, never a retryable error:
// the record is already durable, so surfacing the over-cap body as a failure
// would mask a committed write.
func TestCompletionHTTPClient_Create_OversizedSuccessBodyIsNotRetryable(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(strings.Repeat("x", completionWriteMaxBytes+1)))
	}))
	defer srv.Close()

	client := newCompletionHTTPClient(srv.URL, &stubMinter{token: "at-xyz"}, "id-token-abc", log.DefaultLogger)
	obj := completionRecordObject{Metadata: completionRecordObjectMeta{Name: "completion-abc"}}
	if err := client.Create(context.Background(), "stacks-1", obj); err != nil {
		t.Fatalf("Create returned error on an over-cap 201 body: %v (must be treated as success)", err)
	}
}

// errAfterStatusBody returns a non-EOF read error, simulating a body that fails
// to arrive intact AFTER the success status line was received.
type errAfterStatusBody struct{}

func (errAfterStatusBody) Read([]byte) (int, error) {
	return 0, fmt.Errorf("simulated body read failure")
}
func (errAfterStatusBody) Close() error { return nil }

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
		minter:     &stubMinter{token: "at-xyz"},
		idToken:    "id-token-abc",
		httpClient: &http.Client{Transport: successThenBodyReadErrorTransport{}},
		logger:     log.DefaultLogger,
	}
	if err := client.create(context.Background(), "g/v1", "stacks-1", "things", []byte(`{}`), 1024); err != nil {
		t.Fatalf("create returned error on a post-201 body read failure: %v (must be treated as success)", err)
	}
}

// TestAppPlatformCreateClient_RedirectNeverFollowed proves the C1 contract: an
// authenticated create that receives a 3xx must NOT follow it — the redirect
// target receives neither the outbound credential nor the POST body, and the
// redirected response is surfaced as a non-contract upstream status (classified
// transient, never acknowledged as a durable create). Covers 302, 307, and 308:
// 307/308 preserve the method and body, so they are the dangerous replay cases.
//
// The stake rose with the on-behalf-of model: the header at risk is now
// X-Access-Token carrying a live minted bearer credential, which is strictly
// worse to leak than an identity attestation. Go does not treat that custom
// header as sensitive, so nothing but CheckRedirect stops it crossing origins.
func TestAppPlatformCreateClient_RedirectNeverFollowed(t *testing.T) {
	for _, code := range []int{http.StatusFound, http.StatusTemporaryRedirect, http.StatusPermanentRedirect} {
		t.Run(fmt.Sprintf("%d", code), func(t *testing.T) {
			var targetHits int
			var targetSawCredential, targetSawBody bool
			target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				targetHits++
				if r.Header.Get(auth.AccessTokenHeader) != "" ||
					r.Header.Get("Authorization") != "" ||
					r.Header.Get(backend.GrafanaUserSignInTokenHeaderName) != "" {
					targetSawCredential = true
				}
				if body, _ := io.ReadAll(r.Body); len(body) > 0 {
					targetSawBody = true
				}
				w.WriteHeader(http.StatusCreated)
			}))
			defer target.Close()

			redirector := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Location", target.URL+"/redirected")
				w.WriteHeader(code)
			}))
			defer redirector.Close()

			client := newAppPlatformListClient(redirector.URL, &stubMinter{token: "at-secret"}, "id-token-secret", log.DefaultLogger)
			err := client.create(context.Background(), "g/v1", "stacks-1", "things", []byte(`{"secret":"payload"}`), 1024)
			if err == nil {
				t.Fatalf("a %d redirect must not be acknowledged as a durable create", code)
			}
			status, ok := upstreamStatusOf(err)
			if !ok || status != code {
				t.Fatalf("upstream status = %d (%v), want the unfollowed redirect %d", status, ok, code)
			}
			if !isTransientUpstreamStatus(status) {
				t.Errorf("a %d redirect must classify transient (retryable), not terminal", code)
			}
			if targetHits != 0 {
				t.Errorf("redirect target received %d requests, want 0 (redirect must not be followed)", targetHits)
			}
			if targetSawCredential {
				t.Error("redirect target received the minted access token — credential exfiltration")
			}
			if targetSawBody {
				t.Error("redirect target received the POST body")
			}
		})
	}
}

// The LIST companion to the create redirect test: a GET that receives a 3xx must
// not follow it either, so the minted credential never crosses to the redirect
// target.
func TestAppPlatformListClient_RedirectNeverFollowed(t *testing.T) {
	var targetHits int
	var targetSawCredential bool
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		targetHits++
		if r.Header.Get(auth.AccessTokenHeader) != "" ||
			r.Header.Get("Authorization") != "" ||
			r.Header.Get(backend.GrafanaUserSignInTokenHeaderName) != "" {
			targetSawCredential = true
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"items": []map[string]any{}})
	}))
	defer target.Close()

	redirector := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Location", target.URL+"/redirected")
		w.WriteHeader(http.StatusFound)
	}))
	defer redirector.Close()

	client := newCompletionHTTPClient(redirector.URL, &stubMinter{token: "at-secret"}, "id-token-secret", log.DefaultLogger)
	_, err := client.ListPage(context.Background(), "stacks-1", "")
	if err == nil {
		t.Fatal("an unfollowed redirect must surface as an error, not an empty page")
	}
	if status, ok := upstreamStatusOf(err); !ok || status != http.StatusFound {
		t.Fatalf("upstream status = %d (%v), want the unfollowed 302", status, ok)
	}
	if targetHits != 0 {
		t.Errorf("redirect target received %d requests, want 0", targetHits)
	}
	if targetSawCredential {
		t.Error("redirect target received the minted access token — credential exfiltration")
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
		// durable and the body is unused, so surfacing it as a retryable failure
		// would mask a committed write (the name is deterministic, so a retry
		// targets the same object anyway).
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

			client := newAppPlatformListClient(srv.URL, &stubMinter{token: "at-xyz"}, "id-token-abc", log.DefaultLogger)
			err := client.create(context.Background(), "g/v1", "stacks-1", "things", []byte(`{}`), tc.maxBytes)
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
