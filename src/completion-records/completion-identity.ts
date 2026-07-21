/**
 * Resolve a `(guideSource, guideId)` completion key from the resolved package
 * manifest — never from a loader URL.
 *
 * The joint contract with the Custom Guide Packages RFC keys completion on
 * `(manifest.repository, manifest.id)`. `V1PackageManifest` carries `id` but
 * not `repository` (repository is a sibling field on the recommendation), so
 * this accepts an explicit `repository` override alongside the manifest.
 * `backend-guide:` transport URLs never reach here: identity is read off the
 * manifest, so the scheme leaves the completion path entirely.
 */

import type { CompletionKey } from './types';

/** Default repository when no manifest resolves one (matches the manifest schema default). */
const DEFAULT_GUIDE_SOURCE = 'interactive-tutorials';

export interface ResolveCompletionIdentityInput {
  /** Resolved manifest off `content.metadata.packageManifest` / `packageInfo.packageManifest`. */
  packageManifest?: Record<string, unknown>;
  /** Recommendation-level repository (V1PackageManifest lacks its own). */
  repository?: string;
  /** Fallback id when the manifest carries none (bundled slug / milestone slug). */
  fallbackId: string;
  /** Fallback source when neither manifest nor `repository` resolves one (e.g. 'bundled'). */
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

export function resolveCompletionIdentity(input: ResolveCompletionIdentityInput): CompletionKey {
  const { packageManifest, repository, fallbackId, fallbackSource } = input;

  const guideId = asNonEmptyString(packageManifest?.id) ?? fallbackId;
  const guideSource =
    asNonEmptyString(packageManifest?.repository) ??
    asNonEmptyString(repository) ??
    asNonEmptyString(fallbackSource) ??
    DEFAULT_GUIDE_SOURCE;

  return { guideSource, guideId };
}
