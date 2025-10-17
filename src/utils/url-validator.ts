/**
 * Secure URL Validation Utilities
 *
 * Provides proper URL parsing and domain validation to prevent:
 * - Domain hijacking (a-grafana.com matching grafana.com)
 * - Path injection (evil.com/grafana.com/docs/)
 * - Subdomain hijacking (grafana.com.evil.com)
 * - Protocol bypasses (file://, data:, javascript:)
 */

/**
 * Safely parse a URL string, returning null on failure
 *
 * @param urlString - The URL string to parse
 * @returns Parsed URL object or null if invalid
 */
export function parseUrlSafely(urlString: string): URL | null {
  try {
    return new URL(urlString);
  } catch {
    return null;
  }
}

/**
 * Check if URL is a Grafana documentation URL
 *
 * Security: Validates hostname is exactly grafana.com or a proper subdomain
 *
 * @param urlString - The URL to validate
 * @returns true if valid Grafana docs URL, false otherwise
 *
 * @example
 * isGrafanaDocsUrl('https://grafana.com/docs/grafana/') // true
 * isGrafanaDocsUrl('https://a-grafana.com/docs/') // false (domain hijacking)
 * isGrafanaDocsUrl('https://grafana.com.evil.com/docs/') // false (subdomain hijacking)
 */
export function isGrafanaDocsUrl(urlString: string): boolean {
  const url = parseUrlSafely(urlString);
  if (!url) {
    return false;
  }

  // Only allow http and https protocols
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return false;
  }

  // Check hostname is exactly grafana.com or a proper subdomain
  // ✅ grafana.com
  // ✅ www.grafana.com
  // ✅ docs.grafana.com
  // ❌ a-grafana.com (not grafana.com)
  // ❌ grafana.com.evil.com (not a subdomain of grafana.com)
  const isGrafanaDomain = url.hostname === 'grafana.com' || url.hostname.endsWith('.grafana.com');
  if (!isGrafanaDomain) {
    return false;
  }

  // Check pathname contains allowed documentation paths
  // Learning journeys are at /docs/learning-journeys/ so we need includes(), not startsWith()
  return (
    url.pathname.startsWith('/docs/') ||
    url.pathname.startsWith('/tutorials/') ||
    url.pathname.includes('/learning-journeys/')
  );
}

/**
 * Check if URL is a valid YouTube domain
 *
 * Security: Validates hostname is an exact match to known YouTube domains
 *
 * @param urlString - The URL to validate
 * @returns true if valid YouTube URL, false otherwise
 *
 * @example
 * isYouTubeDomain('https://www.youtube.com/embed/abc') // true
 * isYouTubeDomain('https://youtube.com.evil.com/embed/') // false
 */
export function isYouTubeDomain(urlString: string): boolean {
  const url = parseUrlSafely(urlString);
  if (!url) {
    return false;
  }

  // Only allow https protocol
  if (url.protocol !== 'https:') {
    return false;
  }

  // Exact hostname matching (no subdomain wildcards)
  const allowedHosts = [
    'youtube.com',
    'www.youtube.com',
    'youtube-nocookie.com',
    'www.youtube-nocookie.com',
    'youtu.be',
  ];

  return allowedHosts.includes(url.hostname);
}

/**
 * Check if URL is a valid GitHub raw content URL from allowed repositories
 *
 * @param urlString - The URL to validate
 * @param allowedPaths - Array of allowed pathname prefixes (e.g., ['/grafana/', '/moxious/'])
 * @returns true if valid GitHub URL from allowed repo, false otherwise
 */
export function isAllowedGitHubRawUrl(urlString: string, allowedPaths: string[]): boolean {
  const url = parseUrlSafely(urlString);
  if (!url) {
    return false;
  }

  // Only allow https protocol for GitHub
  if (url.protocol !== 'https:') {
    return false;
  }

  // Check hostname is exactly raw.githubusercontent.com
  if (url.hostname !== 'raw.githubusercontent.com') {
    return false;
  }

  // Check if pathname starts with any allowed path
  return allowedPaths.some((allowedPath) => url.pathname.startsWith(allowedPath));
}

/**
 * Check if URL is a valid Grafana domain (for general use, not just docs)
 *
 * @param urlString - The URL to validate
 * @returns true if hostname is grafana.com or proper subdomain
 */
export function isGrafanaDomain(urlString: string): boolean {
  const url = parseUrlSafely(urlString);
  if (!url) {
    return false;
  }

  // Only allow http and https protocols
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return false;
  }

  // Check hostname is exactly grafana.com or a proper subdomain
  return url.hostname === 'grafana.com' || url.hostname.endsWith('.grafana.com');
}

/**
 * Generic trusted domain validator
 *
 * @param urlString - The URL to validate
 * @param allowedDomains - Array of allowed hostnames (exact match)
 * @returns true if URL hostname matches one of the allowed domains
 */
export function isTrustedDomain(urlString: string, allowedDomains: string[]): boolean {
  const url = parseUrlSafely(urlString);
  if (!url) {
    return false;
  }

  // Only allow http and https protocols
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return false;
  }

  // Check if hostname matches any allowed domain (exact match only)
  return allowedDomains.includes(url.hostname);
}
