// Code generated - EDITING IS FUTILE. DO NOT EDIT.

package v1alpha1

import (
	time "time"
)

// +k8s:openapi-gen=true
type Spec struct {
	// achievementId is the catalog achievement's stable id.
	AchievementId string `json:"achievementId"`
	// tierId is the catalog id of the tier earned, a lowercase slug of at
	// most 64 characters. Each tier is its own row.
	TierId string `json:"tierId"`
	// entity is the kind of thing the event that crossed the tier acted on,
	// such as "dashboards" or "guides".
	Entity string `json:"entity"`
	// earnedAt is the RFC 3339 UTC timestamp of when the plugin earned the
	// tier, from the plugin's clock and never the client-reported time.
	EarnedAt time.Time `json:"earnedAt"`
	// userId is the verified ID-token subject (such as "user:27"), the same
	// value CompletionRecord and Assignment store.
	UserId string `json:"userId"`
	// userLogin is the Grafana login at the time of the write.
	UserLogin *string `json:"userLogin,omitempty"`
	// userDisplayName is the display name at the time of the write.
	UserDisplayName *string `json:"userDisplayName,omitempty"`
	// orgId is the Grafana organization the write originated from.
	OrgId int64 `json:"orgId"`
	// stackNamespace is the App Platform namespace the row was written into.
	StackNamespace string `json:"stackNamespace"`
	// schemaVersion is the AchievementAward spec schema version (>= 1).
	// Separate from the CRD apiVersion so a schema mistake can be corrected
	// without an API-version bump.
	SchemaVersion int64 `json:"schemaVersion"`
}

// NewSpec creates a new Spec object.
func NewSpec() *Spec {
	return &Spec{}
}

// OpenAPIModelName returns the OpenAPI model name for Spec.
func (Spec) OpenAPIModelName() string {
	return "com.github.grafana.grafana-pathfinder-app.pkg.generated.achievementaward.v1alpha1.Spec"
}
