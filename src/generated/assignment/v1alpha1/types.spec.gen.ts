// Code generated - EDITING IS FUTILE. DO NOT EDIT.

export interface Spec {
	// userId is the assigned person, in the stack's canonical subject
	// vocabulary: the typed ID-token subject (such as "user:27"), the
	// same one CompletionRecord uses so obligation and fulfilment join
	// without an identity bridge. Logins are mutable; this is not.
	userId: string;
	// targetType discriminates the namespace targetId lives in:
	// "github-visualize" can be both a path and a guide. Adding a
	// value later is an enum expansion, so existing rows stay valid.
	// Never default it — absent-means-path would collide with a mixed
	// population, and a single-value CUE constraint emits no enum.
	targetType: "path" | "guide";
	// targetId is the assigned thing within targetType's namespace.
	// For targetType "path" this is the learning path id.
	targetId: string;
	// trackId qualifies a path target to a specific named track.
	// Absent means the whole path. Meaningless for a non-path
	// targetType; leave it absent.
	trackId?: string;
	// targetSource is the provenance of targetId when that identity is
	// a pair, matching CompletionRecord's (guideSource, guideId).
	// Absent for paths, which have no source in that sense.
	targetSource?: string;
	// ruleId is the authored assignment rule's stable slug, stamped into
	// every record. It is the addressing key for withdrawal.
	ruleId: string;
	// ruleRevision is the specific rule revision that produced this
	// record, so an obligation is auditable back to a decision.
	// Free-form (a git SHA, a generation, a tag). Absent if the
	// writer has none.
	ruleRevision?: string;
	// assignedBy is the assigning authority — which Learning Admin, or
	// the group acting as one. Free-form; no identifier format is
	// prescribed. Absent is allowed.
	assignedBy?: string;
	// assignedAt is the ISO 8601 timestamp of when this obligation was
	// incurred. Written once, never modified.
	assignedAt: string;
	// dueAt is when completions after this are late. Soft by definition:
	// an overdue obligation is displayed as overdue and never locked
	// out. Absent means no deadline.
	dueAt?: string;
	// acceptCompletionsFrom is the earliest completion that counts
	// toward this obligation. Absent credits any prior completion.
	acceptCompletionsFrom?: string;
	// lifecycle is "active" or "withdrawn" — the only part of an
	// obligation that ever changes. Records are never deleted.
	lifecycle: "active" | "withdrawn";
	// withdrawnAt is the ISO 8601 timestamp of the active → withdrawn
	// transition. Absent when lifecycle is active. A nested
	// {state, at} object would prevent either field becoming a
	// metadata.label.
	withdrawnAt?: string;
	// schemaVersion is the Assignment spec schema version (>= 1).
	// Separate from the CRD apiVersion so a schema mistake can be
	// corrected without an API-version bump.
	schemaVersion: number;
}

export const defaultSpec = (): Spec => ({
	userId: "",
	targetType: "path",
	targetId: "",
	ruleId: "",
	assignedAt: "",
	lifecycle: "active",
	schemaVersion: 0,
});

