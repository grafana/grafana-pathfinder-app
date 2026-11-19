/**
 * Zod schemas for the App Platform backend response envelopes.
 *
 * These describe **wire truth** — what `pkg/plugin` actually emits — not what
 * the hand-written client interfaces wish it emitted. Where the two disagree,
 * these schemas follow Go and `src/validation/backend-api-contract.test.ts`
 * pins the disagreement (see `CustomGuideManifestWireSchema`).
 *
 * Nothing parses at runtime yet: the schemas exist so the committed goldens
 * under `pkg/plugin/testdata/contract/` are checked against a TypeScript
 * description of the same bytes, in CI, in a separate process from the Go
 * tests that produced them. Adopting them at the fetch sites
 * (parse-log-fall-back, per the decision on issue #1526) is a follow-up.
 *
 * @coupling API: pkg/plugin/contract_fixtures_test.go + pkg/plugin/testdata/contract/
 */

import { z } from 'zod';

import { GuideStatsSummarySchema } from './guide-stats.schema';

/** Any JSON value. Mirrors Go `json.RawMessage` / `interface{}` passthrough. */
export const JsonValueSchema = z.json();

export const GuideProxyDiagnosticWireSchema = z.strictObject({
  stage: z.string().optional(),
  resource: z.string().optional(),
  operation: z.string().optional(),
  outcome: z.enum(['ok', 'error', 'degraded']),
  reason: z.string().optional(),
  upstreamStatus: z.number().int().min(100).max(599).optional(),
  cache: z.enum(['hit', 'shared', 'refresh', 'stale']).optional(),
  cacheAgeMs: z.number().int().nonnegative(),
  manifestFailures: z.record(z.string(), z.number().int().nonnegative()).optional(),
  budgetExhausted: z.boolean().optional(),
});

// ============ /completion-records/capability ============

/**
 * `completionCapability` (pkg/plugin/completion_records.go).
 * @coupling Go struct: completionCapability
 */
export const CompletionCapabilityWireSchema = z.strictObject({
  diagnostics: GuideProxyDiagnosticWireSchema.optional(),
  available: z.boolean(),
  reason: z.string().optional(),
  /** Present (true) when this plugin build accepts attempt upserts. Absent on older builds. */
  progressRecords: z.boolean().optional(),
});

// ============ /completion-records/my ============

/** @coupling Go struct: collatedCompletion */
export const CollatedCompletionWireSchema = z.strictObject({
  guideSource: z.string(),
  guideId: z.string(),
  guideTitle: z.string(),
  guideCategory: z.string(),
  pathId: z.string(),
  count: z.number().int(),
  latestCompletedAt: z.string(),
  latestSource: z.string(),
  maxCompletionPercent: z.number().int(),
  latestDurationSeconds: z.number().int().optional(),
  lastRecordedAt: z.string().optional(),
  latestAttemptStartedAt: z.string().optional(),
});

/**
 * A guide whose most recent activity is an unfinished attempt.
 * @coupling Go struct: inProgressCompletion
 */
export const InProgressCompletionWireSchema = z.strictObject({
  guideSource: z.string(),
  guideId: z.string(),
  guideTitle: z.string(),
  guideCategory: z.string(),
  pathId: z.string(),
  completionPercent: z.number().int(),
  lastUpdatedAt: z.string(),
  attemptStartedAt: z.string().optional(),
});

/**
 * `completions` is a required array, never nullable and never `.catch([])`:
 * the handler builds a non-nil slice unconditionally (`writeMyCompletions` and
 * `handleMyCompletions` in completion_records.go) and
 * `TestMyCompletions_UnknownUserEmptyList` asserts it serializes as `[]`.
 * A `null` here is a Go bug that should fail loudly rather than be absorbed.
 *
 * @coupling Go struct: myCompletionsResponse
 */
export const MyCompletionsResponseWireSchema = z.strictObject({
  diagnostics: GuideProxyDiagnosticWireSchema.optional(),
  capability: CompletionCapabilityWireSchema,
  userId: z.string().optional(),
  completions: z.array(CollatedCompletionWireSchema),
  /** Always present, `[]` when empty, for the same reason as `completions`. */
  inProgress: z.array(InProgressCompletionWireSchema),
  asOf: z.string().optional(),
});

