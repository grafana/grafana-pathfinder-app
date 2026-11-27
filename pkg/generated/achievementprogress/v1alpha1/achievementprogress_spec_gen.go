// Code generated - EDITING IS FUTILE. DO NOT EDIT.

package v1alpha1

import (
	time "time"
)

// +k8s:openapi-gen=true
type Spec struct {
	// achievementId is the catalog achievement's stable id.
	AchievementId string `json:"achievementId"`
	// tierIds is the set of catalog tier ids held, each a lowercase slug of
	// at most 64 characters. The writer keeps it distinct; the CRD cannot
	// enforce that (Kubernetes forbids uniqueItems, and this codegen emits
	// neither x-kubernetes-list-type nor CEL rules).
	TierIds []string `json:"tierIds"`
	// units is the grow-only set of distinct units counted (a dashboard uid,
	// a guide, an event id). The writer keeps it sorted and distinct; the CRD
	// cannot express either, so neither is enforced here. The cap is the
	// 1,040-byte unit-key limit, but maxLength counts characters, so it
	// admits every unit within that byte limit and some longer in bytes.
	Units []string `json:"units"`
	// eventIds is the set of ids of the events counted: one per units entry,
	// and at most one per held tier, for an event that earned the tier
	// after another event had counted its unit. A posted event whose id is
	// listed counts nothing more. Event ids are 1 to 64 bytes, so 64
	// characters admits every one. The writer keeps the set sorted and
	// distinct. Rows stored before this field existed have none.
	EventIds []string `json:"eventIds,omitempty"`
	// points is earned toward the lowest catalog tier tierIds does not hold.
	// It resets to 0 when that tier is earned, so it stays below the tier's
	// goal, which is at most 200.
	Points int64 `json:"points"`
	// updatedAt is the RFC 3339 UTC timestamp of the last write.
	UpdatedAt time.Time `json:"updatedAt"`
	// userId is the verified ID-token subject (such as "user:27"), the same
	// value CompletionRecord and Assignment store.
	UserId string `json:"userId"`
	// orgId is the Grafana organization the write originated from.
	OrgId int64 `json:"orgId"`
	// stackNamespace is the App Platform namespace the record was written into.
	StackNamespace string `json:"stackNamespace"`
	// schemaVersion is the AchievementProgress spec schema version (>= 1).
	// Separate from the CRD apiVersion so a schema mistake can be corrected
	// without an API-version bump.
	SchemaVersion int64 `json:"schemaVersion"`
}

// NewSpec creates a new Spec object.
func NewSpec() *Spec {
	return &Spec{
		TierIds: []string{},
		Units:   []string{},
		Points:  0,
	}
}

// OpenAPIModelName returns the OpenAPI model name for Spec.
func (Spec) OpenAPIModelName() string {
	return "com.github.grafana.grafana-pathfinder-app.pkg.generated.achievementprogress.v1alpha1.Spec"
}
