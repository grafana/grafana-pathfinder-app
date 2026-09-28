import type { GuideLoadContext } from '../../../types/guide-diagnostics.types';
import { fetchContent, fetchPackageById, fetchPackageContent } from '../../../docs-retrieval';
import type { PackageOpenInfo } from '../../../types/content-panel.types';
import type { ContentFetchResult } from '../../../types/content.types';

export const UNRESOLVED_PACKAGE_ERROR = 'Package content is not available yet. Please try again later.';

interface LoadDocsTabContentOptions {
  loadContext?: GuideLoadContext;
  skipReadyToBegin?: boolean;
  packageInfo?: PackageOpenInfo;
}

export async function loadDocsTabContentResult(
  url: string,
  options: LoadDocsTabContentOptions = {}
): Promise<ContentFetchResult> {
  const normalizedUrl = url.trim();
  const { skipReadyToBegin, packageInfo } = options;

  if (packageInfo) {
    if (normalizedUrl) {
      return fetchPackageContent(
        normalizedUrl,
        packageInfo.packageManifest,
        packageInfo.resolvedMilestones,
        packageInfo.repository,
        undefined,
        options.loadContext
      );
    }

    if (packageInfo.packageId) {
      return fetchPackageById(
        packageInfo.packageId,
        packageInfo.packageManifest,
        packageInfo.repository,
        options.loadContext
      );
    }

    return {
      content: null,
      error: UNRESOLVED_PACKAGE_ERROR,
      errorType: 'not-found',
      diagnostic: { source: options.loadContext?.source ?? 'other', stage: 'resolve', reason: 'not-found' },
    };
  }

  if (!normalizedUrl) {
    return {
      content: null,
      error: 'Invalid URL provided',
      errorType: 'other',
      diagnostic: { source: options.loadContext?.source ?? 'other', stage: 'resolve', reason: 'invalid-url' },
    };
  }

  return fetchContent(normalizedUrl, { skipReadyToBegin, loadContext: options.loadContext });
}
