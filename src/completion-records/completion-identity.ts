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
