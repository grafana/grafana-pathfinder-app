import { fetchContent, fetchPackageById, fetchPackageContent } from '../../../docs-retrieval';
import type { PackageOpenInfo } from '../../../types/content-panel.types';
import type { ContentFetchResult } from '../../../types/content.types';

export const UNRESOLVED_PACKAGE_ERROR = 'Package content is not available yet. Please try again later.';

interface LoadDocsTabContentOptions {
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
      return fetchPackageContent(normalizedUrl, packageInfo.packageManifest);
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