// ============ /api/v1/achievements ============

/**
 * `reason` is a free string: a new decision reason is an additive change within v1.
 * `awarded` is the tier ids this event newly awarded, `[]` when none.
 * @coupling Go struct: Decision (pkg/achievements/types.go)
 */
export const AchievementDecisionWireSchema = z.strictObject({
  achievementId: z.string(),
  decision: z.enum(['award', 'tier_up', 'increment', 'ignored']),
  reason: z.string().optional(),
  awarded: z.array(z.string()),
  final: z.boolean(),
  units: z.number().int(),
  next: z.number().int().nullable(),
});

/**
 * `decisions` is always an array, `[]` when no achievement matched the event.
 * @coupling Go struct: achievementEventsResponse
 */
export const AchievementEventsResponseWireSchema = z.strictObject({
  eventId: z.string(),
  retry: z.boolean(),
  decisions: z.array(AchievementDecisionWireSchema),
});

/** @coupling Go struct: achievementCapability */
export const AchievementCapabilityWireSchema = z.strictObject({
  available: z.boolean(),
  reason: z.string().optional(),
});

/** @coupling Go struct: achievementAward */
export const AchievementAwardWireSchema = z.strictObject({
  achievementId: z.string(),
  tierId: z.string(),
  entity: z.string(),
  earnedAt: z.string(),
});

/** @coupling Go struct: achievementProgress */
export const AchievementProgressWireSchema = z.strictObject({
  achievementId: z.string(),
  units: z.number().int(),
  next: z.number().int().nullable(),
});

/** @coupling Go struct: legacyBadge */
export const LegacyBadgeWireSchema = z.strictObject({
  source: z.string(),
  name: z.string(),
  acquiredAt: z.string().optional(),
});

/**
 * All three arrays are required, never nullable: the handler builds non-nil
 * slices unconditionally, including in the unavailable answer.
 *
 * @coupling Go struct: myAchievementsResponse
 */
export const MyAchievementsResponseWireSchema = z.strictObject({
  asOf: z.string().optional(),
  definitionsVersion: z.string().optional(),
  capability: AchievementCapabilityWireSchema,
  truncated: z.boolean(),
  awards: z.array(AchievementAwardWireSchema),
  progress: z.array(AchievementProgressWireSchema),
  legacy: z.array(LegacyBadgeWireSchema),
});

/** @coupling Go struct: DisplayTier (pkg/achievements/bundle.go) */
export const AchievementDisplayTierWireSchema = z.strictObject({
  id: z.string(),
  at: z.number().int().optional(),
  art: z.string().optional(),
});

/**
 * `earnable` is false for a published definition this build cannot evaluate;
 * it is still listed so awards already earned keep their names.
 * @coupling Go struct: Display (pkg/achievements/bundle.go)
 */
export const AchievementDisplayWireSchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  tiers: z.array(AchievementDisplayTierWireSchema),
  earnable: z.boolean(),
});

/**
 * A tier's image is `artBase + art + '.svg'`.
 * @coupling Go struct: achievementDefinitionsResponse
 */
export const AchievementDefinitionsResponseWireSchema = z.strictObject({
  version: z.string(),
  artBase: z.string(),
  achievements: z.array(AchievementDisplayWireSchema),
});

// ============ /assignments/my ============

/**
 * `assignmentCapability` (pkg/plugin/assignments.go).
 * @coupling Go struct: assignmentCapability
 */
export const AssignmentCapabilityWireSchema = z.strictObject({
  available: z.boolean(),
  reason: z.string().optional(),
});

/**
 * One guide within an assignment's target, on the wire — the per-guide
 * detail behind `satisfied`.
 * @coupling Go struct: assignmentGuideEntry
 */
export const AssignmentGuideEntryWireSchema = z.strictObject({
  guideId: z.string(),
  guideSource: z.string(),
  completed: z.boolean(),
});

