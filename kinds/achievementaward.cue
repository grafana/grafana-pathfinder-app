package kinds

import (
	"strings"
	"time"
)

// achievementAwardKind is the kind metadata for AchievementAward, reusable across versions.
achievementAwardKind: {
	kind:       "AchievementAward"
	pluralName: "AchievementAwards"
	scope:      "Namespaced"
	// folderScoped: false — this kind is not folder-based. This does not tighten
	// RBAC; it only drops folder access from the authz question, leaving
	// "access = has stack role" instead of "has stack role AND has folder access".
	folderScoped: false
	codegen: {
		ts: {
			enabled: false
		}
		go: {
			enabled: true
		}
	}
}

// achievementawardv1alpha1 is the v1alpha1 version of the AchievementAward kind.
//
// One immutable row per (user, achievement, tier) earned. The writer names each
// object hash(userId ‖ 0x00 ‖ achievementId ‖ 0x00 ‖ tierId), so a retried create
// is a 409 meaning "already earned". Rows are never updated; the kind carries no
// status.
//
// The schema constrains award fields. The SDK achievement handler establishes
// caller identity before recording an award.
achievementawardv1alpha1: achievementAwardKind & {
	schema: {
		spec: {
			// ---------------------------------------------------------------
			// Client-derived fields (required).
			// ---------------------------------------------------------------

			// achievementId is the catalog achievement's stable id.
			achievementId: string & strings.MinRunes(1) & strings.MaxRunes(128)
			// tierId is the catalog id of the tier earned, a lowercase slug of at
			// most 64 characters. Each tier is its own row.
			tierId: string & =~"^[a-z][a-z0-9-]*$" & strings.MaxRunes(64)
			// entity is the kind of thing the event that crossed the tier acted on,
			// such as "dashboards" or "guides".
			entity: string & strings.MinRunes(1) & strings.MaxRunes(32)

			// ---------------------------------------------------------------
			// Writer-stamped fields. userLogin and userDisplayName are display
			// snapshots, omitted when unavailable; the rest are required.
			// ---------------------------------------------------------------

			// earnedAt is the RFC 3339 UTC timestamp of when the plugin earned the
			// tier, from the plugin's clock and never the client-reported time.
			earnedAt: string & time.Time & =~"Z$"
			// userId is the verified ID-token subject (such as "user:27"), the same
			// value CompletionRecord and Assignment store.
			userId: string & strings.MinRunes(1)
			// userLogin is the Grafana login at the time of the write.
			userLogin?: string
			// userDisplayName is the display name at the time of the write.
			userDisplayName?: string
			// orgId is the Grafana organization the write originated from.
			orgId: int64
			// stackNamespace is the App Platform namespace the row was written into.
			stackNamespace: string & strings.MinRunes(1)
			// schemaVersion is the AchievementAward spec schema version (>= 1).
			// Separate from the CRD apiVersion so a schema mistake can be corrected
			// without an API-version bump.
			schemaVersion: int & >=1
		}
	}
}
