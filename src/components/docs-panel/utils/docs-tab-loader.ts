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
  /**
   * The owning path's own base URL, when the caller already has it. Passed
   * straight through to fetchPackageContent — see its own `knownBaseUrl`
   * doc comment.
   */
  knownBaseUrl?: string;
}

export async function loadDocsTabContentResult(
  url: string,
  options: LoadDocsTabContentOptions = {}
): Promise<ContentFetchResult> {
  const normalizedUrl = url.trim();
  const { skipReadyToBegin, packageInfo, explicitGuideId, knownBaseUrl } = options;

  if (packageInfo) {
    if (normalizedUrl) {
      return fetchPackageContent(
        normalizedUrl,
        packageInfo.packageManifest,
        packageInfo.resolvedMilestones,
        packageInfo.repository,
        undefined,
        explicitGuideId,
        knownBaseUrl
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
