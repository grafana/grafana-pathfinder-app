/**
 * Zod Schemas for Package Types
 *
 * Runtime validation schemas for the two-file package model.
 * Type coupling is verified by tests in src/validation/.
 *
 * @coupling Types: package.types.ts - schemas must stay in sync
 */

import { z } from 'zod';

import { JsonBlockSchema, CURRENT_SCHEMA_VERSION } from './json-guide.schema';
import type {
  Author,
  DependencyClause,
  DependencyGraph,
  DependencyList,
  GraphEdge,
  GraphEdgeType,
  GraphNode,
  GuideTargeting,
  PackageType,
  RepositoryEntry,
  RepositoryJson,
  TestEnvironment,
} from './package.types';

// ============ CONTENT SCHEMA (content.json) ============

/**
 * Schema for content.json — the block editor's output.
 * Structurally identical to the existing JsonGuideSchemaStrict.
 * @coupling Type: ContentJson
 */
export const ContentJsonSchema = z.object({
  schemaVersion: z.string().optional(),
  id: z.string().min(1, 'Content id is required'),
  title: z.string().min(1, 'Content title is required'),
  blocks: z.array(JsonBlockSchema),
});

// ============ DEPENDENCY SCHEMAS ============

/**
 * A single dependency clause: bare package ID or OR-group of alternatives.
 * @coupling Type: DependencyClause
 */
export const DependencyClauseSchema = z.union([
  z.string().min(1),
  z.array(z.string().min(1)).min(1),
]) satisfies z.ZodType<DependencyClause>;

/**
 * A list of dependency clauses combined with AND (CNF).
 * @coupling Type: DependencyList
 */
export const DependencyListSchema = z.array(DependencyClauseSchema) satisfies z.ZodType<DependencyList>;

// ============ AUTHOR SCHEMA ============

/**
 * @coupling Type: Author
 */
export const AuthorSchema = z.object({
  name: z.string().optional(),
  team: z.string().optional(),
}) satisfies z.ZodType<Author>;

// ============ TARGETING SCHEMA ============

/**
 * Advisory recommendation targeting.
 * The match field is loosely typed — the recommender owns the semantics.
 * @coupling Type: GuideTargeting
 */
export const GuideTargetingSchema = z.object({
  match: z.record(z.string(), z.unknown()).optional(),
}) satisfies z.ZodType<GuideTargeting>;

// ============ TEST ENVIRONMENT SCHEMA ============

/**
 * Test environment metadata for Layer 4 E2E routing.
 *
 * `instance` names the host-part only of a Grafana instance where the guide
 * should be tested (e.g. `play.grafana.org`). When omitted, any instance
 * conforming to the declared tier may be used.
 *
 * @coupling Type: TestEnvironment
 */
export const TestEnvironmentSchema = z.object({
  tier: z.string().optional(),
  minVersion: z.string().optional(),
  datasets: z.array(z.string()).optional(),
  datasources: z.array(z.string()).optional(),
  plugins: z.array(z.string()).optional(),
  instance: z.string().optional(),
}) satisfies z.ZodType<TestEnvironment>;

const DEFAULT_TEST_ENVIRONMENT = { tier: 'cloud' } as const;

// ============ PACKAGE TYPE ============

export const PackageTypeSchema = z.enum(['guide', 'path', 'journey']) satisfies z.ZodType<PackageType>;

// ============ MANIFEST SCHEMA (manifest.json) ============

/**
 * Manifest object schema without the refinement, for composing
 * with passthrough or other transformations.
 */
export const ManifestJsonObjectSchema = z.object({
  schemaVersion: z.string().default(CURRENT_SCHEMA_VERSION),
  id: z.string().min(1, 'Manifest id is required'),
  type: PackageTypeSchema,
  repository: z.string().default('interactive-tutorials'),

  milestones: z.array(z.string().min(1)).optional(),

  description: z.string().optional(),
  language: z.string().default('en'),
  category: z.string().optional(),
  author: AuthorSchema.optional(),
  startingLocation: z.string().default('/'),

  depends: DependencyListSchema.default([]),
  recommends: DependencyListSchema.default([]),
  suggests: DependencyListSchema.default([]),
  provides: z.array(z.string().min(1)).default([]),
  conflicts: z.array(z.string().min(1)).default([]),
  replaces: z.array(z.string().min(1)).default([]),

  targeting: GuideTargetingSchema.optional(),
  testEnvironment: TestEnvironmentSchema.default(DEFAULT_TEST_ENVIRONMENT),
});

