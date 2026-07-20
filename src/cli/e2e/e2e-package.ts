/**
 * Remote package resolution for the e2e CLI.
 *
 * Thin orchestration over CLI-local clients:
 *   - `recommender-resolver` resolves a bare ID via the recommender
 *     (`GET /api/v1/packages/{id}`) for `--package <id>`; the target's `depends`
 *     prerequisites are then resolved from the CDN index and chained.
 *   - `repository-client` fetches the CDN `repository.json` for `--remote` and
 *     for prerequisite resolution.
 *
 * Each resolved package is mapped to either a runnable guide or a structured
 * skip outcome. Network and validation failures never throw; they become skip
 * outcomes so a batch run degrades gracefully.
 */

import { validateGuideFromString } from '../../validation';
import type { RepositoryEntry, RepositoryJson, TestEnvironment } from '../../types/package.types';
import { resolvePackageById } from './recommender-resolver';
import { fetchRepositoryIndex, buildPackageFileUrl, type RepositoryPackage } from '../mcp/lib/repository-client';
import { planGuideExecution } from './guide-chains';
import type { LoadedGuide } from '../utils/file-loader';
import { resolveTarget, type CloudTargetCapabilities } from './e2e-targets';
import type { CurrentTier } from './manifest-preflight';
import { classifyGuideSideEffectsFromString, type SideEffectClassification } from './side-effects';

const FETCH_TIMEOUT_MS = 15_000;

/**
 * Reasons a remote package is skipped before execution. This is the single
 * source of truth for the skip vocabulary: the e2e command derives its guide
 * statuses and its pre-run-skip set from this list, so the two never drift.
 */
export const REMOTE_SKIP_REASONS = [
  'skipped_no_auth',
  'skipped_tier_mismatch',
  'skipped_invalid_instance',
  'fetch_failed',
  'resolution_failed',
  'validation_failed',
  'unsupported_type',
  'prerequisite_failed',
  'skipped_unsafe_shared_stack',
] as const;

/** Why a remote package was skipped instead of run. */
export type RemoteSkipReason = (typeof REMOTE_SKIP_REASONS)[number];

/** A remote package resolved to a runnable guide against its target. */
export interface ResolvedRemoteGuide {
  id: string;
  /** `path` is the source content URL; `content` is the raw JSON text. */
  guide: LoadedGuide;
  tier: string;
  instance?: string;
  /** Grafana URL the guide will be tested against. */
  targetUrl: string;
  /** The content.json URL the guide was fetched from. */
  sourceUrl: string;
  /** Conservative side-effect classification for the fetched content. */
  sideEffects: SideEffectClassification;
  /** Plugin IDs required by this guide, from testEnvironment.plugins. */
  plugins?: string[];
}

/** A remote package that will not be run, with a structured reason. */
export interface SkippedPackage {
  id: string;
  reason: RemoteSkipReason;
  message: string;
  sourceUrl?: string;
  tier?: string;
  sideEffects?: SideEffectClassification;
}

/** Result of resolving one or more remote packages. */
export interface RemoteResolution {
  /** Guides explicitly selected to run (the target for a package; all guides for a batch). */
  runnable: ResolvedRemoteGuide[];
  /**
   * Prerequisite guides available for the planner to auto-include (single-package mode). */
  prerequisites: ResolvedRemoteGuide[];
  /** Packages skipped before execution, with reasons. */
  skipped: SkippedPackage[];
  /** Repository index for dependency chaining; empty when no index applies. */
  repository: RepositoryJson;
  /** Set when the operation could not start at all (e.g. CDN index unreachable). */
  error?: string;
}

export interface RemoteResolveOptions {
  /** Grafana URL configured for local-tier guides. */
  grafanaUrl: string;
  /** Tier of the current test environment (from `--tier`). */
  currentTier: CurrentTier;
  /** Recommender base URL for `--package <id>` resolution. */
  resolverUrl: string;
  /** CDN base URL override for `--remote` batch resolution. */
  repoUrl?: string;
  /** Default cloud instance URL for `cloud`-tier guides without an `instance`. */
  cloudUrl?: string;
  /** Cloud execution capabilities without exposing credential values to resolution. */
  cloudTargetCapabilities?: CloudTargetCapabilities;
}

/** Fetch a URL as raw text with a timeout. Never throws. */
async function fetchText(url: string): Promise<{ ok: true; text: string } | { ok: false; message: string }> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      return { ok: false, message: `HTTP ${res.status} ${res.statusText}` };
    }
    return { ok: true, text: await res.text() };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Unknown error' };
  }
}

/**
 * Given a resolved package's metadata and content URL, apply target resolution,
 * fetch the content, and validate it — producing either a runnable guide or a
 * skip outcome. Shared by single- and batch-resolution paths.
 */
