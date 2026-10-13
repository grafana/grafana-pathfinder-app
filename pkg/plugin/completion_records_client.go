package plugin

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

// completionRecordsGroupVersion is the App Platform API group/version that
// serves the CompletionRecord kind. The plural resource name is
// "completionrecords". Completion data lives exclusively on the .app group, so
// the read and write proxies must both address it — a record written to one
// store would never surface in "my completions" if reads hit another.
const (
	// completionRecordsGroupVersion is derived from appPlatformGroup
	// (app_platform_client.go) so it cannot drift from the group name.
	completionRecordsGroupVersion = appPlatformGroup + "/v1alpha1"
	completionRecordsResource     = "completionrecords"

	// completionListPageSize bounds each upstream LIST page. The proxy drains
	// all pages, so this only trades round-trips against per-response size.
	completionListPageSize = 500

	// completionListMaxBytes bounds an individual page body so a pathological
	// namespace can't exhaust plugin memory. The aggregate budget across pages
	// is completionListMaxTotalRecords (completion_records.go).
	completionListMaxBytes = 8 * 1024 * 1024
)

// completionRecordsAggregationToggle is the boot feature toggle the
// aggregation layer sets when the .app pathfinderbackend group is served on
// this instance. The completion routes (read, write, capability) gate on
// this alone: completion data lives only on the .app group, so where it is
// not served the feature is correctly unavailable (the front end handles
// unavailable/404 gracefully). It is a PRECONDITION, not the availability
// answer — the resolvers additionally require an app URL, a namespace, and a
// provisioned on-behalf-of credential. Derived from appPlatformGroup so it
// cannot drift from the group name.
var completionRecordsAggregationToggle = aggregationToggle(appPlatformGroup)

// completionRecordSpec mirrors the fields of the CompletionRecord `spec` that
// this read proxy consumes. Unlisted spec fields (durationSeconds, userLogin,
// recordedAt, orgId, …) are ignored by encoding/json. Field names track
// kinds/completionrecord.cue.
//
// CompletedAt is empty on an in-progress attempt record (the CRD makes it
// optional): only a record at 100% is a completion.
type completionRecordSpec struct {
	UserID            string `json:"userId"`
	GuideID           string `json:"guideId"`
	GuideSource       string `json:"guideSource"`
	GuideTitle        string `json:"guideTitle"`
	GuideCategory     string `json:"guideCategory"`
	PathID            string `json:"pathId"`
	Source            string `json:"source"`
	CompletedAt       string `json:"completedAt"`
	RecordedAt        string `json:"recordedAt"`
	CompletionPercent int64  `json:"completionPercent"`

	// LastUpdatedAt is when the record last changed: the server-stamped
	// grafana.app/updatedTimestamp annotation when present and parseable, else
	// spec.recordedAt. Filled from object metadata by ListPage, never from spec.
	LastUpdatedAt    string `json:"-"`
	AttemptStartedAt string `json:"-"`
}

// completionUpdatedTimestampAnnotation is the annotation the App Platform
// apistore stamps on every update (absent after create). Verified on dev in the
// incremental-progress spike; grafana.com/updateTimestamp is not used.
const completionUpdatedTimestampAnnotation = "grafana.app/updatedTimestamp"

