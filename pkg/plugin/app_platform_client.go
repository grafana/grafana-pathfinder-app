package plugin

import (
	"bytes"
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

// appPlatformGroup is the single source of truth for Pathfinder's Grafana
// App Platform (GAP) API group. Every resource client and derived toggle
// reference it so they cannot drift; mirrors the frontend's
// src/utils/interactive-guides-api.ts APP_PLATFORM_GROUP.
const appPlatformGroup = "pathfinderbackend.ext.grafana.app"

// aggregationToggle derives the boot feature-toggle name Grafana sets when a
// group's aggregation layer is served: "aggregation." + the group with dots
// replaced by dashes + ".enabled". Mirrors the frontend derivation so the two
// layers name the toggle identically.
func aggregationToggle(group string) string {
	return "aggregation." + strings.ReplaceAll(group, ".", "-") + ".enabled"
}

// pathfinderBackendAggregationToggle is the legacy .com group's boot toggle
// (issues #1431/#1432). Both proxies now address the .app group, so nothing
// gates on this; it is kept as the named counterpart that pins the .app toggle
// derivation against a silent rename. A real stack reports BOTH toggles true, so
// neither one answers "is this route usable here?" — the resolvers do.
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

// errAccessTokenMintFailed marks a failure to mint the caller's on-behalf-of
// access token. It is caller-scoped (auth-api can reject one subject token
// while serving others) and carries no HTTP status, so it stays transient.
var errAccessTokenMintFailed = errors.New("mint access token")

// tokenExchangeError marks a failure to MINT the outbound on-behalf-of
// credential, as distinct from a failure of the upstream call itself. It
// carries no HTTP status, so the shared classifier already treats it as
// transient — an auth-api blip recovers on a later attempt, which is the
// intended behaviour. The distinct type exists so a caller can log it loudly:
// exchange failing while a credential IS provisioned means the environment is
// missing its delegated-permissions grant, and that would otherwise retry
// silently until the retention horizon. Structural absence of a credential is
// a different case entirely and never reaches here — the resolvers gate on a
// nil exchanger and report reasonOBOUnavailable instead.
type tokenExchangeError struct{ err error }

func (e *tokenExchangeError) Error() string { return errAccessTokenMintFailed.Error() + ": " + e.err.Error() }

// Unwrap yields the sentinel alongside the cause so errors.Is finds
// errAccessTokenMintFailed — the marker the failure-scope classifier keys on to
// keep a mint failure out of any shared negative cache.
func (e *tokenExchangeError) Unwrap() []error { return []error{errAccessTokenMintFailed, e.err} }

// isTokenExchangeError reports whether a failure came from the token exchange
// rather than from the upstream App Platform call.
func isTokenExchangeError(err error) bool {
	var te *tokenExchangeError
	return errors.As(err, &te)
}

// mintAccessToken exchanges the caller's ID token for the outbound credential
// scoped to namespace. Minting per request rather than per client is deliberate:
// authlib caches by subject for most of the token's 10-minute life, so this is a
// cache hit on all but the first call for a given user.
func mintAccessToken(ctx context.Context, minter accessTokenMinter, namespace, idToken string) (string, error) {
	token, err := minter.Mint(ctx, namespace, idToken)
	if err != nil {
		return "", &tokenExchangeError{err: err}
	}
	return token, nil
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
		appURL:  appURL,
		minter:  minter,
		idToken: idToken,
		httpClient: &http.Client{
			Timeout: appPlatformUpstreamTimeout,
			// Never follow redirects on an authenticated App Platform call: Go does
			// not classify the custom X-Access-Token header as sensitive, so a
			// followed cross-origin 3xx would hand the redirect target a live
			// on-behalf-of bearer credential (and, on 307/308, replay the POST body),
			// and a redirected create must never be acknowledged as a durable write.
			// Returning the last response lets the caller map the unexpected 3xx onto
			// a retryable status.
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		},
		logger: logger,
	}
}

// credentialDiagOnce gates the first-request credential diagnostics log: the
// most likely production incident for this proxy shape is "the credential
// model doesn't authenticate on a real stack", and this log turns that from a
// mystery into a one-line diagnosis (§9).
var credentialDiagOnce sync.Once

// createDiagOnce gates the first upstream-create credential diagnostics log,
// the write-path companion to credentialDiagOnce (which a prior read can
// consume, leaving POST's credential/RBAC result otherwise undiagnosed).
var createDiagOnce sync.Once

// listPage fetches one page of a namespace LIST. The body is bounded by
// maxBytes; upstream HTTP failures carry the status for retryability and scope
// classification, and a mint failure carries errAccessTokenMintFailed instead.
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

	accessToken, err := mintAccessToken(reqCtx, c.minter, namespace, c.idToken)
	if err != nil {
		return nil, fmt.Errorf("app platform list: %w", err)
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
			"outboundCredential", auth.AccessTokenHeader+"=<obo-access-token>")
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
// to listPage). The response body is unused, so it returns nil on 200/201, or an
// appPlatformUpstreamError carrying the upstream status (and Retry-After, when
// present) so the caller can classify transient/terminal/identity-scoped and
// echo the upstream backpressure hint.
func (c *appPlatformListClient) create(ctx context.Context, groupVersion, namespace, resource string, obj []byte, maxBytes int64) error {
	if namespace == "" {
		return fmt.Errorf("app platform create: empty namespace")
	}

	endpoint := buildAppPlatformURL(c.appURL, groupVersion, namespace, resource)

	reqCtx, cancel := context.WithTimeout(ctx, appPlatformUpstreamTimeout)
	defer cancel()

	accessToken, err := mintAccessToken(reqCtx, c.minter, namespace, c.idToken)
	if err != nil {
		return fmt.Errorf("app platform create: %w", err)
	}

	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, endpoint, bytes.NewReader(obj))
	if err != nil {
		return fmt.Errorf("app platform create: build request: %w", err)
	}
	req.Header.Set(auth.AccessTokenHeader, accessToken)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("app platform create: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	createDiagOnce.Do(func() {
		c.logger.Info("app platform proxy: first upstream create",
			"resource", resource,
			"status", resp.StatusCode,
			"idTokenPresent", c.idToken != "",
			"outboundCredential", auth.AccessTokenHeader+"=<obo-access-token>")
	})

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return &appPlatformUpstreamError{
			status:     resp.StatusCode,
			retryAfter: resp.Header.Get("Retry-After"),
			msg:        fmt.Sprintf("app platform create %s: status %d: %s", resource, resp.StatusCode, strings.TrimSpace(string(body))),
		}
	}

	// 200/201 means the record is already durable upstream and the body is unused,
	// so a body read error or an over-cap body must NEVER become a retryable
	// failure: the write has already committed, and surfacing an error would mask a
	// durable success as failed. Drain best-effort up to the cap (bounding bytes
	// transferred) so the connection can be reused, and swallow any error.
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, maxBytes))
	return nil
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
// 408 (request timeout), 429, 5xx, and any unexpected 2xx/3xx response that did
// not satisfy an operation's narrower success contract. 408 and 3xx are the two
// non-5xx recoverable cases: a request-timeout is inherently retryable, and an
// unfollowed redirect (CheckRedirect is disabled) is an infrastructure blip the
// caller must never treat as a durable result.
func isTransientUpstreamStatus(status int) bool {
	return status == http.StatusRequestTimeout ||
		status == http.StatusTooManyRequests ||
		status >= 500 ||
		(status >= 200 && status < 400)
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
