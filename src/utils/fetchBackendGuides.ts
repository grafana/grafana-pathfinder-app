/**
 * Shared utility for fetching backend guides.
 *
 * Group resolution, availability, and read semantics live in
 * `./interactive-guides-api`; this module is the guide-list read on top of it.
 */

import { collectionUrl, isBackendApiAvailable, readListMerged } from './interactive-guides-api';

// Re-exported so existing importers (e.g. BlockEditor) keep a stable path.
export { isBackendApiAvailable };

/**
 * Fetch guides from the backend API. Returns an empty array when the endpoint
 * is unavailable; genuine (non-"not rolled out") errors propagate to the caller.
 * When publishedOnly is true, only guides with spec.status === 'published' are
 * returned; guides with missing/undefined status are treated as draft and excluded.
 */
export async function fetchBackendGuides(namespace: string, publishedOnly?: boolean): Promise<any[]> {
  const items = await readListMerged<any>((apiVersion) => collectionUrl(apiVersion, namespace));

  if (publishedOnly) {
    return items.filter((item: any) => item.spec?.status === 'published');
  }
  return items;
}
