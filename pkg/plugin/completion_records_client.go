package plugin

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

// completionRecordsGroupVersion is the App Platform API group/version that
// serves the CompletionRecord kind. The plural resource name is
// "completionrecords". Verified against grafana-pathfinder-backend
// kinds/completionrecord.cue and its generated CRD (groupOverride
// pathfinderbackend.ext.grafana.com).
const (
	completionRecordsGroupVersion = "pathfinderbackend.ext.grafana.com/v1alpha1"
	completionRecordsResource     = "completionrecords"

	// completionListPageSize bounds each upstream LIST page. The proxy drains
	// all pages, so this only trades round-trips against per-response size.
	completionListPageSize = 500

	// completionListMaxBytes bounds an individual page body so a pathological
	// namespace can't exhaust plugin memory. The aggregate budget across pages
	// is completionListMaxTotalRecords (completion_records.go).
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

// completionHTTPClient is the per-kind wrapper over the shared App Platform
// LIST client: it supplies the completionrecords coordinates and decodes each
// `items[].spec` into a completionRecordSpec.
type completionHTTPClient struct {
	inner *appPlatformListClient
}

// newCompletionHTTPClient builds a lister that calls appURL with identity
// derived from the caller's ID token (forwardIdentityHeaders). A
// namespace-scoped LIST returns every record in the namespace (Kubernetes
// RBAC is namespace-, not object-, scoped), which is what lets one refresh
// collate all users. If a caller lacks list permission on completionrecords
// the upstream returns 401/403, surfaced as an identity-scoped terminal error.
func newCompletionHTTPClient(appURL, idToken string, logger log.Logger) *completionHTTPClient {
	return &completionHTTPClient{inner: newAppPlatformListClient(appURL, idToken, logger)}
}

// ListPage fetches one page of CompletionRecords for the namespace.
func (c *completionHTTPClient) ListPage(ctx context.Context, namespace, continueToken string) (*completionRecordPage, error) {
	page, err := c.inner.listPage(ctx, completionRecordsGroupVersion, namespace,
		completionRecordsResource, continueToken, completionListPageSize, completionListMaxBytes)
	if err != nil {
		return nil, err
	}

	records := make([]completionRecordSpec, 0, len(page.Specs))
	for _, raw := range page.Specs {
		var spec completionRecordSpec
		if err := json.Unmarshal(raw, &spec); err != nil {
			return nil, fmt.Errorf("completion records: decode spec: %w", err)
		}
		records = append(records, spec)
	}
	return &completionRecordPage{Records: records, Continue: page.Continue}, nil
}
