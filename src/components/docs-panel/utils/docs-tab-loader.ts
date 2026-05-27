import { fetchContent, fetchPackageById, fetchPackageContent } from '../../../docs-retrieval';
import type { PackageOpenInfo } from '../../../types/content-panel.types';
import type { ContentFetchResult } from '../../../types/content.types';

export const UNRESOLVED_PACKAGE_ERROR = 'Package content is not available yet. Please try again later.';

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

  // mode === 'journey'. Empty URL is treated symmetrically with the docs
  // branch — both surface the same controlled error rather than diverging
  // (the panel no longer carries a silent-no-op for this case).
  if (!normalizedUrl) {
    return {
      content: null,
      error: 'Invalid URL provided',
      errorType: 'other',
    };
  }

  return fetchContent(normalizedUrl);
}
