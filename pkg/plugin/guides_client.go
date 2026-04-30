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
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
)

// guidesAPIGroup and related constants identify the Pathfinder Backend
// custom-resource API served by Grafana's K8s aggregator. The frontend's
// `useBackendGuides.saveGuide` (in src/components/block-editor/hooks/) uses
// the same path; we mirror it byte-for-byte so guides imported via this
// API and saved via the editor are indistinguishable on disk.
const (
	guidesAPIGroup    = "pathfinderbackend.ext.grafana.com"
	guidesAPIVersion  = "v1alpha1"
	guidesAPIKind     = "InteractiveGuide"
	guidesAPIResource = "interactiveguides"
	guidesAPITimeout  = 30 * time.Second

	// guidesAggregatorFeatureToggle is the Grafana feature toggle that
	// has to be on for the aggregator API to be served. The frontend
	// gates its calls on the same key (src/utils/fetchBackendGuides.ts:16-19).
	// In OSS it's never on; in Cloud it tracks the rollout state.
	guidesAggregatorFeatureToggle = "aggregation.pathfinderbackend-ext-grafana-com.enabled"
)

// isGuidesAggregatorEnabled reports whether the aggregator API is
// available in this Grafana instance. Mirrors the frontend's
// `isBackendApiAvailable` so OSS callers get a deterministic 501
// instead of a generic 502 from a failed outbound call.
func isGuidesAggregatorEnabled(ctx context.Context) bool {
	cfg := backend.GrafanaConfigFromContext(ctx)
	return cfg.FeatureToggles().IsEnabled(guidesAggregatorFeatureToggle)
}

// errGuideNotFound is returned by GuidesClient.Get when the aggregator
// reports that the resource does not exist. Callers use this to decide
// between create and update paths.
var errGuideNotFound = errors.New("guide not found")

// guidesEnvelope is the K8s-style wrapper this plugin sends to the
// aggregator. Mirrors the shape constructed at
// src/components/block-editor/hooks/useBackendGuides.ts:135-146 so that
// guides written via this client are identical to ones written by the
// editor frontend.
type guidesEnvelope struct {
	APIVersion string          `json:"apiVersion"`
	Kind       string          `json:"kind"`
	Metadata   guidesMetadata  `json:"metadata"`
	Spec       json.RawMessage `json:"spec"`
}

// guidesMetadata is the subset of K8s ObjectMeta we serialise.
// resourceVersion is omitted on create (the aggregator assigns one) and
// echoed back from a prior GET for updates (optimistic concurrency).
type guidesMetadata struct {
	Name            string `json:"name"`
	Namespace       string `json:"namespace"`
	ResourceVersion string `json:"resourceVersion,omitempty"`
}

// guidesResponse is the (partial) shape we parse out of an aggregator
// response. We only read the fields we actually surface to API callers
// — the aggregator may include many more.
type guidesResponse struct {
	Metadata guidesMetadata `json:"metadata"`
	Spec     specWithStatus `json:"spec"`
}

// specWithStatus extracts spec.status without re-validating the rest
// of the spec. The full spec is owned by the CUE schema in
// grafana-pathfinder-backend; we only echo status back to the caller.
type specWithStatus struct {
	Status string `json:"status,omitempty"`
}

// k8sStatusError is the standard K8s `Status` envelope returned for
// 4xx/5xx aggregator responses. We bubble Code and Message so callers
// see a useful message rather than just an HTTP status.
type k8sStatusError struct {
	Code       int    `json:"code"`
	Message    string `json:"message"`
	Reason     string `json:"reason,omitempty"`
	Collection bool   `json:"-"`
}

func (e *k8sStatusError) Error() string {
	if e.Message != "" {
		return e.Message
	}
	return fmt.Sprintf("aggregator returned status %d", e.Code)
}

// statusCode returns the HTTP status carried in the K8s Status envelope.
// If the aggregator returned an opaque (non-Status) body, the wrapping
// fallback in parseStatusError tags it as 500.
func (e *k8sStatusError) statusCode() int {
	if e.Code != 0 {
		return e.Code
	}
	return http.StatusInternalServerError
}

// guidesUnavailableStatuses mirrors the frontend's UNAVAILABLE_STATUSES
// (src/utils/fetchBackendGuides.ts:22). When the aggregator returns one
// of these, the feature toggle is off or the route hasn't been rolled
// out — distinct from a real failure.
var guidesUnavailableStatuses = map[int]bool{
	http.StatusBadRequest:         true, // 400
	http.StatusForbidden:          true, // 403
	http.StatusNotFound:           true, // 404 (only at the "list" level — single-resource 404 is not "unavailable")
	http.StatusMethodNotAllowed:   true, // 405
	http.StatusNotImplemented:     true, // 501
	http.StatusServiceUnavailable: true, // 503
}

// guidesClient is a thin HTTP wrapper for the Pathfinder Backend
// aggregated K8s API. It does NOT cache the SA token or AppURL —
// those come from request context every call so they survive plugin
// re-deploys and rotation.
type guidesClient struct {
	httpClient *http.Client
}

// newGuidesClient returns a client with a 30 s per-request timeout,
// matching the Coda integration's default at coda.go:124.
func newGuidesClient() *guidesClient {
	return &guidesClient{
		httpClient: &http.Client{Timeout: guidesAPITimeout},
	}
}

