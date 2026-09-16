/**
 * Package Type Definitions
 *
 * Types for the two-file package model: content.json + manifest.json.
 * Packages are directories containing at minimum content.json, with
 * optional manifest.json for metadata, dependencies, and targeting.
 *
 * @coupling Zod schemas: package.schema.ts - schemas must stay in sync
 */

import type { GuideStatsSummary } from './guide-stats.schema';
import type { JsonBlock } from './json-guide.types';

// ============ CONTENT (content.json) ============

/**
 * Content file schema — what the block editor produces.
 * Contains only the fields needed to render the guide.
 * @coupling Zod schema: ContentJsonSchema in package.schema.ts
 */
export interface ContentJson {
  schemaVersion?: string;
  id: string;
  title: string;
  blocks: JsonBlock[];
}

// ============ DEPENDENCY TYPES ============

/**
 * A dependency clause: either a single bare package ID (string)
 * or an OR-group of alternative package IDs (string[]).
 * Follows Debian's dependency syntax in JSON form.
 */
export type DependencyClause = string | string[];

/**
 * A list of dependency clauses combined with AND (CNF).
 * Each clause is a bare string (single reference) or an
 * array of strings (OR-group of alternatives).
 *
 * Debian mapping: comma = AND, pipe = OR.
 * - `["A", "B"]`             → A AND B
 * - `[["A", "B"]]`           → A OR B
 * - `[["A", "B"], "C"]`      → (A OR B) AND C
 */
export type DependencyList = DependencyClause[];

// ============ AUTHOR ============

/**
 * Content author or owning team.
 */
export interface Author {
  name?: string;
  team?: string;
}

// ============ TARGETING ============

/**
 * Advisory recommendation targeting.
 * The `match` field follows the recommender's MatchExpr grammar.
 * We define this loosely — the recommender owns the match semantics.
 */
export interface GuideTargeting {
  match?: Record<string, unknown>;
}

// ============ TEST ENVIRONMENT ============

/**
 * Test environment metadata for Layer 4 E2E routing.
 * Declares what infrastructure a guide needs for testing.
 */
export interface TestEnvironment {
  tier?: string;
  minVersion?: string;
  datasets?: string[];
  datasources?: string[];
  plugins?: string[];
  /**
   * Host-only name of a specific Grafana instance where this guide should be
   * tested (e.g. `play.grafana.org` or `myslug.grafana.net`).
   * Must not include a protocol or path — just the hostname.
   * When omitted, any instance that conforms to the declared tier may be used.
   */
  instance?: string;
}

// ============ PACKAGE TYPE ============

/** Valid package type values */
export type PackageType = 'guide' | 'path' | 'journey';

/** Rendering types that a package can map to */
export type PackageRenderType = 'interactive' | 'learning-journey';

/**
 * Map a package manifest's `type` to the appropriate rendering type.
 *
 * Accepts the loosely-typed `Record<string, unknown>` shape that flows through
 * `Recommendation.manifest` (not the fully-typed `ManifestJson`) so callers
 * don't need to narrow first.
 *
 * - `path` / `journey` → `'learning-journey'` (milestone-based content)
 * - `guide` / missing / other → `'interactive'` (single interactive guide)
 */
export function getPackageRenderType(manifest?: Record<string, unknown>): PackageRenderType {
  if (manifest && typeof manifest.type === 'string') {
    if (manifest.type === 'path' || manifest.type === 'journey') {
      return 'learning-journey';
    }
  }
  return 'interactive';
}

// ============ TRACKS ============

/**
 * One named, independently-ordered guide sequence within a path/journey's
 * `tracks` list (Path Tracks RFC). Unlike `milestones`, a track's `guides`
 * list is its own complete ordering — not a subset or reordering of
 * `milestones` — so a track may include guides `milestones` never had, omit
 * ones it has, and interleave role-specific content anywhere in the sequence.
 * @coupling Zod schema: ManifestTrackSchema in package.schema.ts
 */
export interface ManifestTrack {
  trackId: string;
  label: string;
  guides: string[];
}

/**
 * Reserved `trackId` sentinel meaning "the default milestones sequence is
 * active" — the cover page's Foundations tab. An author-supplied track must
 * not collide with it, since the cover page distinguishes "Foundations
 * active" from "a named track is active" by comparing against this value.
 * @coupling Schema: ManifestJsonSchema Rule 4 in package.schema.ts
 * @coupling UI: LearningPathTableOfContents.tsx's Foundations tab id
 */
export const FOUNDATIONS_TRACK_ID = 'foundations';

