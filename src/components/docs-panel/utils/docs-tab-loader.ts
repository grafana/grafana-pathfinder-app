import { fetchContent, fetchPackageById, fetchPackageContent } from '../../../docs-retrieval';
import type { PackageOpenInfo } from '../../../types/content-panel.types';
import type { ContentFetchResult } from '../../../types/content.types';

export const UNRESOLVED_PACKAGE_ERROR = 'Package content is not available yet. Please try again later.';

/**
 * - `'docs'`: package + docs-retrieval fetch with URL / package-id / not-found
 *   resolution.
 * - `'journey'`: plain `fetchContent` for non-package milestones; the panel
 *   handles empty-URL early-return and milestone-context enrichment.
 */
export type LoadTabContentMode = 'docs' | 'journey';

interface LoadTabContentOptions {
  mode: LoadTabContentMode;
  skipReadyToBegin?: boolean;
  packageInfo?: PackageOpenInfo;
}

export async function loadTabContentResult(url: string, options: LoadTabContentOptions): Promise<ContentFetchResult> {
  const normalizedUrl = url.trim();
  const { mode, skipReadyToBegin, packageInfo } = options;

  if (mode === 'docs') {
    if (packageInfo) {
      if (normalizedUrl) {
        return fetchPackageContent(normalizedUrl, packageInfo.packageManifest, packageInfo.resolvedMilestones);
      }

      if (packageInfo.packageId) {
        return fetchPackageById(packageInfo.packageId, packageInfo.packageManifest);
      }

      return {
        content: null,
        error: UNRESOLVED_PACKAGE_ERROR,
        errorType: 'not-found',
      };
    }

    if (!normalizedUrl) {
      return {
        content: null,
        error: 'Invalid URL provided',
        errorType: 'other',
      };
    }

    return fetchContent(normalizedUrl, { skipReadyToBegin });
  }

  // mode === 'journey'. The panel guards empty URLs upstream, so reaching
  // here with one is a programming error; surface the same controlled
  // error as the docs branch rather than silently no-op.
  if (!normalizedUrl) {
    return {
      content: null,
      error: 'Invalid URL provided',
      errorType: 'other',
    };
  }

  return fetchContent(normalizedUrl);
}