async function buildGuideOrSkip(
  id: string,
  type: string | undefined,
  testEnvironment: TestEnvironment,
  contentUrl: string,
  options: RemoteResolveOptions
): Promise<{ runnable?: ResolvedRemoteGuide; skipped?: SkippedPackage }> {
  // Only single guides are testable; paths/journeys (milestone expansion) are deferred.
  if (type && type !== 'guide') {
    return {
      skipped: {
        id,
        reason: 'unsupported_type',
        message: `Package type "${type}" is not yet testable`,
        sourceUrl: contentUrl,
        tier: testEnvironment.tier,
      },
    };
  }

  const target = resolveTarget(testEnvironment, {
    grafanaUrl: options.grafanaUrl,
    currentTier: options.currentTier,
    cloudUrl: options.cloudUrl,
    cloudTargetCapabilities: options.cloudTargetCapabilities,
  });
  if (!target.runnable) {
    return {
      skipped: {
        id,
        reason: target.skipReason!,
        message: target.message ?? 'Guide skipped',
        sourceUrl: contentUrl,
        tier: target.tier,
      },
    };
  }

  const fetched = await fetchText(contentUrl);
  if (!fetched.ok) {
    return {
      skipped: {
        id,
        reason: 'fetch_failed',
        message: `Could not fetch content.json: ${fetched.message}`,
        sourceUrl: contentUrl,
        tier: target.tier,
      },
    };
  }

  const validation = validateGuideFromString(fetched.text);
  if (!validation.isValid) {
    return {
      skipped: {
        id,
        reason: 'validation_failed',
        message: 'Fetched content.json failed guide schema validation',
        sourceUrl: contentUrl,
        tier: target.tier,
      },
    };
  }
  const sideEffects = classifyGuideSideEffectsFromString(fetched.text);

  return {
    runnable: {
      id,
      guide: { path: contentUrl, content: fetched.text },
      tier: target.tier,
      instance: target.instance,
      targetUrl: target.targetUrl!,
      sourceUrl: contentUrl,
      sideEffects,
      ...(testEnvironment.plugins?.length ? { plugins: testEnvironment.plugins } : {}),
    },
  };
}

/** Reconstruct an id-keyed RepositoryJson from a fetched CDN index's packages. */
function indexToRepository(packages: RepositoryPackage[]): RepositoryJson {
  const repository: RepositoryJson = {};
  for (const pkg of packages) {
    const { id, ...entry } = pkg;
    repository[id] = entry;
  }
  return repository;
}

/** Fetch + classify a single repository-index entry into a runnable guide or a skip. */
async function resolveIndexEntry(
  id: string,
  entry: RepositoryEntry,
  baseUrl: string,
  options: RemoteResolveOptions
): Promise<{ runnable?: ResolvedRemoteGuide; skipped?: SkippedPackage }> {
  const contentUrl = buildPackageFileUrl(baseUrl, entry.path, 'content.json');
  if (!contentUrl) {
    return {
      skipped: {
        id,
        reason: 'fetch_failed',
        message: 'Could not construct content.json URL',
        tier: entry.testEnvironment?.tier,
      },
    };
  }
  return buildGuideOrSkip(id, entry.type, entry.testEnvironment ?? {}, contentUrl, options);
}

/**
 * Enumerate the target's transitive `depends` prerequisites by running the
 * planner as a pure oracle: a throwaway stub loader lets it report
 * `autoIncludedIds` without re-implementing OR-group / `provides` resolution.
 * Planner errors (cycles, unresolvable clauses) are surfaced alongside the ids
 * so callers can cascade them; the stub content is never read.
 */
function discoverPrerequisites(
  targetGuide: LoadedGuide,
  repository: RepositoryJson
): { ids: string[]; errors: string[] } {
  const stubLoader = (stubId: string): LoadedGuide => ({ path: stubId, content: '{}' });
  const plan = planGuideExecution({ guides: [targetGuide], repository, loadGuideById: stubLoader });
  return { ids: plan.autoIncludedIds, errors: plan.errors };
}

function prerequisiteFailedSkip(target: ResolvedRemoteGuide, detail: string): SkippedPackage {
  return {
    id: target.id,
    reason: 'prerequisite_failed',
    message: `Prerequisite(s) did not resolve: ${detail}`,
    sourceUrl: target.sourceUrl,
    tier: target.tier,
    sideEffects: target.sideEffects,
  };
}

function resolutionFailedSkip(target: ResolvedRemoteGuide, message: string): SkippedPackage {
  return {
    id: target.id,
    reason: 'resolution_failed',
    message,
    sourceUrl: target.sourceUrl,
    tier: target.tier,
    sideEffects: target.sideEffects,
  };
}

function skippedResolution(skipped: SkippedPackage[], repository: RepositoryJson = {}): RemoteResolution {
  return { runnable: [], prerequisites: [], skipped, repository };
}

/**
 * Fetch and classify each discovered prerequisite id against the repository
 * index, collecting runnable guides and structured skips. A planner-included
 * id that's missing from the repository becomes a `resolution_failed` skip.
 */