/**
 * Safely reads a manifest-shaped value's `tracks` array, tolerating an
 * untyped/untrusted source (a raw JSON manifest, a network payload) the same
 * way `milestones` readers already do ad hoc. The one place every tracks
 * consumer should read through, so a malformed entry is dropped consistently
 * instead of each call site inventing its own guard.
 */
export function getManifestTracks(source?: { tracks?: unknown } | null): ManifestTrack[] {
  if (!source || !Array.isArray(source.tracks)) {
    return [];
  }
  return source.tracks.filter(isManifestTrack);
}

function isManifestTrack(value: unknown): value is ManifestTrack {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.trackId === 'string' &&
    typeof candidate.label === 'string' &&
    Array.isArray(candidate.guides) &&
    candidate.guides.every((guide) => typeof guide === 'string')
  );
}

/** Flattens every guide ID referenced by any track, in declared order. */
export function getAllTrackGuideIds(tracks: ManifestTrack[]): string[] {
  return tracks.flatMap((track) => track.guides);
}

/**
 * The full member set of a path/journey — `milestones` plus every guide
 * referenced by any `tracks` entry, deduplicated. For traversal concerns
 * (graph reachability, E2E chain expansion, orphan detection) where a guide
 * counts as "part of this path" regardless of which sequence names it.
 * Not for rendering: the cover page keeps `milestones` and each track's
 * `guides` as separate ordered lists, since order and sequence membership
 * (not flattened reachability) is exactly what a track's own tab must show.
 */
export function getManifestMemberIds(source?: { milestones?: string[]; tracks?: unknown } | null): string[] {
  const milestones = source?.milestones ?? [];
  const trackGuides = getAllTrackGuideIds(getManifestTracks(source));
  return [...new Set([...milestones, ...trackGuides])];
}

// ============ SHARED METADATA ============

/**
 * Shared package metadata fields present in RepositoryEntry, GraphNode,
 * and (partially) ManifestJson. Extracted to keep these in sync.
 * @coupling Zod schema: packageMetadataSchemaFields in package.schema.ts
 */
export interface PackageMetadataFields {
  type: PackageType;
  title?: string;
  description?: string;
  /** Author-provided time estimate, in minutes, shown on cover-page module lists. */
  estimatedMinutes?: number;
  category?: string;
  author?: Author;
  startingLocation?: string;
  milestones?: string[];
  tracks?: ManifestTrack[];
  depends?: DependencyList;
  recommends?: DependencyList;
  suggests?: DependencyList;
  provides?: string[];
  conflicts?: string[];
  replaces?: string[];
}

// ============ MANIFEST (manifest.json) ============

/**
 * Manifest file schema — metadata, dependencies, and targeting.
 * Authored by product, enablement, or recommender teams.
 *
 * The index signature carries extension metadata: any top-level key not named
 * below survives parsing and is forwarded into the package's repository entry.
 *
 * @coupling Zod schema: ManifestJsonSchema in package.schema.ts
 */
export interface ManifestJson {
  [key: string]: unknown;

  schemaVersion?: string;
  id: string;
  type: PackageType;
  repository?: string;

  milestones?: string[];
  tracks?: ManifestTrack[];

  description?: string;
  /** Author-provided time estimate, in minutes, shown on cover-page module lists. */
  estimatedMinutes?: number;
  language?: string;
  category?: string;
  author?: Author;
  startingLocation?: string;

  depends?: DependencyList;
  recommends?: DependencyList;
  suggests?: DependencyList;
  provides?: string[];
  conflicts?: string[];
  replaces?: string[];

  targeting?: GuideTargeting;
  testEnvironment?: TestEnvironment;

  /** Generated block-count stamp. Written by build tooling, never authored. */
  stats?: GuideStatsSummary;
}

// ============ REPOSITORY INDEX ============

/**
 * A single entry in repository.json.
 * Denormalized manifest metadata for dependency graph building
 * without re-reading every manifest.json.
 */
export interface RepositoryEntry extends PackageMetadataFields {
  [key: string]: unknown;

  path: string;
  targeting?: GuideTargeting;
  testEnvironment?: TestEnvironment;
  /** Generated block-count stamp, carried from the package's manifest. */
  stats?: GuideStatsSummary;
}

/**
 * Repository index mapping bare package IDs to entry metadata.
 * Generated by `pathfinder-cli build-repository`.
 * @coupling Zod schema: RepositoryJsonSchema in package.schema.ts
 */
export interface RepositoryJson {
  [packageId: string]: RepositoryEntry;
}

