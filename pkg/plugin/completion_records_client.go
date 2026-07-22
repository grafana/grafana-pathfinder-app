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
	"time"
)

// completionRecordsGroup is the App Platform API group/version that serves the
// CompletionRecord kind. The plural resource name is "completionrecords".
// Verified against grafana-pathfinder-backend kinds/completionrecord.cue and
// its generated CRD (groupOverride pathfinderbackend.ext.grafana.com).
const (
	completionRecordsGroupVersion = "pathfinderbackend.ext.grafana.com/v1alpha1"
	completionRecordsResource     = "completionrecords"

	// completionListPageSize bounds each upstream LIST page. The proxy drains
	// all pages, so this only trades round-trips against per-response size.
	completionListPageSize = 500

	// completionUpstreamTimeout caps a single LIST page fetch.
	completionUpstreamTimeout = 15 * time.Second

	// completionListMaxBytes bounds an individual page body so a pathological
	// namespace can't exhaust plugin memory.
	completionListMaxBytes = 8 * 1024 * 1024
)

// completionRecordSpec mirrors the fields of the CompletionRecord `spec` that
// this read proxy consumes. Unlisted spec fields (durationSeconds, userLogin,
// recordedAt, orgId, …) are ignored by encoding/json. Field names track
// kinds/completionrecord.cue.
type completionRecordSpec struct {
	UserID            string `json:"userId"`
	GuideID           string `json:"guideId"`
	GuideSource       string `json:"guideSource"`
	GuideTitle        string `json:"guideTitle"`
	GuideCategory     string `json:"guideCategory"`
	PathID            string `json:"pathId"`
	Source            string `json:"source"`
	CompletedAt       string `json:"completedAt"`
	CompletionPercent int64  `json:"completionPercent"`
}

// completionRecordPage is one page of a namespace LIST: the decoded record
// specs plus the Kubernetes continue token (empty when the listing is drained).
type completionRecordPage struct {
	Records  []completionRecordSpec
	Continue string
}

// completionRecordLister abstracts a single upstream LIST page so the cache can
// drain pagination while tests inject a fake without an HTTP server. The
// production implementation is completionHTTPClient.
type completionRecordLister interface {
	ListPage(ctx context.Context, namespace, continueToken string) (*completionRecordPage, error)
}

// k8sCompletionListResponse is the Kubernetes-style list envelope returned by
// the aggregated API. `metadata.continue` drives pagination; each item wraps
// the record spec.
type k8sCompletionListResponse struct {
	Metadata struct {
		Continue string `json:"continue"`
	} `json:"metadata"`
	Items []struct {
		Spec completionRecordSpec `json:"spec"`
	} `json:"items"`
}

// completionHTTPClient lists CompletionRecords from the stack's own aggregated
// App Platform API.
//
// Credential model (see PR body): this forwards the CALLER's Grafana identity
// (the incoming request's Authorization / X-Grafana-Id / Cookie headers) to
// the aggregated API — the backend analog of the front-end's
// getBackendSrv().fetch(), which rides the user's own session to LIST the
// sibling `interactiveguides` kind today. No new service account or IAM grant:
// the LIST runs with exactly the caller's permissions (least privilege). A
// namespace-scoped LIST returns every record in the namespace (Kubernetes RBAC
// is namespace-, not object-, scoped), which is what lets one refresh collate
// all users. If a caller lacks list permission on completionrecords the
// upstream returns 4xx, surfaced as a terminal error.
type completionHTTPClient struct {
	appURL     string
	httpClient *http.Client
	// forwarded carries the caller's auth headers, copied from the incoming
	// plugin resource request.
	forwarded http.Header
}

// forwardedAuthHeaderNames are the identity-bearing headers copied from the
// incoming request onto the outgoing LIST so it executes as the caller.
var forwardedAuthHeaderNames = []string{"Authorization", grafanaIDTokenHeader, "Cookie"}

// newCompletionHTTPClient builds a lister that calls appURL and replays the
// caller's identity headers taken from the incoming request.
func newCompletionHTTPClient(appURL string, incoming http.Header) *completionHTTPClient {
	forwarded := http.Header{}
	for _, name := range forwardedAuthHeaderNames {
		if v := incoming.Get(name); v != "" {
			forwarded.Set(name, v)
		}
	}
	return &completionHTTPClient{
		appURL:     strings.TrimRight(appURL, "/"),
		httpClient: &http.Client{Timeout: completionUpstreamTimeout},
		forwarded:  forwarded,
	}
}

// ListPage fetches one page of CompletionRecords for the namespace.
func (c *completionHTTPClient) ListPage(ctx context.Context, namespace, continueToken string) (*completionRecordPage, error) {
	if namespace == "" {
		return nil, fmt.Errorf("completion records: empty namespace")
	}

	endpoint := fmt.Sprintf("%s/apis/%s/namespaces/%s/%s",
		c.appURL, completionRecordsGroupVersion, url.PathEscape(namespace), completionRecordsResource)

	q := url.Values{}
	q.Set("limit", strconv.Itoa(completionListPageSize))
	if continueToken != "" {
		q.Set("continue", continueToken)
	}
	endpoint += "?" + q.Encode()

	reqCtx, cancel := context.WithTimeout(ctx, completionUpstreamTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("completion records: build request: %w", err)
	}
	for name, values := range c.forwarded {
		req.Header[name] = values
	}
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("completion records: list: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return nil, &completionUpstreamError{
			status: resp.StatusCode,
			msg:    fmt.Sprintf("completion records: list status %d: %s", resp.StatusCode, strings.TrimSpace(string(body))),
		}
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, completionListMaxBytes+1))
	if err != nil {
		return nil, fmt.Errorf("completion records: read body: %w", err)
	}
	if int64(len(body)) > completionListMaxBytes {
		return nil, fmt.Errorf("completion records: list response exceeded %d bytes", completionListMaxBytes)
	}

	var list k8sCompletionListResponse
	if err := json.Unmarshal(body, &list); err != nil {
		return nil, fmt.Errorf("completion records: decode list: %w", err)
	}

	records := make([]completionRecordSpec, 0, len(list.Items))
	for _, item := range list.Items {
		records = append(records, item.Spec)
	}
	return &completionRecordPage{Records: records, Continue: list.Metadata.Continue}, nil
}

// completionUpstreamError carries the upstream HTTP status so error handling
// can distinguish transient (429/5xx) from terminal (4xx) failures per the
// Completion Records RFC §6.9 error table.
type completionUpstreamError struct {
	status int
	msg    string
}

func (e *completionUpstreamError) Error() string { return e.msg }

// isTransientUpstreamStatus reports whether an HTTP status should be treated as
// a transient failure (retryable): 429 and any 5xx. All other non-2xx statuses
// are terminal.
func isTransientUpstreamStatus(status int) bool {
	return status == http.StatusTooManyRequests || status >= 500
}
