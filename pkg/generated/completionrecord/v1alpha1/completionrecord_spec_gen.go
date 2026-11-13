// Code generated - EDITING IS FUTILE. DO NOT EDIT.

package v1alpha1

// +k8s:openapi-gen=true
type Spec struct {
	// guideId is the guide identifier WITHIN its source (not globally unique on
	// its own; the durable guide identity is the pair (guideSource, guideId)).
	GuideId string `json:"guideId"`
	// guideSource is the provenance of the guide (= the resolving repository).
	// v1 values: "bundled" | "app-platform" | "remote-repo:<name>". The durable
	// guide identity is the pair (guideSource, guideId). Kept as a free-form
	// string so new sources need no schema bump. Distinct from `source` below:
	// guideSource is WHERE the guide came from, `source` is HOW it was completed.
	GuideSource string `json:"guideSource"`
	// guideTitle is the denormalized guide title, snapshotted at write time so
	// dashboards remain readable years later even if the guide is renamed or
	// removed (RFC §6.10).
	GuideTitle string `json:"guideTitle"`
	// pathId is the learning path ID (empty string if none).
	PathId string `json:"pathId"`
	// source is HOW the completion happened: "objectives" (earned by completing all
	// objectives), "manual" (marked complete by the user), or "skipped" (user used
	// the "skip remaining" affordance). Distinct from guideSource above, which is
	// WHERE the guide came from (RFC §7.1, §6.11).
	Source SpecSource `json:"source"`
	// completedAt is the ISO 8601 timestamp of WHEN THE USER COMPLETED the guide
	// (client-supplied; preserved unchanged across offline/queued retries).
	// OPTIONAL: absent while the guide is in progress. Set exactly once, when
	// completionPercent reaches 100, and never cleared afterwards.
	CompletedAt *string `json:"completedAt,omitempty"`
	// durationSeconds is the time from first view to completion.
	DurationSeconds int64 `json:"durationSeconds"`
	// completionPercent is the highest completion percentage (0-100) reached in
	// this attempt; 100 means the guide is complete. NOTE: the generator emits
	// this as uint64 in Go and drops the >=0 minimum from the CRD JSON; the <=100
	// upper bound is preserved. Accepted codegen quirk — do not fight the generator.
	CompletionPercent uint64 `json:"completionPercent"`
	// guideCategory is the category of the guide.
	// Valid values: "interactive", "documentation", "learning-journey".
	GuideCategory SpecGuideCategory `json:"guideCategory"`
	// platform is the platform where the guide was completed.
	// Valid values: "oss", "cloud".
	Platform SpecPlatform `json:"platform"`
	// userId is the stable, rename-safe user identifier the trusted writer derives
	// from the Grafana ID token. Logins are mutable, so this is the durable join
	// key for "everything this user did" (RFC §7.1).
	UserId string `json:"userId"`
	// userLogin is the Grafana user login at the time of the write.
	UserLogin string `json:"userLogin"`
	// userDisplayName is the denormalized display name, snapshotted at write time
	// so dashboards remain readable years later even after the user is renamed or
	// deleted (RFC §6.10).
	UserDisplayName string `json:"userDisplayName"`
	// recordedAt is the ISO 8601 timestamp of WHEN THE LAST WRITE LANDED
	// (authoritative), re-stamped on every write. Distinct from completedAt: a
	// queued retry that lands hours later still reports the true completion time
	// in completedAt while recordedAt reflects when the record was last written
	// (RFC §7.1).
	RecordedAt string `json:"recordedAt"`
	// orgId is the Grafana organization identifier the write originated from,
	// making the per-record org context explicit rather than implicit (RFC §7.1).
	OrgId int64 `json:"orgId"`
	// stackNamespace is the App Platform namespace (per-stack scope) the record was
	// written into. The CRD is namespaced per-stack, but §7.1 requires that linkage
	// explicit on the record for future cross-stack analysis/export.
	StackNamespace string `json:"stackNamespace"`
	// schemaVersion is the CompletionRecord spec schema version (>= 1). Separate
	// from the CRD apiVersion so we can correct schema mistakes without an
	// API-version bump (RFC §7.1).
	SchemaVersion int64 `json:"schemaVersion"`
}

// NewSpec creates a new Spec object.
func NewSpec() *Spec {
	return &Spec{}
}

// OpenAPIModelName returns the OpenAPI model name for Spec.
func (Spec) OpenAPIModelName() string {
	return "com.github.grafana.grafana-pathfinder-app.pkg.generated.completionrecord.v1alpha1.Spec"
}

// +k8s:openapi-gen=true
type SpecSource string

const (
	SpecSourceObjectives SpecSource = "objectives"
	SpecSourceManual     SpecSource = "manual"
	SpecSourceSkipped    SpecSource = "skipped"
)

// OpenAPIModelName returns the OpenAPI model name for SpecSource.
func (SpecSource) OpenAPIModelName() string {
	return "com.github.grafana.grafana-pathfinder-app.pkg.generated.completionrecord.v1alpha1.SpecSource"
}

// +k8s:openapi-gen=true
type SpecGuideCategory string

const (
	SpecGuideCategoryInteractive     SpecGuideCategory = "interactive"
	SpecGuideCategoryDocumentation   SpecGuideCategory = "documentation"
	SpecGuideCategoryLearningJourney SpecGuideCategory = "learning-journey"
)

// OpenAPIModelName returns the OpenAPI model name for SpecGuideCategory.
func (SpecGuideCategory) OpenAPIModelName() string {
	return "com.github.grafana.grafana-pathfinder-app.pkg.generated.completionrecord.v1alpha1.SpecGuideCategory"
}

// +k8s:openapi-gen=true
type SpecPlatform string

const (
	SpecPlatformOss   SpecPlatform = "oss"
	SpecPlatformCloud SpecPlatform = "cloud"
)

// OpenAPIModelName returns the OpenAPI model name for SpecPlatform.
func (SpecPlatform) OpenAPIModelName() string {
	return "com.github.grafana.grafana-pathfinder-app.pkg.generated.completionrecord.v1alpha1.SpecPlatform"
}
