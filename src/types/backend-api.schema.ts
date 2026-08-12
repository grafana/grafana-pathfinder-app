/**
 * Zod schemas for the four App Platform backend response envelopes.
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

/** Any JSON value. Mirrors Go `json.RawMessage` / `interface{}` passthrough. */
export const JsonValueSchema = z.json();

// ============ /completion-records/capability ============

/**
 * `completionCapability` (pkg/plugin/completion_records.go).
 * @coupling Go struct: completionCapability
 */
export const CompletionCapabilityWireSchema = z.strictObject({
  available: z.boolean(),
  reason: z.string().optional(),
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
});

/**
 * `completions` is a required array, never nullable and never `.catch([])`:
 * the handler builds a non-nil slice unconditionally (`collateByUser` and
 * `handleMyCompletions` in completion_records.go) and
 * `TestMyCompletions_UnknownUserEmptyList` asserts it serializes as `[]`.
 * A `null` here is a Go bug that should fail loudly rather than be absorbed.
 *
 * @coupling Go struct: myCompletionsResponse
 */
export const MyCompletionsResponseWireSchema = z.strictObject({
  capability: CompletionCapabilityWireSchema,
  userId: z.string().optional(),
  completions: z.array(CollatedCompletionWireSchema),
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

/**
 * Two fields are deliberately wider here than in `CustomGuideManifest`
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
 *
 * @coupling Go struct: customGuideManifest
 */
export const CustomGuideManifestWireSchema = z.strictObject({
  type: z.string(),
  repository: z.string().optional(),
  description: z.string().optional(),
  milestones: z.array(z.string()).optional(),
  category: z.string().optional(),
  author: CustomGuideAuthorWireSchema.optional(),
  depends: z.array(JsonValueSchema).optional(),
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
  capability: CustomGuideCapabilityWireSchema,
  guides: z.array(CustomGuideRepositoryEntryWireSchema),
  asOf: z.string().optional(),
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
  baseUrl: z.string(),
  packages: z.array(PackageEntryWireSchema),
});

// ============ REGISTRY ============

/**
 * Every Go struct reachable from an in-scope response envelope, keyed exactly
 * as `pkg/plugin/testdata/contract/struct-tags.json` keys it. The contract test
 * requires this map and that golden to agree in both directions, so a new Go
 * struct — or a stale schema — fails.
 */
export const GO_STRUCT_SCHEMAS = {
  PackageRecommendationsResponse: PackageRecommendationsResponseWireSchema,
  PackageEntry: PackageEntryWireSchema,
  PackageTargeting: PackageTargetingWireSchema,
  customGuideRepositoryResponse: CustomGuideRepositoryResponseWireSchema,
  customGuideCapability: CustomGuideCapabilityWireSchema,
  customGuideRepositoryEntry: CustomGuideRepositoryEntryWireSchema,
  customGuideManifest: CustomGuideManifestWireSchema,
  'customGuideManifest.author': CustomGuideAuthorWireSchema,
  myCompletionsResponse: MyCompletionsResponseWireSchema,
  completionCapability: CompletionCapabilityWireSchema,
  collatedCompletion: CollatedCompletionWireSchema,
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
  'completion-records-my': 'myCompletionsResponse',
  'completion-records-capability': 'completionCapability',
} as const satisfies Record<string, GoStructName>;

export type BackendResponseEnvelopeKey = keyof typeof BACKEND_RESPONSE_ENVELOPES;

export type MyCompletionsResponseWire = z.infer<typeof MyCompletionsResponseWireSchema>;
export type CustomGuideRepositoryResponseWire = z.infer<typeof CustomGuideRepositoryResponseWireSchema>;
export type PackageRecommendationsResponseWire = z.infer<typeof PackageRecommendationsResponseWireSchema>;
export type CompletionCapabilityWire = z.infer<typeof CompletionCapabilityWireSchema>;
