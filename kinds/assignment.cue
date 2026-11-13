package kinds

// assignmentKind is the kind metadata for Assignment, reusable across versions.
assignmentKind: {
	kind:       "Assignment"
	pluralName: "Assignments"
	scope:      "Namespaced"
	// folderScoped: false — this kind is not folder-based. This does not tighten
	// RBAC; it only drops folder access from the authz question, leaving
	// "access = has stack role" instead of "has stack role AND has folder access".
	folderScoped: false
	codegen: {
		ts: {
			enabled: true
		}
		go: {
			enabled: true
		}
	}
}

// assignmentv1alpha1 is the v1alpha1 version of the Assignment kind.
//
// A per-user obligation: the person named by userId must complete the
// assigned target. Sibling of CompletionRecord in the same App Platform
// group so obligation and fulfilment join on one subject vocabulary.
//
// The obligation lives in spec and is provisioner-authored. Users cannot
// create, alter, or withdraw one. The only permitted spec mutation is the
// monotonic lifecycle transition active → withdrawn.
//
// Every field is a flat scalar, never a nested object, so any of them can
// become a metadata.label for server-side selection.
//
// Enforcement note (manifest-only deploy posture, see PR #64): in production
// this kind is served by a shared generic apiserver directly from the generated
// CRD schema. The CUE schema below is therefore the ONLY enforcement surface
// that ships, so every invariant we can express is pushed into it: field
// presence, value domains (enums), and bounds.
assignmentv1alpha1: assignmentKind & {
	schema: {
		spec: {
			// ---------------------------------------------------------------
			// Subject and target. Required. The join key with CompletionRecord
			// is (userId, targetType, targetId, trackId?).
			// ---------------------------------------------------------------

			// userId is the assigned person, in the stack's canonical subject
			// vocabulary: the typed ID-token subject (such as "user:27"), the
			// same one CompletionRecord uses so obligation and fulfilment join
			// without an identity bridge. Logins are mutable; this is not.
			userId: string
			// targetType discriminates the namespace targetId lives in:
			// "github-visualize" can be both a path and a guide. Adding a
			// value later is an enum expansion, so existing rows stay valid.
			// Never default it — absent-means-path would collide with a mixed
			// population, and a single-value CUE constraint emits no enum.
			targetType: "path" | "guide"
			// targetId is the assigned thing within targetType's namespace.
			// For targetType "path" this is the learning path id.
			targetId: string
			// trackId qualifies a path target to a specific named track.
			// Absent means the whole path. Meaningless for a non-path
			// targetType; leave it absent.
			trackId?: string
			// targetSource is the provenance of targetId when that identity is
			// a pair, matching CompletionRecord's (guideSource, guideId).
			// Absent for paths, which have no source in that sense.
			targetSource?: string

			// ---------------------------------------------------------------
			// Provenance. ruleId is required so withdrawal can address every
			// record. assignedBy and ruleRevision are optional: a writer that
			// only has a rule slug can still create the obligation.
			// ---------------------------------------------------------------

			// ruleId is the authored assignment rule's stable slug, stamped into
			// every record. It is the addressing key for withdrawal.
			ruleId: string
			// ruleRevision is the specific rule revision that produced this
			// record, so an obligation is auditable back to a decision.
			// Free-form (a git SHA, a generation, a tag). Absent if the
			// writer has none.
			ruleRevision?: string
			// assignedBy is the assigning authority — which Learning Admin, or
			// the group acting as one. Free-form; no identifier format is
			// prescribed. Absent is allowed.
			assignedBy?: string
			// assignedAt is the ISO 8601 timestamp of when this obligation was
			// incurred. Written once, never modified.
			assignedAt: string

			// ---------------------------------------------------------------
			// Time bounds. Both optional; absent means no bound. Flat scalars,
			// not a nested interval, so each can become a metadata.label and
			// neither silently absorbs visibility or recommended-start.
			// ---------------------------------------------------------------

			// dueAt is when completions after this are late. Soft by definition:
			// an overdue obligation is displayed as overdue and never locked
			// out. Absent means no deadline.
			dueAt?: string
			// acceptCompletionsFrom is the earliest completion that counts
			// toward this obligation. Absent credits any prior completion.
			acceptCompletionsFrom?: string

			// ---------------------------------------------------------------
			// Lifecycle. In spec, not status, so a grant that lets a user
			// record satisfaction cannot also let them withdraw their own
			// obligation.
			// ---------------------------------------------------------------

			// lifecycle is "active" or "withdrawn" — the only part of an
			// obligation that ever changes. Records are never deleted.
			lifecycle: "active" | "withdrawn"
			// withdrawnAt is the ISO 8601 timestamp of the active → withdrawn
			// transition. Absent when lifecycle is active. A nested
			// {state, at} object would prevent either field becoming a
			// metadata.label.
			withdrawnAt?: string

			// schemaVersion is the Assignment spec schema version (>= 1).
			// Separate from the CRD apiVersion so a schema mistake can be
			// corrected without an API-version bump.
			schemaVersion: int & >=1
		}
		status: {
			// satisfied caches the evaluation of this obligation's criteria
			// against the subject's completions, for consumers that cannot
			// join against CompletionRecord. Absent means not yet evaluated,
			// which is distinct from false (evaluated and unmet).
			satisfied?: bool
		}
	}
}
