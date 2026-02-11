/**
 * URL validation and cleaning utilities for docs panel content.
 * Extracted from docs-panel.tsx to enable unit testing and reuse.
 */

import { ALLOWED_GRAFANA_DOCS_HOSTNAMES } from '../../../constants';

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
 * Removes the /unstyled.html suffix from a URL for browser viewing.
 * Users want to see the styled docs page, not the unstyled version
 * used for embedding in the panel.
 *
 * @param url - The URL to clean
 * @returns URL with /unstyled.html removed if present
 */
export function cleanDocsUrl(url: string): string {
  return url.replace(/\/unstyled\.html$/, '');
}
