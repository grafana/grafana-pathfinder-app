package plugin

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

// Upstream coordinates for the Assignment kind (kinds/assignment.cue), a
// namespaced sibling of CompletionRecord in the same App Platform group.
// A stack that has not registered the kind answers LIST with 404, which
// handleMyAssignments reports as capability=false rather than a hiccup.
const (
	// assignmentsGroupVersion is derived from appPlatformGroup
	// (app_platform_client.go) so it cannot drift from the group name.
	assignmentsGroupVersion = appPlatformGroup + "/v1alpha1"
	assignmentsResource     = "assignments"

	// assignmentListPageSize bounds each upstream LIST page. The proxy drains
	// all pages, so this only trades round-trips against per-response size.
	assignmentListPageSize = 500

	// assignmentListMaxBytes bounds an individual page body so a pathological
	// namespace cannot exhaust plugin memory. The whole drain is additionally
	// bounded by assignmentAggregateDeadline (assignments.go); there is
	// deliberately no record cap, because a cap would silently drop the
	// caller's own record when it fell past the cut.
	assignmentListMaxBytes = 8 * 1024 * 1024
)

// assignmentsAggregationToggle is the boot feature toggle the aggregation layer
// sets when the .app pathfinderbackend group is served on this instance. Same
// derived value as completionRecordsAggregationToggle and
// customGuideAggregationToggle — one name per surface, derived from
// appPlatformGroup rather than written as a literal, so a group rename cannot
// leave one route gating on a stale string. It is a PRECONDITION, not the
// availability answer: resolveAssignmentBackend additionally requires an app
// URL, a namespace, and a provisioned on-behalf-of credential.
var assignmentsAggregationToggle = aggregationToggle(appPlatformGroup)

// assignmentSpec mirrors the Assignment `spec` this read proxy consumes.
// Name and StatusSatisfied come from metadata and status, not spec.
// StatusSatisfied is nil when status.satisfied is absent. Optional spec
// scalars unmarshal as "" when absent. Field names track kinds/assignment.cue.
type assignmentSpec struct {
	Name            string `json:"-"`
	StatusSatisfied *bool  `json:"-"`

	UserID       string `json:"userId"`
	TargetType   string `json:"targetType"`
	TargetID     string `json:"targetId"`
	TrackID      string `json:"trackId"`
	TargetSource string `json:"targetSource"`

	RuleID       string `json:"ruleId"`
	RuleRevision string `json:"ruleRevision"`
	AssignedBy   string `json:"assignedBy"`
	AssignedAt   string `json:"assignedAt"`

	DueAt                 string `json:"dueAt"`
	AcceptCompletionsFrom string `json:"acceptCompletionsFrom"`

	Lifecycle   string `json:"lifecycle"`
	WithdrawnAt string `json:"withdrawnAt"`

	SchemaVersion int64 `json:"schemaVersion"`
}

// assignmentPage is one page of a namespace LIST: the decoded specs plus the
// Kubernetes continue token (empty when the listing is drained).
type assignmentPage struct {
	Records  []assignmentSpec
	Continue string
}

// assignmentLister abstracts a single upstream LIST page so the handler can
// drain pagination while tests inject a fake without an HTTP server. The
// production implementation is assignmentHTTPClient.
type assignmentLister interface {
	ListPage(ctx context.Context, namespace, continueToken string) (*assignmentPage, error)
}

// assignmentStatusWriter updates status.satisfied. The LIST lister implements
// it; a test fake that only lists does not, and the status write skips.
type assignmentStatusWriter interface {
	UpdateStatus(ctx context.Context, namespace, name string, satisfied bool) error
}

// assignmentHTTPClient is the per-kind wrapper over the shared App Platform
// LIST client: it supplies the assignments coordinates and decodes each
// `items[].spec` into an assignmentSpec.
type assignmentHTTPClient struct {
	inner *appPlatformListClient
}

// newAssignmentHTTPClient builds a lister that calls appURL as the user the
// caller's ID token identifies, using an access token minted from that token. A
// namespace-scoped LIST returns every assignment in the namespace (Kubernetes
// RBAC is namespace-, not object-, scoped) — the accepted stack-scoped privacy
// grain (§6.8), not per-user confidentiality. The handler filters to the
// caller's slice; that is a UI filter, not row-level authorization upstream.
func newAssignmentHTTPClient(appURL string, minter accessTokenMinter, idToken string, logger log.Logger) *assignmentHTTPClient {
	return &assignmentHTTPClient{inner: newAppPlatformListClient(appURL, minter, idToken, logger)}
}

// ListPage fetches one page of Assignments for the namespace.
func (c *assignmentHTTPClient) ListPage(ctx context.Context, namespace, continueToken string) (*assignmentPage, error) {
	page, err := c.inner.listPage(ctx, assignmentsGroupVersion, namespace,
		assignmentsResource, continueToken, assignmentListPageSize, assignmentListMaxBytes)
	if err != nil {
		return nil, err
	}

	records := make([]assignmentSpec, 0, len(page.Items))
	for _, item := range page.Items {
		var spec assignmentSpec
		if err := json.Unmarshal(item.Spec, &spec); err != nil {
			return nil, fmt.Errorf("assignments: decode spec: %w", err)
		}
		spec.Name = item.Metadata.Name
		if len(item.Status) > 0 && string(item.Status) != "null" {
			var status struct {
				Satisfied *bool `json:"satisfied"`
			}
			if err := json.Unmarshal(item.Status, &status); err != nil {
				return nil, fmt.Errorf("assignments: decode status: %w", err)
			}
			spec.StatusSatisfied = status.Satisfied
		}
		records = append(records, spec)
	}
	return &assignmentPage{Records: records, Continue: page.Metadata.Continue}, nil
}

// UpdateStatus writes one obligation's evaluated satisfaction. The completion
// write calls this; a 403 is the caller's to log, not a failed completion.
func (c *assignmentHTTPClient) UpdateStatus(ctx context.Context, namespace, name string, satisfied bool) error {
	body, err := json.Marshal(map[string]any{
		"apiVersion": assignmentsGroupVersion,
		"kind":       "Assignment",
		"metadata":   map[string]string{"name": name, "namespace": namespace},
		"status":     map[string]bool{"satisfied": satisfied},
	})
	if err != nil {
		return fmt.Errorf("assignments: encode status: %w", err)
	}
	return c.inner.updateStatus(ctx, assignmentsGroupVersion, namespace, assignmentsResource, name, body, assignmentListMaxBytes)
}
