package plugin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"

	"github.com/grafana/grafana-pathfinder-app/pkg/plugin/auth"
)

// Shared paginated LIST client for App Platform proxy routes
// (docs/design/BACKEND_PROXY_PATTERN.md §1). One client serves every kind:
// callers supply the group/version + resource and decode each `items[].spec`
// through a per-kind callback.

// pathfinderBackendAggregationToggle gates the completion-records proxy on the
// LEGACY CAP group (pathfinderbackend.ext.grafana.com). The custom-guide proxy
// moved to the GAP `.app` toggle (customGuideAggregationToggle); the two are
// intentionally distinct until completion-records also migrates to GAP. The
// name derives from the group, dots→dashes — the Go mirror of the `.app`
// derivation in src/utils/interactive-guides-api.ts.
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

// accessTokenMinter exchanges a caller's ID token for a short-lived access
// token scoped to that user. Satisfied by auth.Exchanger; an interface here so
// tests can stub the exchange without an auth-api.
type accessTokenMinter interface {
	Mint(ctx context.Context, namespace, idToken string) (string, error)
}

// appPlatformListClient fetches pages of a namespace LIST from the stack's
// own aggregated App Platform API, as the calling user (§3).
type appPlatformListClient struct {
	appURL     string
	minter     accessTokenMinter
	idToken    string
	httpClient *http.Client
	logger     log.Logger
}

func newAppPlatformListClient(appURL string, minter accessTokenMinter, idToken string, logger log.Logger) *appPlatformListClient {
	return &appPlatformListClient{
		appURL:     appURL,
		minter:     minter,
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

	// Mint per request rather than per client: authlib caches by subject for
	// most of the token's 10-minute life, so this is a cache hit on all but the
	// first call for a given user, and a mint failure surfaces as an upstream
	// error the caller already classifies.
	accessToken, err := c.minter.Mint(reqCtx, namespace, c.idToken)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", errAccessTokenMintFailed, err)
	}

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("app platform list: build request: %w", err)
	}
	req.Header.Set(auth.AccessTokenHeader, accessToken)
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
			"identityHeaders", auth.AccessTokenHeader+"=<obo-access-token>")
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

// errAccessTokenMintFailed marks a failure to mint the caller's on-behalf-of
// access token. It is caller-scoped (auth-api can reject one subject token
// while serving others) and carries no HTTP status, so it stays transient.
var errAccessTokenMintFailed = errors.New("app platform list: mint access token")

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

// isNamespaceGlobalUpstreamError reports whether an upstream failure is a
// property of the namespace rather than of one caller's identity, and may
// therefore be shared across callers through a negative cache (§4, §5).
//
// This is an allow-list, not a deny-list on the identity-scoped statuses: any
// failure shape we cannot positively place — including future statusless ones —
// stays unshared, which costs re-probes but never replays one caller's error to
// another. Scope is orthogonal to transient/terminal: a mint failure is
// caller-scoped AND transient.
func isNamespaceGlobalUpstreamError(err error) bool {
	// Ordering matters: the mint hop is itself an HTTP call to auth-api, so its
	// failures also satisfy the net.Error check below.
	if errors.Is(err, errAccessTokenMintFailed) {
		return false
	}
	var ue *appPlatformUpstreamError
	if errors.As(err, &ue) {
		return !isIdentityScopedUpstreamStatus(ue.status)
	}
	var netErr net.Error
	return errors.As(err, &netErr) || errors.Is(err, context.DeadlineExceeded)
}