// guidesRequestConfig captures everything needed for a single call.
// It's derived from request context (not stored on the client) because
// the SA token can rotate and the AppURL is environment-specific.
type guidesRequestConfig struct {
	AppURL    string
	Token     string
	Namespace string
}

// configFromRequest pulls the AppURL and plugin SA token from
// backend.GrafanaConfigFromContext, and the namespace from the plugin
// context. Returns a friendly error if any of them is missing — this
// is the failure mode if the plugin runs in an environment that hasn't
// been configured for app-platform aggregator calls.
func configFromRequest(ctx context.Context, namespace string) (*guidesRequestConfig, error) {
	cfg := backend.GrafanaConfigFromContext(ctx)
	appURL, err := cfg.AppURL()
	if err != nil {
		return nil, fmt.Errorf("grafana app URL unavailable: %w", err)
	}
	if appURL == "" {
		return nil, errors.New("grafana app URL unavailable")
	}
	token, err := cfg.PluginAppClientSecret()
	if err != nil {
		return nil, fmt.Errorf("plugin app client secret unavailable: %w", err)
	}
	if token == "" {
		return nil, errors.New("plugin app client secret unavailable")
	}
	if namespace == "" {
		return nil, errors.New("namespace unavailable from plugin context")
	}
	return &guidesRequestConfig{AppURL: appURL, Token: token, Namespace: namespace}, nil
}

// resourceURL composes the aggregator endpoint for a named resource
// (or the collection root if name is empty).
func (c *guidesClient) resourceURL(rc *guidesRequestConfig, name string) string {
	base := fmt.Sprintf("%s/apis/%s/%s/namespaces/%s/%s",
		rc.AppURL, guidesAPIGroup, guidesAPIVersion, url.PathEscape(rc.Namespace), guidesAPIResource)
	if name == "" {
		return base
	}
	return base + "/" + url.PathEscape(name)
}

// Get fetches an InteractiveGuide by name. Returns errGuideNotFound
// for 404 (caller branches into the create path) and a *k8sStatusError
// for other aggregator errors.
func (c *guidesClient) Get(ctx context.Context, rc *guidesRequestConfig, name string) (*guidesResponse, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.resourceURL(rc, name), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+rc.Token)
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("aggregator GET: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode == http.StatusNotFound {
		return nil, errGuideNotFound
	}
	if resp.StatusCode >= 400 {
		return nil, parseStatusError(body, resp.StatusCode)
	}

	var out guidesResponse
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, fmt.Errorf("decode aggregator response: %w", err)
	}
	return &out, nil
}

// Create writes a new InteractiveGuide. The envelope.Metadata.Name and
// .Namespace must already be set; resourceVersion must be empty.
func (c *guidesClient) Create(ctx context.Context, rc *guidesRequestConfig, env *guidesEnvelope) (*guidesResponse, error) {
	return c.send(ctx, rc, http.MethodPost, "", env)
}

// Update replaces an existing InteractiveGuide. envelope.Metadata.ResourceVersion
// must be set (echoed from a prior Get) — the aggregator rejects mismatched
// versions with 409 Conflict.
func (c *guidesClient) Update(ctx context.Context, rc *guidesRequestConfig, env *guidesEnvelope) (*guidesResponse, error) {
	return c.send(ctx, rc, http.MethodPut, env.Metadata.Name, env)
}

func (c *guidesClient) send(ctx context.Context, rc *guidesRequestConfig, method, name string, env *guidesEnvelope) (*guidesResponse, error) {
	body, err := json.Marshal(env)
	if err != nil {
		return nil, fmt.Errorf("encode envelope: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.resourceURL(rc, name), bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+rc.Token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("aggregator %s: %w", method, err)
	}
	defer func() { _ = resp.Body.Close() }()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		err := parseStatusError(respBody, resp.StatusCode)
		var se *k8sStatusError
		if errors.As(err, &se) {
			se.Collection = name == ""
		}
		return nil, err
	}

	var out guidesResponse
	if err := json.Unmarshal(respBody, &out); err != nil {
		return nil, fmt.Errorf("decode aggregator response: %w", err)
	}
	return &out, nil
}

// parseStatusError turns a 4xx/5xx aggregator response into a
// *k8sStatusError. K8s wraps errors in a `Status` envelope with a
// numeric `code` and a `message`; we prefer those over the raw HTTP
// status when available.
func parseStatusError(body []byte, fallback int) error {
	var s k8sStatusError
	if len(body) > 0 && json.Unmarshal(body, &s) == nil && s.Code != 0 {
		return &s
	}
	return &k8sStatusError{Code: fallback, Message: string(body)}
}

// isAggregatorUnavailable reports whether an error from the client is
// one of the "endpoint not rolled out" status codes the frontend treats
// as unavailable. Mirrors fetchBackendGuides.ts UNAVAILABLE_STATUSES.
//
// Note: we deliberately do NOT include single-resource 404 here —
// that's a real "guide doesn't exist" signal handled separately via
// errGuideNotFound. The 404 in this set is for collection-level
// "the API group itself is missing".
func isAggregatorUnavailable(err error) bool {
	var s *k8sStatusError
	if !errors.As(err, &s) {
		return false
	}
	if s.Code == http.StatusNotFound {
		return guidesUnavailableStatuses[s.Code] && s.Collection
	}
	return guidesUnavailableStatuses[s.Code]
}