/**
 * One assigned obligation.
 * @coupling Go struct: assignmentEntry
 */
export const AssignmentEntryWireSchema = z.strictObject({
  targetType: z.string(),
  targetId: z.string(),
  trackId: z.string().optional(),
  targetSource: z.string().optional(),
  ruleId: z.string().optional(),
  assignedBy: z.string().optional(),
  assignedAt: z.string().optional(),
  dueAt: z.string().optional(),
  acceptCompletionsFrom: z.string().optional(),
  satisfied: z.boolean(),
  guides: z.array(AssignmentGuideEntryWireSchema).optional(),
  lifecycle: z.string(),
});

/**
 * `assignments` is a required array, never nullable and never `.catch([])`,
 * for the same reason as `completions`: `shapeAssignments`.
 * An empty array means the caller genuinely has no
 * obligations, which is a different statement from `capability.available`
 * being false — a `null` here is a Go bug that should fail loudly.
 *
 * @coupling Go struct: myAssignmentsResponse
 */
export const MyAssignmentsResponseWireSchema = z.strictObject({
  capability: AssignmentCapabilityWireSchema,
  userId: z.string().optional(),
  assignments: z.array(AssignmentEntryWireSchema),
  asOf: z.string().optional(),
});

// ============ /custom-guide-repository ============

/** @coupling Go struct: customGuideCapability */
export const CustomGuideCapabilityWireSchema = z.strictObject({
  available: z.boolean(),
  reason: z.string().optional(),
});

/** @coupling Go struct: customGuideManifest.author */
export const CustomGuideAuthorWireSchema = z.strictObject({
  name: z.string().optional(),
  team: z.string().optional(),
});

/** @coupling Go struct: customGuideManifest.tracks */
export const CustomGuideTrackWireSchema = z.strictObject({
  trackId: z.string(),
  label: z.string(),
  guides: z.array(z.string()),
});

/**
 * The stamped block statistics — the completion denominator. `version` is the
 * version of the counting rules that produced the counts, not a content
 * version.
 *
 * Derived from the canonical `GuideStatsSummarySchema` rather than restated, so
 * the wire cannot admit a stamp the producer would reject — in particular the
 * non-negative invariant every member carries. `strictObject` adds only the
 * closed-shape rule the rest of this module's wire schemas apply.
 *
 * @coupling Go struct: customGuideStats
 */
export const CustomGuideStatsWireSchema = z.strictObject(GuideStatsSummarySchema.shape);

/**
 * Three fields are deliberately wider here than in `CustomGuideManifest`
 * (src/lib/custom-guide-repository-client.ts), because Go emits more than that
 * interface admits:
 *
 * - `type` is `string`, not `PackageType`. Go declares
 *   `Type string \`json:"type"\`` with no `omitempty`, so a manifest with no
 *   type emits `"type": ""` — not a member of `'guide' | 'path' | 'journey'`.
 *   The client narrows it at the boundary, mapping anything else to `undefined`.
 * - `depends` is an array of arbitrary JSON. Go declares
 *   `Depends []json.RawMessage`, which forwards whatever the CR holds; the
 *   client declares no `depends` field, so nothing reads it as a typed
 *   `DependencyList`.
 * - `stats` is on the wire but off the interface. Nothing populates it yet: the
 *   CRD's `#Manifest` declares no `stats` and prunes a top-level write silently,
 *   so both App Platform writers stamp `additionalFields.stats` instead, which
 *   this proxy does not carry. Once the platform CUE field lands, the counts
 *   will reach the browser untyped — the client declares no `stats` field for a
 *   reader to use.
 *
 * @coupling Go struct: customGuideManifest
 */
export const CustomGuideManifestWireSchema = z.strictObject({
  type: z.string(),
  repository: z.string().optional(),
  description: z.string().optional(),
  milestones: z.array(z.string()).optional(),
  tracks: z.array(CustomGuideTrackWireSchema).optional(),
  category: z.string().optional(),
  author: CustomGuideAuthorWireSchema.optional(),
  depends: z.array(JsonValueSchema).optional(),
  stats: CustomGuideStatsWireSchema.optional(),
});

