import { fetchContent, fetchPackageById, fetchPackageContent } from '../../../docs-retrieval';
import type { PackageOpenInfo } from '../../../types/content-panel.types';
import type { ContentFetchResult } from '../../../types/content.types';

export const UNRESOLVED_PACKAGE_ERROR = 'Package content is not available yet. Please try again later.';

/**
 * Loader mode.
 *
 * - `'docs'`: package + docs-retrieval fetch. Handles package URL routing,
 *   package-id fallback, and the unresolved-package error. This is the path
 *   used by `openDocsPage` and by `loadTab` when the tab is package-backed
 *   or otherwise needs the docs loader.
 * - `'journey'`: plain `fetchContent` for non-package learning-journey
 *   milestones. The caller (panel) handles its own empty-URL early return
 *   and milestone-context enrichment.
 */
export type LoadTabContentMode = 'docs' | 'journey';

interface LoadTabContentOptions {
  mode: LoadTabContentMode;
  skipReadyToBegin?: boolean;
  packageInfo?: PackageOpenInfo;
}

/**
 * Unified content-fetch entry point. Dispatches between the package-aware
 * docs loader and plain `fetchContent` based on `options.mode`, so both
 * pipelines share one signature and one set of edge-case semantics in the
 * panel's `loadTab` body.
 */
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

  // mode === 'journey' — plain learning-journey milestone fetch. The panel
  // enforces its own empty-URL early return before calling, so a missing
  // URL here is a programming error; we surface the same controlled error
  // as the docs branch rather than silently no-op.
  if (!normalizedUrl) {
    return {
      content: null,
      error: 'Invalid URL provided',
      errorType: 'other',
    };
  }

  return fetchContent(normalizedUrl);
}
