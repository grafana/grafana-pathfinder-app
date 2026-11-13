// Code generated - EDITING IS FUTILE. DO NOT EDIT.

package v1alpha1

// +k8s:openapi-gen=true
type Spec struct {
	// userId is the assigned person, in the stack's canonical subject
	// vocabulary: the typed ID-token subject (such as "user:27"), the
	// same one CompletionRecord uses so obligation and fulfilment join
	// without an identity bridge. Logins are mutable; this is not.
	UserId string `json:"userId"`
	// targetType discriminates the namespace targetId lives in:
	// "github-visualize" can be both a path and a guide. Adding a
	// value later is an enum expansion, so existing rows stay valid.
	// Never default it — absent-means-path would collide with a mixed
	// population, and a single-value CUE constraint emits no enum.
	TargetType SpecTargetType `json:"targetType"`
	// targetId is the assigned thing within targetType's namespace.
	// For targetType "path" this is the learning path id.
	TargetId string `json:"targetId"`
	// trackId qualifies a path target to a specific named track.
	// Absent means the whole path. Meaningless for a non-path
	// targetType; leave it absent.
	TrackId *string `json:"trackId,omitempty"`
	// targetSource is the provenance of targetId when that identity is
	// a pair, matching CompletionRecord's (guideSource, guideId).
	// Absent for paths, which have no source in that sense.
	TargetSource *string `json:"targetSource,omitempty"`
	// ruleId is the authored assignment rule's stable slug, stamped into
	// every record. It is the addressing key for withdrawal.
	RuleId string `json:"ruleId"`
	// ruleRevision is the specific rule revision that produced this
	// record, so an obligation is auditable back to a decision.
	// Free-form (a git SHA, a generation, a tag). Absent if the
	// writer has none.
	RuleRevision *string `json:"ruleRevision,omitempty"`
	// assignedBy is the assigning authority — which Learning Admin, or
	// the group acting as one. Free-form; no identifier format is
	// prescribed. Absent is allowed.
	AssignedBy *string `json:"assignedBy,omitempty"`
	// assignedAt is the ISO 8601 timestamp of when this obligation was
	// incurred. Written once, never modified.
	AssignedAt string `json:"assignedAt"`
	// dueAt is when completions after this are late. Soft by definition:
	// an overdue obligation is displayed as overdue and never locked
	// out. Absent means no deadline.
	DueAt *string `json:"dueAt,omitempty"`
	// acceptCompletionsFrom is the earliest completion that counts
	// toward this obligation. Absent credits any prior completion.
	AcceptCompletionsFrom *string `json:"acceptCompletionsFrom,omitempty"`
	// lifecycle is "active" or "withdrawn" — the only part of an
	// obligation that ever changes. Records are never deleted.
	Lifecycle SpecLifecycle `json:"lifecycle"`
	// withdrawnAt is the ISO 8601 timestamp of the active → withdrawn
	// transition. Absent when lifecycle is active. A nested
	// {state, at} object would prevent either field becoming a
	// metadata.label.
	WithdrawnAt *string `json:"withdrawnAt,omitempty"`
	// schemaVersion is the Assignment spec schema version (>= 1).
	// Separate from the CRD apiVersion so a schema mistake can be
	// corrected without an API-version bump.
	SchemaVersion int64 `json:"schemaVersion"`
}

// NewSpec creates a new Spec object.
func NewSpec() *Spec {
	return &Spec{}
}

// OpenAPIModelName returns the OpenAPI model name for Spec.
func (Spec) OpenAPIModelName() string {
	return "com.github.grafana.grafana-pathfinder-app.pkg.generated.assignment.v1alpha1.Spec"
}

// +k8s:openapi-gen=true
type SpecTargetType string

const (
	SpecTargetTypePath  SpecTargetType = "path"
	SpecTargetTypeGuide SpecTargetType = "guide"
)

// OpenAPIModelName returns the OpenAPI model name for SpecTargetType.
func (SpecTargetType) OpenAPIModelName() string {
	return "com.github.grafana.grafana-pathfinder-app.pkg.generated.assignment.v1alpha1.SpecTargetType"
}

// +k8s:openapi-gen=true
type SpecLifecycle string

const (
	SpecLifecycleActive    SpecLifecycle = "active"
	SpecLifecycleWithdrawn SpecLifecycle = "withdrawn"
)

// OpenAPIModelName returns the OpenAPI model name for SpecLifecycle.
func (SpecLifecycle) OpenAPIModelName() string {
	return "com.github.grafana.grafana-pathfinder-app.pkg.generated.assignment.v1alpha1.SpecLifecycle"
}
