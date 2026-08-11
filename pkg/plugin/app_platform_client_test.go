package plugin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
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
		{http.StatusBadGateway, true, false},
		{http.StatusUnauthorized, false, true},
		{http.StatusForbidden, false, true},
		{http.StatusNotFound, false, false},
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
// dots→dashes). Regression-guards the shared test fixture that enables both
// toggles: without this, the suite couldn't notice if the two routes silently
// drifted onto the same toggle (moxious review, finding #8).
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
		{"completion-records (legacy .com)", completionRecordsGroupVersion, pathfinderBackendAggregationToggle},
	}
	for _, tt := range cases {
		if got := toggleForGroupVersion(tt.groupVersion); got != tt.toggle {
			t.Errorf("%s: derived toggle %q, but the proxy uses %q", tt.name, got, tt.toggle)
		}
	}

	// The two routes are on different groups and must not collapse to one toggle.
	if customGuideAggregationToggle == pathfinderBackendAggregationToggle {
		t.Error("custom-guide and completion-records must gate on distinct aggregation toggles")
	}
}
