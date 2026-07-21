/**
 * Non-empty cover-block validation for bundled/CDN path/journey packages.
 *
 * A path/journey manifest's content.json is a package "cover" — the journey
 * chrome (milestone toolbar) is injected onto it at render time, and empty
 * blocks trip a broken render instead of a milestone list (RFC
 * CUSTOM-GUIDE-PACKAGES.md Appendix A F15, §6.9). Bundled/CDN are the only
 * repositories that can gate this before render, since content and manifest
 * are loaded together at resolution time; App Platform content validates
 * against the looser JsonGuideSchema with no equivalent gate (the intended
 * CUE constraint didn't survive codegen — see package-content.ts's
 * ensureNonEmptyCoverContent for that repository's render-time fallback
 * instead).
 *
 * @coupling Types: ContentJson, ManifestJson, PackageResolutionFailure in package.types.ts
 */
import type { ContentJson, ManifestJson, PackageResolutionFailure } from '../types/package.types';

export function nonEmptyCoverBlocksError(
  packageId: string,
  manifest: ManifestJson | undefined,
  content: ContentJson | undefined
): PackageResolutionFailure | null {
  const isMetapackage = manifest?.type === 'path' || manifest?.type === 'journey';
  if (isMetapackage && content && content.blocks.length === 0) {
    return {
      ok: false,
      id: packageId,
      error: {
        code: 'validation-error',
        message: `Package "${packageId}" is a ${manifest!.type} but has no cover content (blocks is empty)`,
      },
    };
  }
  return null;
}
