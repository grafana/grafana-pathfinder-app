package plugin

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

// Upstream coordinates for the Assignment kind (pathfinder-rfcs
// rfc/PATH_ASSIGNMENTS.md §7.1): a namespaced sibling of CompletionRecord in
// the same App Platform group, so an obligation and its fulfilment key on one
// subject vocabulary and join without an identity bridge.
//
// The kind is NOT registered upstream yet — that RFC's §11 lists it as
// dependency 8, and pathfinder-backend's manifest serves InteractiveGuide and
// GuideCompletion only. Until it ships, a LIST here addresses a resource the
// aggregator does not serve and comes back 404: a terminal error, which
// handleMyAssignments reports as capability=false rather than as a hiccup.
// Nothing in this file changes when the kind lands.
const (
	// assignmentsGroupVersion is derived from appPlatformGroup
	// (app_platform_client.go) so it cannot drift from the group name.
	assignmentsGroupVersion = appPlatformGroup + "/v1alpha1"
	assignmentsResource     = "assignments"

	// assignmentListPageSize bounds each upstream LIST page. The proxy drains
	// all pages, so this only trades round-trips against per-response size.
	assignmentListPageSize = 500

	// assignmentListMaxBytes bounds an individual page body so a pathological
	// namespace cannot exhaust plugin memory. The aggregate budget across pages
	// is assignmentListMaxTotalRecords (assignments.go).
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

// assignmentSpec mirrors the fields of the Assignment `spec` this read proxy
// consumes. Every field lives in `spec` and is provisioner-written: the RFC
// puts the whole obligation there precisely so a future grant letting a user
// record satisfaction cannot also let them withdraw their own obligation
// (§6.10). Unlisted spec fields are ignored by encoding/json.
//
// `satisfied` is deliberately absent. It lives in the kind's `status`
// subresource as a cache for consumers that cannot compute the join (§6.12),
// and this route is required to evaluate live instead so a learner who has just
// finished a path never waits on a materialiser (§7.4). The shared LIST client
// decodes `items[].spec` only, so the cached copy is not even reachable here —
// which enforces that requirement structurally rather than by discipline.
type assignmentSpec struct {
	UserID  string `json:"userId"`
	PathID  string `json:"pathId"`
	TrackID string `json:"trackId"`

	// RuleID is the authored rule's stable slug, stamped into every record's
	// provenance from day one (§6.13). Nothing reads it back yet; it is the
	// addressing key a future withdrawal action needs.
	RuleID     string `json:"ruleId"`
	AssignedBy string `json:"assignedBy"`
	AssignedAt string `json:"assignedAt"`

	// DueAt is soft by definition (§6.9): an obligation past it is displayed as
	// overdue and never locked out. Absent means no deadline, which is what MVP
	// writes, so a reader treating absent that way needs no change when due
	// dates start being written.
	DueAt string `json:"dueAt"`

	// AcceptCompletionsFrom is the earliest completion that counts toward this
	// obligation (§6.9). Absent credits any prior completion.
	AcceptCompletionsFrom string `json:"acceptCompletionsFrom"`

	// Lifecycle is "active" or "withdrawn" — the only part of an obligation
	// that ever changes. MVP's provisioner never writes the second value
	// (§6.10, §12.5).
	Lifecycle string `json:"lifecycle"`
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

	records := make([]assignmentSpec, 0, len(page.Specs))
	for _, raw := range page.Specs {
		var spec assignmentSpec
		if err := json.Unmarshal(raw, &spec); err != nil {
			return nil, fmt.Errorf("assignments: decode spec: %w", err)
		}
		records = append(records, spec)
	}
	return &assignmentPage{Records: records, Continue: page.Continue}, nil
}