/**
 * Schema for manifest.json — metadata, dependencies, targeting.
 * Uses .default() chaining to apply defaults during parsing.
 *
 * Field severity for CLI validation:
 * - ERROR: id, type (hard requirements)
 * - WARN: description, category, targeting, startingLocation (missing but recommended)
 * - INFO: repository, language, schemaVersion, dependency fields, author, testEnvironment (defaults applied)
 * - Conditional ERROR: milestones required when type is "path" or "journey" (Rule 1)
 * - Conditional ERROR: milestones only valid when type is "path" or "journey" (Rule 2)
 *
 * @coupling Type: ManifestJson
 */
export const ManifestJsonSchema = ManifestJsonObjectSchema.superRefine((manifest, ctx) => {
  const isMetapackage = manifest.type === 'path' || manifest.type === 'journey';
  const hasMilestones = manifest.milestones !== undefined && manifest.milestones.length > 0;

  // Rule 1: path/journey requires milestones
  if (isMetapackage && !hasMilestones) {
    ctx.addIssue({
      code: 'custom',
      message: `"milestones" must be a non-empty array when type is "${manifest.type}" — ${manifest.type}s require an ordered sequence of packages`,
      path: ['milestones'],
    });
  }

  // Rule 2: milestones requires path/journey type
  if (hasMilestones && !isMetapackage) {
    ctx.addIssue({
      code: 'custom',
      message: `"milestones" is only valid when type is "path" or "journey", but type is "${manifest.type}" — either change type to "path" or "journey", or remove the milestones array`,
      path: ['type'],
    });
  }
});

// ============ SHARED METADATA SCHEMA FIELDS ============

/**
 * Shared fields for RepositoryEntrySchema and GraphNodeSchema.
 * @coupling Type: PackageMetadataFields
 */
const packageMetadataSchemaFields = {
  type: PackageTypeSchema,
  title: z.string().optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  author: AuthorSchema.optional(),
  startingLocation: z.string().optional(),
  milestones: z.array(z.string()).optional(),
  depends: DependencyListSchema.optional(),
  recommends: DependencyListSchema.optional(),
  suggests: DependencyListSchema.optional(),
  provides: z.array(z.string()).optional(),
  conflicts: z.array(z.string()).optional(),
  replaces: z.array(z.string()).optional(),
};

// ============ REPOSITORY INDEX SCHEMA ============

/**
 * Schema for a single repository.json entry.
 * @coupling Type: RepositoryEntry
 */
export const RepositoryEntrySchema = z.object({
  path: z.string().min(1),
  ...packageMetadataSchemaFields,
  targeting: GuideTargetingSchema.optional(),
  testEnvironment: TestEnvironmentSchema.optional(),
}) satisfies z.ZodType<RepositoryEntry>;

/**
 * Schema for repository.json — maps bare package IDs to entry metadata.
 * @coupling Type: RepositoryJson
 */
export const RepositoryJsonSchema = z.record(z.string(), RepositoryEntrySchema) satisfies z.ZodType<RepositoryJson>;

// ============ GRAPH SCHEMAS ============

export const GraphEdgeTypeSchema = z.enum([
  'depends',
  'recommends',
  'suggests',
  'provides',
  'conflicts',
  'replaces',
  'milestones',
]) satisfies z.ZodType<GraphEdgeType>;

/**
 * @coupling Type: GraphNode
 */
export const GraphNodeSchema = z.object({
  id: z.string().min(1),
  repository: z.string(),
  ...packageMetadataSchemaFields,
  virtual: z.boolean().optional(),
}) satisfies z.ZodType<GraphNode>;

/**
 * @coupling Type: GraphEdge
 */
export const GraphEdgeSchema = z.object({
  source: z.string().min(1),
  target: z.string().min(1),
  type: GraphEdgeTypeSchema,
}) satisfies z.ZodType<GraphEdge>;

/**
 * @coupling Type: DependencyGraph
 */
export const DependencyGraphSchema = z.object({
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
  metadata: z.object({
    generatedAt: z.string(),
    repositories: z.array(z.string()),
    nodeCount: z.number(),
    edgeCount: z.number(),
  }),
}) satisfies z.ZodType<DependencyGraph>;
