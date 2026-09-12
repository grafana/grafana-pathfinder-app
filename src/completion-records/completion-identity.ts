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