// ============ RESOLUTION TYPES ============

/**
 * Successful package resolution — the resolver found the package and
 * built URLs for its content and manifest.
 * @coupling PackageResolver in package-engine/
 */
export interface PackageResolutionSuccess {
  ok: true;
  id: string;
  /**
   * Opaque locator for the package's content.json, consumed by the
   * package-engine loader — NOT compatible with the docs-retrieval
   * fetchContent() pipeline which uses a different `bundled:<id>` scheme.
   */
  contentUrl: string;
  /**
   * Opaque locator for the package's manifest.json, consumed by the
   * package-engine loader.
   */
  manifestUrl: string;
  repository: string;
  /** Populated when resolve options request content loading */
  manifest?: ManifestJson;
  /** Populated when resolve options request content loading */
  content?: ContentJson;
  /**
   * Short title from the online CDN package index entry (OnlinePackageEntry.title),
   * when the resolver has one. Populated by OnlineCdnPackageResolver directly, and
   * by RecommenderPackageResolver via a cross-reference into the same cached CDN
   * index — the recommender's own by-id endpoint carries no title field.
   */
  entryTitle?: string;
  /**
   * Raw resource the `verifyPublished` probe already fetched, when the resolver
   * had to GET it to check publish status. Lets the caller's content load reuse
   * it instead of issuing the identical request again. Opaque here — only the
   * loader that understands this repository's resource shape narrows it.
   */
  probedResource?: unknown;
}

/**
 * Structured error from a failed resolution attempt.
 */
export interface ResolutionError {
  code: 'not-found' | 'permission-denied' | 'network-error' | 'parse-error' | 'validation-error';
  message: string;
}

/**
 * Failed package resolution — the resolver could not produce a result.
 */
export interface PackageResolutionFailure {
  ok: false;
  id: string;
  error: ResolutionError;
  /**
   * Repository that produced this failure, when the resolver knows it. Lets the
   * composite resolver skip negative-caching failures from mutable repositories
   * (e.g. app-platform), so a package published after a `not-found` re-resolves
   * instead of staying cached-missing for the session.
   */
  repository?: string;
}

/** Discriminated union: callers must check `.ok` before accessing data. */
export type PackageResolution = PackageResolutionSuccess | PackageResolutionFailure;

/**
 * Options for {@link PackageResolver.resolve}.
 */
export interface ResolveOptions {
  /**
   * Controls how much content to load alongside the resolution result.
   * - `true`: fetch and populate both manifest and content (full payload)
   * - `'metadata-only'`: fetch manifest only, skip the heavier content.json
   *   (sufficient for obtaining title from manifest.description and contentUrl)
   * - `false` / `undefined`: resolve URLs only, no content fetching
   */
  loadContent?: boolean | 'metadata-only';
  /**
   * When `loadContent` is falsy, still verify (server-side, where the
   * resolver supports it) that the package exists and is published before
   * reporting success. Without this, URL-only resolution is a pure string
   * build with no existence check — fine for a hot path about to fetch content
   * anyway, which will surface a missing package then, but not for a caller
   * that must not open an unpublished one (e.g. deep links by bare ID). Note
   * the content fetch carries no publish-status gate of its own, so nothing
   * downstream catches a draft.
   * Ignored by resolvers with no draft/published distinction.
   */
  verifyPublished?: boolean;
}

/**
 * Resolves bare package IDs to content/manifest locations.
 * Implementations may back onto bundled content, a static catalog, or a registry service.
 */
export interface PackageResolver {
  resolve(packageId: string, options?: ResolveOptions): Promise<PackageResolution>;
}

// ============ GRAPH TYPES ============

/**
 * A node in the dependency graph.
 * Contains full manifest metadata from the denormalized repository.json.
 */
export interface GraphNode extends PackageMetadataFields {
  id: string;
  repository: string;
  /** True for virtual capability nodes (not real packages) */
  virtual?: boolean;
}

/** Edge types in the dependency graph */
export type GraphEdgeType =
  'depends' | 'recommends' | 'suggests' | 'provides' | 'conflicts' | 'replaces' | 'milestones' | 'tracks';

/**
 * An edge in the dependency graph.
 * Source and target are bare package IDs.
 */
export interface GraphEdge {
  source: string;
  target: string;
  type: GraphEdgeType;
}

/**
 * D3-compatible graph output format.
 */
export interface DependencyGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  metadata: {
    generatedAt: string;
    repositories: string[];
    nodeCount: number;
    edgeCount: number;
  };
}