/** @coupling Go struct: customGuideRepositoryEntry */
export const CustomGuideRepositoryEntryWireSchema = z.strictObject({
  id: z.string(),
  title: z.string().optional(),
  status: z.string().optional(),
  manifest: CustomGuideManifestWireSchema.optional(),
});

/**
 * `guides` is a required array for the same reason as `completions`:
 * `custom_guide_repository_test.go:156` asserts `[]` not `null`.
 *
 * @coupling Go struct: customGuideRepositoryResponse
 */
export const CustomGuideRepositoryResponseWireSchema = z.strictObject({
  diagnostics: GuideProxyDiagnosticWireSchema.optional(),
  capability: CustomGuideCapabilityWireSchema,
  guides: z.array(CustomGuideRepositoryEntryWireSchema),
  asOf: z.string().optional(),
});

// Full resources stay arbitrary JSON so unknown metadata and spec fields survive.
export const CustomGuidesResponseWireSchema = z.strictObject({
  items: z.array(JsonValueSchema),
});

// ============ /package-recommendations ============

/**
 * `match` stays untyped on purpose: Go keeps it as `json.RawMessage` so
 * unrecognized predicate keys survive to the frontend's fail-closed matcher.
 *
 * @coupling Go struct: PackageTargeting
 */
export const PackageTargetingWireSchema = z.strictObject({
  match: JsonValueSchema,
});

/** @coupling Go struct: PackageEntry */
export const PackageEntryWireSchema = z.strictObject({
  id: z.string(),
  path: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  type: z.string().optional(),
  targeting: PackageTargetingWireSchema.optional(),
  manifest: z.record(z.string(), JsonValueSchema).optional(),
});

/** @coupling Go struct: PackageRecommendationsResponse */
export const PackageRecommendationsResponseWireSchema = z.strictObject({
  diagnostics: GuideProxyDiagnosticWireSchema.optional(),
  baseUrl: z.string(),
  packages: z.array(PackageEntryWireSchema),
});

export const LearningInsightsPersonWireSchema = z.strictObject({
  userId: z.string(),
  userLogin: z.string(),
  userDisplayName: z.string(),
});

export const LearningInsightsCompletionWireSchema = z.strictObject({
  userId: z.string(),
  guideId: z.string(),
  guideSource: z.string(),
  guideTitle: z.string(),
  completedAt: z.string(),
  source: z.string(),
});

export const LearningInsightsAssignmentWireSchema = z.strictObject({
  name: z.string(),
  userId: z.string(),
  targetType: z.string(),
  targetId: z.string(),
  targetSource: z.string(),
  trackId: z.string(),
  ruleId: z.string(),
  assignedAt: z.string(),
  dueAt: z.string(),
  status: z.enum(['complete', 'outstanding', 'overdue', 'unknown', 'withdrawn']),
  reason: z.string(),
  guides: z.array(AssignmentGuideEntryWireSchema),
});

export const LearningInsightsResponseWireSchema = z.strictObject({
  asOf: z.string(),
  from: z.string(),
  to: z.string(),
  capability: AssignmentCapabilityWireSchema,
  completeness: z.enum(['complete', 'partial']),
  warnings: z.array(z.string()),
  people: z.array(LearningInsightsPersonWireSchema),
  completions: z.array(LearningInsightsCompletionWireSchema),
  assignments: z.array(LearningInsightsAssignmentWireSchema),
});

// ============ REGISTRY ============

/**
 * Every Go struct reachable from an in-scope response envelope, keyed exactly
 * as `pkg/plugin/testdata/contract/struct-tags.json` keys it. The contract test
 * requires this map and that golden to agree in both directions, so a new Go
 * struct — or a stale schema — fails.
 */
