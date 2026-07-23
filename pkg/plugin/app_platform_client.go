package plugin

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
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
			status:     resp.StatusCode,
			retryAfter: resp.Header.Get("Retry-After"),
			msg:        fmt.Sprintf("app platform list %s: status %d: %s", resource, resp.StatusCode, strings.TrimSpace(string(body))),
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

// create POSTs a single object to a namespace collection (the write companion
// to listPage). It returns the created object body on 200/201, or an
// appPlatformUpstreamError carrying the upstream status (and Retry-After, when
// present) so the caller can classify transient/terminal/identity-scoped and
// echo the upstream backpressure hint. Body is bounded by maxBytes.
func (c *appPlatformListClient) create(ctx context.Context, groupVersion, namespace, resource string, obj []byte, maxBytes int64) ([]byte, error) {
	if namespace == "" {
		return nil, fmt.Errorf("app platform create: empty namespace")
	}

	endpoint := buildAppPlatformURL(c.appURL, groupVersion, namespace, resource)

	reqCtx, cancel := context.WithTimeout(ctx, appPlatformUpstreamTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, endpoint, bytes.NewReader(obj))
	if err != nil {
		return nil, fmt.Errorf("app platform create: build request: %w", err)
	}
	forwardIdentityHeaders(req.Header, c.idToken)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("app platform create: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return nil, &appPlatformUpstreamError{
			status:     resp.StatusCode,
			retryAfter: resp.Header.Get("Retry-After"),
			msg:        fmt.Sprintf("app platform create %s: status %d: %s", resource, resp.StatusCode, strings.TrimSpace(string(body))),
		}
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBytes+1))
	if err != nil {
		return nil, fmt.Errorf("app platform create: read body: %w", err)
	}
	if int64(len(body)) > maxBytes {
		return nil, fmt.Errorf("app platform create: response exceeded %d bytes", maxBytes)
	}
	return body, nil
}

// appPlatformUpstreamError carries the upstream HTTP status so error handling
// can classify failures once (§1): transient (429/5xx), terminal (other 4xx),
// and identity-scoped (401/403 for this caller's forwarded identity). retryAfter
// preserves the upstream Retry-After header verbatim so a proxy can echo the
// backpressure hint rather than inventing one.
type appPlatformUpstreamError struct {
	status     int
	retryAfter string
	msg        string
}

func (e *appPlatformUpstreamError) Error() string { return e.msg }

// upstreamStatusOf returns the HTTP status carried by an upstream error, or
// (0, false) when the failure has no status (network/timeout/decode).
func upstreamStatusOf(err error) (int, bool) {
	var ue *appPlatformUpstreamError
	if errors.As(err, &ue) {
		return ue.status, true
	}
	return 0, false
}

// upstreamRetryAfterOf returns the upstream Retry-After header carried by an
// error, or "" when none was present.
func upstreamRetryAfterOf(err error) string {
	var ue *appPlatformUpstreamError
	if errors.As(err, &ue) {
		return ue.retryAfter
	}
	return ""
}

// isTransientUpstreamStatus reports whether an HTTP status should be retried:
// 429, 5xx, and unexpected 2xx responses that did not satisfy an operation's
// narrower success contract.
func isTransientUpstreamStatus(status int) bool {
	return status == http.StatusTooManyRequests || status >= 500 || (status >= 200 && status < 300)
}

// isIdentityScopedUpstreamStatus reports whether a status means the upstream
// rejected THIS caller's forwarded identity, as opposed to a namespace-global
// condition. Identity-scoped failures must never enter a shared cache (§4).
func isIdentityScopedUpstreamStatus(status int) bool {
	return status == http.StatusUnauthorized || status == http.StatusForbidden
}

// isTerminalUpstreamError reports whether an upstream failure is terminal (a
// non-transient 4xx per §5). Network/timeout/decode errors carry no HTTP
// status and are treated as transient (retryable). Error-level companion to
// isTransientUpstreamStatus, shared by every proxy route.
func isTerminalUpstreamError(err error) bool {
	var ue *appPlatformUpstreamError
	if errors.As(err, &ue) {
		return !isTransientUpstreamStatus(ue.status)
	}
	return false
}

// isIdentityScopedUpstreamError reports whether an upstream failure means the
// aggregator rejected this caller's forwarded identity (401/403). Error-level
// companion to isIdentityScopedUpstreamStatus, shared by every proxy route.
func isIdentityScopedUpstreamError(err error) bool {
	var ue *appPlatformUpstreamError
	if errors.As(err, &ue) {
		return isIdentityScopedUpstreamStatus(ue.status)
	}
	return false
}
