package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

// Shared paginated LIST client for App Platform proxy routes
// (docs/design/BACKEND_PROXY_PATTERN.md §1). One client serves every kind:
// callers supply the group/version + resource and decode each `items[].spec`
// through a per-kind callback.

// pathfinderBackendAggregationToggle mirrors the front-end availability check
// in src/utils/fetchBackendGuides.ts: the boot-time toggle the aggregation
// layer sets when the pathfinderbackend API is served on this instance.
const pathfinderBackendAggregationToggle = "aggregation.pathfinderbackend-ext-grafana-com.enabled"

// appPlatformUpstreamTimeout caps a single LIST page fetch. The aggregate
// deadline across a whole drain is the caller's responsibility (§1).
const appPlatformUpstreamTimeout = 15 * time.Second

// buildAppPlatformURL joins the aggregated-API path for a namespace LIST,
// PathEscape-ing every segment. Every component is server-derived, so there
// is nothing to allowlist.
func buildAppPlatformURL(appURL, groupVersion, namespace, resource string) string {
	gvParts := strings.Split(groupVersion, "/")
	escaped := make([]string, len(gvParts))
	for i, p := range gvParts {
		escaped[i] = url.PathEscape(p)
	}
	return fmt.Sprintf("%s/apis/%s/namespaces/%s/%s",
		strings.TrimRight(appURL, "/"), strings.Join(escaped, "/"),
		url.PathEscape(namespace), url.PathEscape(resource))
}

// appPlatformListPage is one raw page of a namespace LIST: each item's `spec`
// undecoded, plus the Kubernetes continue token (empty when drained).
type appPlatformListPage struct {
	Specs    []json.RawMessage
	Continue string
}

// appPlatformListClient fetches pages of a namespace LIST from the stack's
// own aggregated App Platform API, riding the caller's identity (§3).
type appPlatformListClient struct {
	appURL     string
	idToken    string
	httpClient *http.Client
	logger     log.Logger
}

func newAppPlatformListClient(appURL, idToken string, logger log.Logger) *appPlatformListClient {
	return &appPlatformListClient{
		appURL:     appURL,
		idToken:    idToken,
		httpClient: &http.Client{Timeout: appPlatformUpstreamTimeout},
		logger:     logger,
	}
}

// credentialDiagOnce gates the first-request credential diagnostics log: the
// most likely production incident for this proxy shape is "the credential
// model doesn't authenticate on a real stack", and this log turns that from a
// mystery into a one-line diagnosis (§9).
var credentialDiagOnce sync.Once

// listPage fetches one page of a namespace LIST. The body is bounded by
// maxBytes; errors carry the upstream status for transient/terminal/
// identity-scoped classification.
func (c *appPlatformListClient) listPage(ctx context.Context, groupVersion, namespace, resource, continueToken string, pageSize int, maxBytes int64) (*appPlatformListPage, error) {
	if namespace == "" {
		return nil, fmt.Errorf("app platform list: empty namespace")
	}

	endpoint := buildAppPlatformURL(c.appURL, groupVersion, namespace, resource)
	q := url.Values{}
	q.Set("limit", strconv.Itoa(pageSize))
	if continueToken != "" {
		q.Set("continue", continueToken)
	}
	endpoint += "?" + q.Encode()

	reqCtx, cancel := context.WithTimeout(ctx, appPlatformUpstreamTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("app platform list: build request: %w", err)
	}
	forwardIdentityHeaders(req.Header, c.idToken)
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("app platform list: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	credentialDiagOnce.Do(func() {
		c.logger.Info("app platform proxy: first upstream LIST",
			"resource", resource,
			"status", resp.StatusCode,
			"idTokenPresent", c.idToken != "",
			"identityHeaders", "Authorization=Bearer<id-token>,X-Grafana-Id")
	})

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return nil, &appPlatformUpstreamError{
			status: resp.StatusCode,
			msg:    fmt.Sprintf("app platform list %s: status %d: %s", resource, resp.StatusCode, strings.TrimSpace(string(body))),
		}
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBytes+1))
	if err != nil {
		return nil, fmt.Errorf("app platform list: read body: %w", err)
	}
	if int64(len(body)) > maxBytes {
		return nil, fmt.Errorf("app platform list: page response exceeded %d bytes", maxBytes)
	}

	var list struct {
		Metadata struct {
			Continue string `json:"continue"`
		} `json:"metadata"`
		Items []struct {
			Spec json.RawMessage `json:"spec"`
		} `json:"items"`
	}
	if err := json.Unmarshal(body, &list); err != nil {
		return nil, fmt.Errorf("app platform list: decode: %w", err)
	}

	specs := make([]json.RawMessage, 0, len(list.Items))
	for _, item := range list.Items {
		specs = append(specs, item.Spec)
	}
	return &appPlatformListPage{Specs: specs, Continue: list.Metadata.Continue}, nil
}

// appPlatformUpstreamError carries the upstream HTTP status so error handling
// can classify failures once (§1): transient (429/5xx), terminal (other 4xx),
// and identity-scoped (401/403 for this caller's forwarded identity).
type appPlatformUpstreamError struct {
	status int
	msg    string
}

func (e *appPlatformUpstreamError) Error() string { return e.msg }

// isTransientUpstreamStatus reports whether an HTTP status should be treated
// as transient (retryable): 429 and any 5xx. All other non-2xx are terminal.
func isTransientUpstreamStatus(status int) bool {
	return status == http.StatusTooManyRequests || status >= 500
}

// isIdentityScopedUpstreamStatus reports whether a status means the upstream
// rejected THIS caller's forwarded identity, as opposed to a namespace-global
// condition. Identity-scoped failures must never enter a shared cache (§4).
func isIdentityScopedUpstreamStatus(status int) bool {
	return status == http.StatusUnauthorized || status == http.StatusForbidden
}
