// Code generated - EDITING IS FUTILE. DO NOT EDIT.

export interface Spec {
	// guideId is the guide identifier WITHIN its source (not globally unique on
	// its own; the durable guide identity is the pair (guideSource, guideId)).
	guideId: string;
	// guideSource is the provenance of the guide (= the resolving repository).
	// v1 values: "bundled" | "app-platform" | "remote-repo:<name>". The durable
	// guide identity is the pair (guideSource, guideId). Kept as a free-form
	// string so new sources need no schema bump. Distinct from `source` below:
	// guideSource is WHERE the guide came from, `source` is HOW it was completed.
	guideSource: string;
	// guideTitle is the denormalized guide title, snapshotted at write time so
	// dashboards remain readable years later even if the guide is renamed or
	// removed (RFC §6.10).
	guideTitle: string;
	// pathId is the learning path ID (empty string if none).
	pathId: string;
	// source is HOW the completion happened: "objectives" (earned by completing all
	// objectives), "manual" (marked complete by the user), or "skipped" (user used
	// the "skip remaining" affordance). Distinct from guideSource above, which is
	// WHERE the guide came from (RFC §7.1, §6.11).
	source: "objectives" | "manual" | "skipped";
	// completedAt is the ISO 8601 timestamp of WHEN THE USER COMPLETED the guide
	// (client-supplied; preserved unchanged across offline/queued retries).
	// OPTIONAL: absent while the guide is in progress. Set exactly once, when
	// completionPercent reaches 100, and never cleared afterwards.
	completedAt?: string;
	// durationSeconds is the time from first view to completion.
	durationSeconds: number;
	// completionPercent is the highest completion percentage (0-100) reached in
	// this attempt; 100 means the guide is complete. NOTE: the generator emits
	// this as uint64 in Go and drops the >=0 minimum from the CRD JSON; the <=100
	// upper bound is preserved. Accepted codegen quirk — do not fight the generator.
	completionPercent: number;
	// guideCategory is the category of the guide.
	// Valid values: "interactive", "documentation", "learning-journey".
	guideCategory: "interactive" | "documentation" | "learning-journey";
	// platform is the platform where the guide was completed.
	// Valid values: "oss", "cloud".
	platform: "oss" | "cloud";
	// userId is the stable, rename-safe user identifier the trusted writer derives
	// from the Grafana ID token. Logins are mutable, so this is the durable join
	// key for "everything this user did" (RFC §7.1).
	userId: string;
	// userLogin is the Grafana user login at the time of the write.
	userLogin: string;
	// userDisplayName is the denormalized display name, snapshotted at write time
	// so dashboards remain readable years later even after the user is renamed or
	// deleted (RFC §6.10).
	userDisplayName: string;
	// recordedAt is the ISO 8601 timestamp of WHEN THE LAST WRITE LANDED
	// (authoritative), re-stamped on every write. Distinct from completedAt: a
	// queued retry that lands hours later still reports the true completion time
	// in completedAt while recordedAt reflects when the record was last written
	// (RFC §7.1).
	recordedAt: string;
	// orgId is the Grafana organization identifier the write originated from,
	// making the per-record org context explicit rather than implicit (RFC §7.1).
	orgId: number;
	// stackNamespace is the App Platform namespace (per-stack scope) the record was
	// written into. The CRD is namespaced per-stack, but §7.1 requires that linkage
	// explicit on the record for future cross-stack analysis/export.
	stackNamespace: string;
	// schemaVersion is the CompletionRecord spec schema version (>= 1). Separate
	// from the CRD apiVersion so we can correct schema mistakes without an
	// API-version bump (RFC §7.1).
	schemaVersion: number;
}

export const defaultSpec = (): Spec => ({
	guideId: "",
	guideSource: "",
	guideTitle: "",
	pathId: "",
	source: "objectives",
	durationSeconds: 0,
	completionPercent: 0,
	guideCategory: "interactive",
	platform: "oss",
	userId: "",
	userLogin: "",
	userDisplayName: "",
	recordedAt: "",
	orgId: 0,
	stackNamespace: "",
	schemaVersion: 0,
});

