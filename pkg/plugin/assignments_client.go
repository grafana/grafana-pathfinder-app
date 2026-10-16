package plugin

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

// Upstream coordinates for the Assignment kind (kinds/assignment.cue). A stack
// that has not registered the kind answers LIST with 404 (capability=false).
const (
	// assignmentsGroupVersion is derived from appPlatformGroup
	// (app_platform_client.go) so it cannot drift from the group name.
	assignmentsGroupVersion = appPlatformGroup + "/v1alpha1"
	assignmentsResource     = "assignments"

	assignmentListPageSize = 500

	// assignmentListMaxBytes bounds one page body. There is deliberately no
	// record cap: it would silently drop the caller's record past the cut.
	assignmentListMaxBytes = 8 * 1024 * 1024
)

// assignmentsAggregationToggle is a precondition for availability;
// resolveAssignmentBackend also requires an app URL, namespace and credential.
var assignmentsAggregationToggle = aggregationToggle(appPlatformGroup)

// assignmentSpec is the Assignment spec this proxy consumes. Name,
// ResourceVersion and StatusSatisfied come from metadata and status;
// StatusSatisfied is nil when absent.
type assignmentSpec struct {
	Name            string `json:"-"`
	ResourceVersion string `json:"-"`
	StatusSatisfied *bool  `json:"-"`

	UserID       string `json:"userId"`
	TargetType   string `json:"targetType"`
	TargetID     string `json:"targetId"`
	TrackID      string `json:"trackId"`
	TargetSource string `json:"targetSource"`

	RuleID     string `json:"ruleId"`
	AssignedBy string `json:"assignedBy"`
	AssignedAt string `json:"assignedAt"`

	DueAt                 string `json:"dueAt"`
	AcceptCompletionsFrom string `json:"acceptCompletionsFrom"`

	Lifecycle string `json:"lifecycle"`
}

// assignmentPage is one page of a namespace LIST: the decoded specs plus the
// Kubernetes continue token (empty when the listing is drained).
type assignmentPage struct {
	Records  []assignmentSpec
	Continue string
}

// assignmentLister abstracts the upstream LIST and status write so tests can
// inject a fake. The production implementation is assignmentHTTPClient.
type assignmentLister interface {
	ListPage(ctx context.Context, namespace, continueToken string) (*assignmentPage, error)
	UpdateStatus(ctx context.Context, namespace, name, resourceVersion string, satisfied bool) error
}

// assignmentHTTPClient wraps the shared App Platform client with the
// assignments coordinates.
type assignmentHTTPClient struct {
	inner *appPlatformListClient
}

// newAssignmentHTTPClient calls appURL as the caller, with an access token
// minted from their ID token. The LIST is namespace-scoped, so the per-page
// caller filter in drainAssignments is the trust boundary.
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
		spec.ResourceVersion = item.Metadata.ResourceVersion
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

// UpdateStatus writes status.satisfied. resourceVersion is required by the
// status subresource, even on a first write.
func (c *assignmentHTTPClient) UpdateStatus(ctx context.Context, namespace, name, resourceVersion string, satisfied bool) error {
	body, err := json.Marshal(map[string]any{
		"apiVersion": assignmentsGroupVersion,
		"kind":       "Assignment",
		"metadata":   map[string]string{"name": name, "namespace": namespace, "resourceVersion": resourceVersion},
		"status":     map[string]bool{"satisfied": satisfied},
	})
	if err != nil {
		return fmt.Errorf("assignments: encode status: %w", err)
	}
	return c.inner.updateStatus(ctx, assignmentsGroupVersion, namespace, assignmentsResource, name, body, assignmentListMaxBytes)
}