// recordLastUpdatedAt picks the annotation when it parses, else recordedAt.
func recordLastUpdatedAt(annotations map[string]string, recordedAt string) string {
	if ts := annotations[completionUpdatedTimestampAnnotation]; ts != "" {
		if _, ok := parseCompletionTime(ts); ok {
			return ts
		}
	}
	return recordedAt
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

// completionWriteMaxBytes bounds the created-object response body. A single
// CompletionRecord is small; this is a generous ceiling against a pathological
// upstream.
const completionWriteMaxBytes = 256 * 1024

// completionRecordWriteSpec is the FULL CompletionRecord spec written on create.
// Every field is required by the CRD (kinds/completionrecord.cue enforces
// presence on all fields — it is the only enforcement surface that ships under
// the manifest-only posture), so the handler must populate all of them. Field
// names track pathfinder-backend's generated Go spec (its
// pkg/generated/completionrecord, not this repo's pkg/). The first
// block is client-supplied (WHAT was completed); the second is stamped by this
// trusted writer from its verified request context (never from the body).
type completionRecordWriteSpec struct {
	AttemptStartedAt string `json:"-"`
	GuideID          string `json:"guideId"`
	GuideSource      string `json:"guideSource"`
	GuideTitle       string `json:"guideTitle"`
	PathID           string `json:"pathId"`
	Source           string `json:"source"`
	// CompletedAt is omitted on an in-progress attempt record: it is set once,
	// when the attempt reaches 100%. Legacy (non-attempt) writes always set it.
	CompletedAt       string `json:"completedAt,omitempty"`
	DurationSeconds   int64  `json:"durationSeconds"`
	CompletionPercent int64  `json:"completionPercent"`
	GuideCategory     string `json:"guideCategory"`
	Platform          string `json:"platform"`

	UserID          string `json:"userId"`
	UserLogin       string `json:"userLogin"`
	UserDisplayName string `json:"userDisplayName"`
	RecordedAt      string `json:"recordedAt"`
	OrgID           int64  `json:"orgId"`
	StackNamespace  string `json:"stackNamespace"`
	SchemaVersion   int64  `json:"schemaVersion"`
}

// completionRecordObjectMeta is the subset of Kubernetes object metadata the
// writer sets. The name is server-derived deterministically from the trusted
// userID and the required idempotency key (completionRecordName), never supplied
// by the client, so a retried create targets the same object and an upstream 409
// is an idempotent success.
type completionRecordObjectMeta struct {
	Name        string            `json:"name"`
	Namespace   string            `json:"namespace"`
	Annotations map[string]string `json:"annotations,omitempty"`
}

// storedCompletionRecord is a record read back by name for an attempt upsert.
// Raw is the full object as returned (minus metadata.managedFields), so a PUT
// carries every field the server holds, including ones this plugin does not
// model. Spec is the decoded view the upsert reasons about.
type storedCompletionRecord struct {
	Raw  map[string]any
	Spec completionRecordWriteSpec
}

// completionRecordUpdater is the attempt-upsert surface: read one record by
// name and replace it. Get returns (nil, nil) when the record does not exist
// (a Kubernetes NotFound Status); any other failure is an error. The
// production implementation is completionHTTPClient, whose calls share one
// access token per request.
type completionRecordUpdater interface {
	completionRecordCreator
	Get(ctx context.Context, namespace, name string) (*storedCompletionRecord, error)
	Replace(ctx context.Context, namespace, name string, obj map[string]any) error
}

// completionRecordObject is the full aggregated-API object POSTed on create.
type completionRecordObject struct {
	APIVersion string                     `json:"apiVersion"`
	Kind       string                     `json:"kind"`
	Metadata   completionRecordObjectMeta `json:"metadata"`
	Spec       completionRecordWriteSpec  `json:"spec"`
}

// completionRecordCreator abstracts a single upstream create so the write
// handler can be unit-tested with a fake that captures the object without an
// HTTP server. The production implementation is completionHTTPClient.
type completionRecordCreator interface {
	Create(ctx context.Context, namespace string, obj completionRecordObject) error
}

// completionHTTPClient is the per-kind wrapper over the shared App Platform
// LIST client: it supplies the completionrecords coordinates and decodes each
// `items[].spec` into a completionRecordSpec.
type completionHTTPClient struct {
	inner *appPlatformListClient
}

// newCompletionHTTPClient builds a lister that calls appURL as the user the
// caller's ID token identifies, using an access token minted from that token. A
// namespace-scoped LIST returns every record in the namespace (Kubernetes
// RBAC is namespace-, not object-, scoped), which is what lets one refresh
// collate all users. If a caller lacks list permission on completionrecords
// the upstream returns 401/403, surfaced as an identity-scoped terminal error.
func newCompletionHTTPClient(appURL string, minter accessTokenMinter, idToken string, logger log.Logger) *completionHTTPClient {
	return &completionHTTPClient{inner: newAppPlatformListClient(appURL, minter, idToken, logger)}
}

// ListPage fetches one page of CompletionRecords for the namespace.
func (c *completionHTTPClient) ListPage(ctx context.Context, namespace, continueToken string) (*completionRecordPage, error) {
	page, err := c.inner.listPage(ctx, completionRecordsGroupVersion, namespace,
		completionRecordsResource, continueToken, completionListPageSize, completionListMaxBytes)
	if err != nil {
		return nil, err
	}

	records := make([]completionRecordSpec, 0, len(page.Items))
	for _, item := range page.Items {
		var spec completionRecordSpec
		if err := json.Unmarshal(item.Spec, &spec); err != nil {
			return nil, fmt.Errorf("completion records: decode spec: %w", err)
		}
		spec.LastUpdatedAt = recordLastUpdatedAt(item.Metadata.Annotations, spec.RecordedAt)
		spec.AttemptStartedAt = item.Metadata.Annotations[completionAttemptStartedAnnotation]
		records = append(records, spec)
	}
	return &completionRecordPage{Records: records, Continue: page.Metadata.Continue}, nil
}

// Create POSTs one fully-stamped CompletionRecord to the namespace collection.
// The apiVersion/kind coordinates come from this package; the object's identity
// and spec are supplied by the caller (the write handler stamps them). The
// returned error, when non-nil, carries the upstream status for
// transient/terminal/identity-scoped classification.
func (c *completionHTTPClient) Create(ctx context.Context, namespace string, obj completionRecordObject) error {
	obj.APIVersion = completionRecordsGroupVersion
	obj.Kind = "CompletionRecord"
	obj.Metadata.Namespace = namespace

	body, err := json.Marshal(obj)
	if err != nil {
		return fmt.Errorf("completion records: encode object: %w", err)
	}
	return c.inner.create(ctx, completionRecordsGroupVersion, namespace,
		completionRecordsResource, body, completionWriteMaxBytes)
}

// Get reads one record by name. A 404 whose body is a Kubernetes Status with
// reason NotFound means the record does not exist and returns (nil, nil). Any
// other 404 is structural (the route is not served) and stays an error, so the
// write path passes it through and the client disarms as for a create.
func (c *completionHTTPClient) Get(ctx context.Context, namespace, name string) (*storedCompletionRecord, error) {
	body, err := c.inner.get(ctx, completionRecordsGroupVersion, namespace, completionRecordsResource, name, completionWriteMaxBytes)
	if err != nil {
		if status, ok := upstreamStatusOf(err); ok && status == http.StatusNotFound && upstreamStatusReasonOf(err) == "NotFound" {
			return nil, nil
		}
		return nil, err
	}
	return decodeStoredCompletionRecord(body)
}

// Replace PUTs the full object back. obj must carry the resourceVersion it was
// read at; a stale one is a 409 the caller retries.
func (c *completionHTTPClient) Replace(ctx context.Context, namespace, name string, obj map[string]any) error {
	body, err := json.Marshal(obj)
	if err != nil {
		return fmt.Errorf("completion records: encode object: %w", err)
	}
	return c.inner.replace(ctx, completionRecordsGroupVersion, namespace, completionRecordsResource, name, body, completionWriteMaxBytes)
}

// decodeStoredCompletionRecord decodes a GET body into the raw object (with
// metadata.managedFields dropped: a PUT must not echo server-owned field
// ownership back) and its typed spec.
func decodeStoredCompletionRecord(body []byte) (*storedCompletionRecord, error) {
	var raw map[string]any
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.UseNumber() // numbers round-trip unchanged on the PUT
	if err := dec.Decode(&raw); err != nil {
		return nil, &guideProxyError{diagnostic: guideProxyDiagnostic{Outcome: "error", Reason: "invalid-json"}, err: fmt.Errorf("completion records: decode object: %w", err)}
	}
	if meta, ok := raw["metadata"].(map[string]any); ok {
		delete(meta, "managedFields")
	}
	var typed struct {
		Spec completionRecordWriteSpec `json:"spec"`
	}
	if err := json.Unmarshal(body, &typed); err != nil {
		return nil, &guideProxyError{diagnostic: guideProxyDiagnostic{Outcome: "error", Reason: "invalid-json"}, err: fmt.Errorf("completion records: decode spec: %w", err)}
	}
	return &storedCompletionRecord{Raw: raw, Spec: typed.Spec}, nil
}
