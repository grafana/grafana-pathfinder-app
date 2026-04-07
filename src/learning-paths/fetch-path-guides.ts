/**
 * Fetch Path Guides from index.json
 *
 * For URL-based learning paths, fetches the guide list from a remote
 * docs site index.json (Hugo/Jekyll page listing) via the plugin backend
 * proxy. The backend proxy avoids browser CORS restrictions — grafana.com
 * serves index.json without Access-Control-Allow-Origin headers.
 */

import type { GuideMetadataEntry } from '../types/learning-paths.types';
import { fetchDocsIndexJson } from '../lib/fetch-docs-index';

// ============================================================================
// TYPES
// ============================================================================

export interface FetchedPathGuides {
  /** Ordered guide IDs derived from relpermalink slugs */
  guides: string[];
  /** Guide metadata keyed by guide ID */
  guideMetadata: Record<string, GuideMetadataEntry>;
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Extracts the last path segment from a relative permalink.
 * e.g. "/docs/learning-paths/linux-server-integration/select-platform/" -> "select-platform"
 */
function slugFromPermalink(relpermalink: string): string {
  const segments = relpermalink.replace(/\/+$/, '').split('/');
  return segments[segments.length - 1] || '';
}

// ============================================================================
// MAIN FETCH FUNCTION
// ============================================================================

/**
 * Fetches the guide list for a URL-based learning path from its index.json.
 *
 * @param pathUrl - The base docs URL for the learning path
 *                  (e.g. "https://grafana.com/docs/learning-paths/linux-server-integration/")
 * @param signal - Optional AbortSignal to cancel the fetch
 * @returns Guide IDs and metadata, or null on failure
 */
export async function fetchPathGuides(pathUrl: string, signal?: AbortSignal): Promise<FetchedPathGuides | null> {
  // SECURITY: constructed URL with URL API (F3)
  const indexJsonUrl = new URL('index.json', pathUrl.endsWith('/') ? pathUrl : `${pathUrl}/`);

  const data = await fetchDocsIndexJson(indexJsonUrl.toString(), signal);
  if (!data) {
    return null;
  }

  // Filter out items that should be skipped in Grafana (e.g. cover pages)
  const validItems = data.filter((item: any) => !item.params?.grafana?.skip);

  const guides: string[] = [];
  const guideMetadata: Record<string, GuideMetadataEntry> = {};

  for (const item of validItems as any[]) {
    const slug = slugFromPermalink(item.relpermalink || '');
    if (!slug) {
      continue;
    }

    const title = item.params?.menutitle || item.params?.title || slug;

    guides.push(slug);
    guideMetadata[slug] = {
      title,
      estimatedMinutes: 5,
    };
  }

  return { guides, guideMetadata };
}
