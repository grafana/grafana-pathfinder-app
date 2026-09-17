/**
 * Resolve a `(guideSource, guideId)` completion key from the resolved package
 * manifest — never from a loader URL.
 *
 * The joint contract with the Custom Guide Packages RFC keys completion on
 * `(repository, manifest.id)`. `V1PackageManifest` carries `id` but not
 * `repository` (repository is a sibling field on the recommendation / a
 * resolver output), so this accepts an explicit `repository` alongside the
 * manifest. The explicit/resolved repository takes precedence over any value
 * embedded in the manifest: the manifest schema defaults an absent repository
 * to `interactive-tutorials`, and that synthetic default must never override
 * the true resolved source (records would be mis-keyed). `backend-guide:`
 * transport URLs never reach here: identity is read off the manifest, so the
 * scheme leaves the completion path entirely.
 */

import type { CompletionKey } from './types';

/**
 * The package launch shape appends this to a bundled guide's id (the package
 * resolver hands the context panel `bundled:<id>/content.json`). Named to mirror
 * `PACKAGE_CONTENT_SUFFIX` in `global-state/path-member-join.ts`, which groups the
 * same two shapes for local progress.
 *
 * THIS IS THE SINGLE PLACE that knows about the suffix for completion identity.
 * Every path that turns a bundled content key into a guide id — the journey
 * percentage writer and the reset path — goes through `normalizeGuideId`; do not
 * reintroduce a second inline `/content.json` strip elsewhere.
 */
const PACKAGE_CONTENT_SUFFIX = '/content.json';

/**
 * Normalize a guide id to its bare, canonical form by stripping a trailing
 * `/content.json`. Both `bundled:<id>` and `bundled:<id>/content.json` are valid
 * launch shapes for the same bundled guide and must record ONE identity.
 * Edge cases: returns the input unchanged if empty or exactly `/content.json`.
 */
export function normalizeGuideId(guideId: string): string {
  if (!guideId || guideId === PACKAGE_CONTENT_SUFFIX) {
    return guideId;
  }
  if (guideId.endsWith(PACKAGE_CONTENT_SUFFIX)) {
    return guideId.slice(0, -PACKAGE_CONTENT_SUFFIX.length);
  }
  return guideId;
}

/**
 * Every guide-id spelling that must be READ for one guide, honouring the bundled
 * dual-shape migration: the canonical (normalized) id, plus the legacy
 * `/content.json`-suffixed id that plugin 2.17.0 wrote. WRITE only the canonical
 * id (`normalizeGuideId`); READ every variant this returns, so a completion
 * already stored under the suffixed id is still found — never re-fired as a
 * duplicate durable record, never orphaned. The canonical id is always first.
 */
export function bundledGuideIdReadVariants(guideId: string): [canonical: string, legacySuffixed: string] {
  const normalized = normalizeGuideId(guideId);
  return [normalized, `${normalized}${PACKAGE_CONTENT_SUFFIX}`];
}

/** Default repository when neither an explicit source nor a manifest resolves one. */
const DEFAULT_GUIDE_SOURCE = 'interactive-tutorials';

export interface ResolveCompletionIdentityInput {
  /** Resolved manifest off `content.metadata.packageManifest` / `packageInfo.packageManifest`. */
  packageManifest?: Record<string, unknown>;
  /** Explicit/resolved repository (V1PackageManifest lacks its own; wins over the manifest value). */
  repository?: string;
  /** Fallback id when the manifest carries none (bundled slug / milestone slug). */
  fallbackId: string;
  /** Fallback source when neither `repository` nor manifest resolves one (e.g. 'bundled'). */
  fallbackSource?: string;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * The manifest-resolved guide id, when present. Callers that have no other
 * stable identity use this to fail closed (skip recording) rather than key a
 * completion on a loader URL.
 */
export function manifestGuideId(packageManifest?: Record<string, unknown>): string | undefined {
  return asNonEmptyString(packageManifest?.id);
}

export function manifestGuideSource(packageManifest?: Record<string, unknown>): string | undefined {
  return asNonEmptyString(packageManifest?.repository);
}

export function resolveCompletionIdentity(input: ResolveCompletionIdentityInput): CompletionKey {
  const { packageManifest, repository, fallbackId, fallbackSource } = input;

  const guideId = asNonEmptyString(packageManifest?.id) ?? fallbackId;
  const guideSource =
    asNonEmptyString(repository) ??
    asNonEmptyString(packageManifest?.repository) ??
    asNonEmptyString(fallbackSource) ??
    DEFAULT_GUIDE_SOURCE;

  return { guideSource, guideId };
}

export interface ResolveMilestoneCompletionIdentityInput {
  /** The milestone's own manifest, consulted for `guideSource` ONLY — never for `guideId`. */
  packageManifest?: Record<string, unknown>;
  /** Explicit/resolved repository; wins over the manifest value, same precedence as {@link resolveCompletionIdentity}. */
  repository?: string;
  /** The milestone's URL slug — the only identity a milestone-as-guide record is ever keyed on. */
  milestoneSlug: string;
}

/**
 * The ONE identity derivation for a milestone-as-guide completion record.
 * Both `markMilestoneDone` (the writer) and the reset path call this rather
 * than `resolveCompletionIdentity` directly — a milestone's `guideId` is
 * always its slug, by construction, with no argument able to override that.
 * A manifest may exist for the owning journey/package, but a milestone is
 * addressed by URL, not by the journey's manifest id, so letting a manifest
 * id win here (as it correctly does for an ordinary guide) would key the
 * writer and a reset under different ids for the exact same milestone.
 */
export function resolveMilestoneCompletionIdentity(input: ResolveMilestoneCompletionIdentityInput): CompletionKey {
  const guideSource =
    asNonEmptyString(input.repository) ?? asNonEmptyString(input.packageManifest?.repository) ?? 'bundled';

  return { guideSource, guideId: input.milestoneSlug };
}

export interface ResolveGuideCompletionIdentityInput {
  packageManifest?: Record<string, unknown>;
  repository?: string;
  guideId: string;
}

/**
 * The ONE identity derivation for a bundled guide's completion record.
 * `recordGuideCompletionForSurface`'s `bundled:` branch and the reset
 * path's matching branch both call this rather than
 * `resolveCompletionIdentity` directly, so the fallback source ('bundled')
 * cannot drift between them the way it did before this function existed
 * (identity-divergence, guideSource axis).
 */
export function resolveBundledGuideCompletionIdentity(input: ResolveGuideCompletionIdentityInput): CompletionKey {
  return resolveCompletionIdentity({
    packageManifest: input.packageManifest,
    repository: input.repository,
    fallbackId: input.guideId,
    fallbackSource: 'bundled',
  });
}

/**
 * The ONE identity derivation for a standalone (non-bundled,
 * manifest-carrying) guide's completion record. Deliberately takes no
 * `fallbackSource` at all: `recordStandaloneGuideCompletion` (the writer)
 * and the reset path's matching branch both call this, so whichever value
 * `resolveCompletionIdentity`'s own default falls through to is what BOTH
 * sides get — never a caller-supplied guess that the other caller could
 * supply differently. That divergence (the writer omitting a fallback,
 * the reset path guessing `'bundled'`) is exactly what let reset-then-
 * re-mark drop the durable record for a standalone guide whose manifest
 * carries an id but no repository.
 */
export function resolveStandaloneGuideCompletionIdentity(input: ResolveGuideCompletionIdentityInput): CompletionKey {
  return resolveCompletionIdentity({
    packageManifest: input.packageManifest,
    repository: input.repository,
    fallbackId: input.guideId,
  });
}
