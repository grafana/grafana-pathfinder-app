package kinds

import (
	"list"
	"strings"
	"time"
)

// achievementProgressKind is the kind metadata for AchievementProgress, reusable across versions.
achievementProgressKind: {
	kind:       "AchievementProgress"
	pluralName: "AchievementProgresses"
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

// achievementprogressv1alpha1 is the v1alpha1 version of the AchievementProgress kind.
//
// One mutable record per (user, achievement), the counter that multi-tier
// achievements need because events carry no server state to re-derive a count
// from. The writer names each object hash(userId ‖ 0x00 ‖ achievementId) and
// updates it in place at a resourceVersion (compare-and-swap).
//
// The schema constrains progress fields. The SDK achievement handler
// establishes caller identity before updating progress.
achievementprogressv1alpha1: achievementProgressKind & {
	schema: {
		spec: {
			// ---------------------------------------------------------------
			// Client-derived fields (required).
			// ---------------------------------------------------------------

			// achievementId is the catalog achievement's stable id.
			achievementId: string & strings.MinRunes(1) & strings.MaxRunes(128)
			// tierIds is the set of catalog tier ids held, each a lowercase slug of
			// at most 64 characters. The writer keeps it distinct; the CRD cannot
			// enforce that (Kubernetes forbids uniqueItems, and this codegen emits
			// neither x-kubernetes-list-type nor CEL rules).
			tierIds: list.MaxItems(10) & [...string & =~"^[a-z][a-z0-9-]*$" & strings.MaxRunes(64)]
			// units is the grow-only set of distinct units counted (a dashboard uid,
			// a guide, an event id). The writer keeps it sorted and distinct; the CRD
			// cannot express either, so neither is enforced here. The cap is the
			// 1,040-byte unit-key limit, but maxLength counts characters, so it
			// admits every unit within that byte limit and some longer in bytes.
			units: list.MaxItems(200) & [...string & strings.MaxRunes(520)]
			// eventIds is the set of ids of the events counted: one per units entry,
			// and at most one per held tier, for an event that earned the tier
			// after another event had counted its unit. A posted event whose id is
			// listed counts nothing more. Event ids are 1 to 64 bytes, so 64
			// characters admits every one. The writer keeps the set sorted and
			// distinct. Rows stored before this field existed have none.
			eventIds?: list.MaxItems(210) & [...string & strings.MinRunes(1) & strings.MaxRunes(64)]
			// points is earned toward the lowest catalog tier tierIds does not hold.
			// It resets to 0 when that tier is earned, so it stays below the tier's
			// goal, which is at most 200.
			points: int & >=0 & <=199 | *0

			// ---------------------------------------------------------------
			// Writer-stamped fields (required).
			// ---------------------------------------------------------------

			// updatedAt is the RFC 3339 UTC timestamp of the last write.
			updatedAt: string & time.Time & =~"Z$"
			// userId is the verified ID-token subject (such as "user:27"), the same
			// value CompletionRecord and Assignment store.
			userId: string & strings.MinRunes(1)
			// orgId is the Grafana organization the write originated from.
			orgId: int64
			// stackNamespace is the App Platform namespace the record was written into.
			stackNamespace: string & strings.MinRunes(1)
			// schemaVersion is the AchievementProgress spec schema version (>= 1).
			// Separate from the CRD apiVersion so a schema mistake can be corrected
			// without an API-version bump.
			schemaVersion: int & >=1
		}
	}
}