async function resolvePrerequisites(
  ids: string[],
  repository: RepositoryJson,
  baseUrl: string,
  options: RemoteResolveOptions
): Promise<{ prerequisites: ResolvedRemoteGuide[]; skipped: SkippedPackage[] }> {
  const prerequisites: ResolvedRemoteGuide[] = [];
  const skipped: SkippedPackage[] = [];
  for (const prerequisiteId of ids) {
    const entry = repository[prerequisiteId];
    if (!entry) {
      skipped.push({
        id: prerequisiteId,
        reason: 'resolution_failed',
        message: 'Prerequisite missing from repository index',
      });
      continue;
    }
    const built = await resolveIndexEntry(prerequisiteId, entry, baseUrl, options);
    if (built.runnable) {
      prerequisites.push(built.runnable);
    }
    if (built.skipped) {
      skipped.push(built.skipped);
    }
  }
  return { prerequisites, skipped };
}

/**
 * Resolve a single package by bare ID via the recommender service, then resolve
 * and fetch the target's `depends` prerequisites from the CDN index so the run
 * chains them the same way selecting a local guide with dependencies does. When
 * no index is available (unreachable, or the target is absent from it), the
 * target runs as its own chain.
 */
export async function resolveRemotePackage(id: string, options: RemoteResolveOptions): Promise<RemoteResolution> {
  // Resolve metadata (URLs + manifest) only; the raw content is fetched in
  // buildGuideOrSkip so the injected guide stays byte-faithful.
  const resolution = await resolvePackageById(options.resolverUrl, id);
  if (!resolution.ok) {
    return skippedResolution([{ id, reason: 'resolution_failed', message: resolution.message }]);
  }

  const built = await buildGuideOrSkip(
    resolution.id || id,
    resolution.manifest?.type,
    resolution.manifest?.testEnvironment ?? {},
    resolution.contentUrl,
    options
  );
  if (!built.runnable) {
    return skippedResolution(built.skipped ? [built.skipped] : []);
  }
  const target = built.runnable;

  const index = await fetchRepositoryIndex(options.repoUrl);
  if (!index.ok) {
    // Without an index we can only run safely if the manifest declares no prereqs.
    const declaredDepends = resolution.manifest?.depends ?? [];
    if (declaredDepends.length > 0) {
      return skippedResolution([
        resolutionFailedSkip(
          target,
          `Repository index unreachable (${index.message}); target declares prerequisites that cannot be verified`
        ),
      ]);
    }
    return { runnable: [target], prerequisites: [], skipped: [], repository: {} };
  }

  const repository = indexToRepository(index.packages);

  // The recommender resolves across repos but this CLI checks deps against
  // one index. If the target's home repo isn't the one we fetched, its
  // `depends` would be invisible to our planner.
  if (!repository[target.id]) {
    return skippedResolution(
      [
        resolutionFailedSkip(
          target,
          `Target "${target.id}" was resolved via the recommender but is not present in the repository index used for dependency lookup`
        ),
      ],
      repository
    );
  }

  // Skip the target when any hard `depends` prereq fails to resolve — the
  // dependent can't run without its prerequisite state.
  const discovered = discoverPrerequisites(target.guide, repository);
  if (discovered.errors.length > 0) {
    return skippedResolution([prerequisiteFailedSkip(target, discovered.errors.join('; '))], repository);
  }

  const { prerequisites, skipped } = await resolvePrerequisites(discovered.ids, repository, index.baseUrl, options);
  if (skipped.length > 0) {
    const brokenIds = skipped.map((s) => s.id).join(', ');
    return skippedResolution([...skipped, prerequisiteFailedSkip(target, brokenIds)], repository);
  }

  return { runnable: [target], prerequisites, skipped, repository };
}

/**
 * Resolve every package in the CDN `repository.json`, returning runnable
 * local-tier guides plus structured skips. The repository index is returned so
 * the caller can drive dependency-aware chaining over the same source.
 */
export async function resolveRemoteRepository(options: RemoteResolveOptions): Promise<RemoteResolution> {
  const index = await fetchRepositoryIndex(options.repoUrl);
  if (!index.ok) {
    return {
      runnable: [],
      prerequisites: [],
      skipped: [],
      repository: {},
      error: `Could not fetch repository index: ${index.message}`,
    };
  }

  const repository = indexToRepository(index.packages);
  const runnable: ResolvedRemoteGuide[] = [];
  const skipped: SkippedPackage[] = [];

  for (const pkg of index.packages) {
    const built = await resolveIndexEntry(pkg.id, pkg, index.baseUrl, options);
    if (built.runnable) {
      runnable.push(built.runnable);
    }
    if (built.skipped) {
      skipped.push(built.skipped);
    }
  }

  return { runnable, prerequisites: [], skipped, repository };
}
