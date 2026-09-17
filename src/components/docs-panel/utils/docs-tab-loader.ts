import { fetchContent, fetchPackageById, fetchPackageContent } from '../../../docs-retrieval';
import type { PackageOpenInfo } from '../../../types/content-panel.types';
import type { ContentFetchResult } from '../../../types/content.types';

export const UNRESOLVED_PACKAGE_ERROR = 'Package content is not available yet. Please try again later.';

interface LoadDocsTabContentOptions {
  skipReadyToBegin?: boolean;
  packageInfo?: PackageOpenInfo;
  /**
   * The manifest guide id `url` resolved from, when the click target already
   * carried one. Passed straight through to fetchPackageContent — see its
   * own `explicitGuideId` doc comment.
   */
  explicitGuideId?: string;
}

export async function loadDocsTabContentResult(
  url: string,
  options: LoadDocsTabContentOptions = {}
): Promise<ContentFetchResult> {
  const normalizedUrl = url.trim();
  const { skipReadyToBegin, packageInfo, explicitGuideId } = options;

  if (packageInfo) {
    if (normalizedUrl) {
      return fetchPackageContent(
        normalizedUrl,
        packageInfo.packageManifest,
        packageInfo.resolvedMilestones,
        packageInfo.repository,
        undefined,
        explicitGuideId
      );
    }

    if (packageInfo.packageId) {
      return fetchPackageById(packageInfo.packageId, packageInfo.packageManifest, packageInfo.repository);
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
