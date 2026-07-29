/**
 * URL validation and cleaning utilities for docs panel content.
 * Extracted from docs-panel.tsx to enable unit testing and reuse.
 */

import { ALLOWED_GRAFANA_DOCS_HOSTNAMES } from '../../../constants';
import { parseUrlSafely } from '../../../security';

/**
 * Routing predicate shared by the auto-open listener and `prepareGuideLaunch`:
 * journey URLs open via `openLearningJourney`, everything else via
 * `openDocsPage`. Tests the PATHNAME only, so a journey path echoed in a query
 * string (`/docs/foo/?ref=/learning-paths/x`) does not misroute, and both
 * consumers stay consistent by construction.
 */
export function isLearningJourneyUrl(url: string): boolean {
  const urlObj = parseUrlSafely(url);
  return Boolean(urlObj?.pathname.includes('/learning-journeys/') || urlObj?.pathname.includes('/learning-paths/'));
}

/**
 * Checks if a URL is from an allowed Grafana documentation domain.
 * Returns false for bundled content or invalid URLs.
 *
 * @param url - The URL to validate
 * @returns true if the URL is from an allowed Grafana docs domain
 */
export function isGrafanaDocsUrl(url: string | undefined): boolean {
  if (!url || typeof url !== 'string') {
    return false;
  }

  // Bundled content is not a Grafana domain URL
  if (url.startsWith('bundled:')) {
    return false;
  }

  try {
    const parsed = new URL(url);
    // Security: Use exact hostname matching from allowlist (no subdomains)
    return ALLOWED_GRAFANA_DOCS_HOSTNAMES.includes(parsed.hostname);
  } catch {
    // Invalid URL
    return false;
  }
}

/**
 * Removes internal suffixes from a URL for browser viewing.
 * Strips /unstyled.html (used by docs embedding) and /content.json
 * (used by learning path rendering) so users see the canonical page.
 *
 * @param url - The URL to clean
 * @returns URL with internal suffixes removed
 */
export function cleanDocsUrl(url: string): string {
  return url.replace(/\/(unstyled\.html|content\.json)$/, '');
}