export const GO_STRUCT_SCHEMAS = {
  guideProxyDiagnostic: GuideProxyDiagnosticWireSchema,
  PackageRecommendationsResponse: PackageRecommendationsResponseWireSchema,
  PackageEntry: PackageEntryWireSchema,
  PackageTargeting: PackageTargetingWireSchema,
  customGuideRepositoryResponse: CustomGuideRepositoryResponseWireSchema,
  customGuidesResponse: CustomGuidesResponseWireSchema,
  customGuideCapability: CustomGuideCapabilityWireSchema,
  customGuideRepositoryEntry: CustomGuideRepositoryEntryWireSchema,
  customGuideManifest: CustomGuideManifestWireSchema,
  customGuideStats: CustomGuideStatsWireSchema,
  'customGuideManifest.author': CustomGuideAuthorWireSchema,
  'customGuideManifest.tracks': CustomGuideTrackWireSchema,
  myCompletionsResponse: MyCompletionsResponseWireSchema,
  completionCapability: CompletionCapabilityWireSchema,
  collatedCompletion: CollatedCompletionWireSchema,
  inProgressCompletion: InProgressCompletionWireSchema,
  myAssignmentsResponse: MyAssignmentsResponseWireSchema,
  assignmentCapability: AssignmentCapabilityWireSchema,
  assignmentEntry: AssignmentEntryWireSchema,
  assignmentGuideEntry: AssignmentGuideEntryWireSchema,
  learningInsightsResponse: LearningInsightsResponseWireSchema,
  learningInsightsPerson: LearningInsightsPersonWireSchema,
  learningInsightsCompletion: LearningInsightsCompletionWireSchema,
  learningInsightsAssignment: LearningInsightsAssignmentWireSchema,
  achievementEventsResponse: AchievementEventsResponseWireSchema,
  Decision: AchievementDecisionWireSchema,
  myAchievementsResponse: MyAchievementsResponseWireSchema,
  achievementCapability: AchievementCapabilityWireSchema,
  achievementAward: AchievementAwardWireSchema,
  achievementProgress: AchievementProgressWireSchema,
  legacyBadge: LegacyBadgeWireSchema,
  achievementDefinitionsResponse: AchievementDefinitionsResponseWireSchema,
  Display: AchievementDisplayWireSchema,
  DisplayTier: AchievementDisplayTierWireSchema,
} as const;

export type GoStructName = keyof typeof GO_STRUCT_SCHEMAS;

/**
 * Golden-filename prefix → the Go struct that route's envelope is. Value
 * goldens are named `<prefix>.<variant>.json`, so the contract test derives the
 * schema for a fixture from its own filename rather than from a list of
 * fixtures someone has to remember to extend.
 */
export const BACKEND_RESPONSE_ENVELOPES = {
  'package-recommendations': 'PackageRecommendationsResponse',
  'custom-guide-repository': 'customGuideRepositoryResponse',
  'custom-guides': 'customGuidesResponse',
  'completion-records-my': 'myCompletionsResponse',
  'completion-records-capability': 'completionCapability',
  'assignments-my': 'myAssignmentsResponse',
  'learning-insights': 'learningInsightsResponse',
  'achievements-events': 'achievementEventsResponse',
  'achievements-my': 'myAchievementsResponse',
  'achievements-definitions': 'achievementDefinitionsResponse',
} as const satisfies Record<string, GoStructName>;

export type BackendResponseEnvelopeKey = keyof typeof BACKEND_RESPONSE_ENVELOPES;

export type MyCompletionsResponseWire = z.infer<typeof MyCompletionsResponseWireSchema>;
export type MyAssignmentsResponseWire = z.infer<typeof MyAssignmentsResponseWireSchema>;
export type AssignmentEntryWire = z.infer<typeof AssignmentEntryWireSchema>;
export type CustomGuideRepositoryResponseWire = z.infer<typeof CustomGuideRepositoryResponseWireSchema>;
export type PackageRecommendationsResponseWire = z.infer<typeof PackageRecommendationsResponseWireSchema>;
export type AchievementEventsResponseWire = z.infer<typeof AchievementEventsResponseWireSchema>;
export type MyAchievementsResponseWire = z.infer<typeof MyAchievementsResponseWireSchema>;
export type AchievementDefinitionsResponseWire = z.infer<typeof AchievementDefinitionsResponseWireSchema>;
export type CompletionCapabilityWire = z.infer<typeof CompletionCapabilityWireSchema>;
