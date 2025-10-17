/**
 * Secure URL Validation Utilities
 *
 * Provides proper URL parsing and domain validation to prevent:
 * - Domain hijacking (a-grafana.com matching grafana.com)
 * - Path injection (evil.com/grafana.com/docs/)
 * - Subdomain hijacking (grafana.com.evil.com)
 * - Protocol bypasses (file://, data:, javascript:)
 *
 * In dev mode, localhost URLs are permitted for local testing.
 */

import { isDevModeEnabled } from './dev-mode';

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
 * Check if URL is a localhost URL (for dev mode)
 *
 * @param urlString - The URL to validate
 * @returns true if localhost URL, false otherwise
 */
export function isLocalhostUrl(urlString: string): boolean {
  const url = parseUrlSafely(urlString);
  if (!url) {
    return false;
  }

  // Only allow http and https protocols for localhost
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return false;
  }

  // Check for localhost, 127.0.0.1, or ::1 (IPv6 localhost)
  return (
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '[::1]' ||
    url.hostname.startsWith('127.') // Allow 127.x.x.x range
  );
}

/**
 * Check if URL is allowed based on security rules and dev mode
 *
 * In production: Only Grafana docs and bundled content
 * In dev mode: Also allows localhost URLs for testing, BUT ONLY if they have valid docs paths
 *
 * @param urlString - The URL to validate
 * @returns true if URL is allowed, false otherwise
 */
export function isAllowedContentUrl(urlString: string): boolean {
  // Bundled content is always allowed
  if (urlString.startsWith('bundled:')) {
    return true;
  }

  // Grafana docs are always allowed
  if (isGrafanaDocsUrl(urlString)) {
    return true;
  }

  // In dev mode, allow localhost URLs for local testing
  // IMPORTANT: Must check that localhost URLs have valid docs paths to avoid
  // intercepting menu items and other UI links that also resolve to localhost
  if (isDevModeEnabled() && isLocalhostUrl(urlString)) {
    const url = parseUrlSafely(urlString);
    if (!url) {
      return false;
    }

    // Only allow localhost URLs with documentation paths
    // Note: Check both /docs and /docs/ to handle URLs with and without trailing slashes
    return (
      url.pathname === '/docs' ||
      url.pathname.startsWith('/docs/') ||
      url.pathname === '/tutorials' ||
      url.pathname.startsWith('/tutorials/') ||
      url.pathname.includes('/learning-journeys/')
    );
  }

  return false;
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
  // Use centralized domain validator to avoid duplication
  if (!isGrafanaDomain(urlString)) {
    return false;
  }

  // Parse URL to check pathname (already validated by isGrafanaDomain)
  const url = parseUrlSafely(urlString);
  if (!url) {
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
 * Check if URL is a github.com URL (not raw.githubusercontent.com)
 *
 * Security: Validates hostname is exactly github.com
 *
 * @param urlString - The URL to validate
 * @returns true if hostname is github.com, false otherwise
 *
 * @example
 * isGitHubUrl('https://github.com/grafana/grafana') // true
 * isGitHubUrl('https://raw.githubusercontent.com/...') // false
 * isGitHubUrl('https://github.com.evil.com/...') // false
 */
export function isGitHubUrl(urlString: string): boolean {
  const url = parseUrlSafely(urlString);
  if (!url) {
    return false;
  }

  // Only allow https protocol for GitHub
  if (url.protocol !== 'https:') {
    return false;
  }

  // Exact hostname match only (prevents subdomain hijacking)
  return url.hostname === 'github.com';
}

/**
 * Check if URL is a raw.githubusercontent.com URL
 *
 * Security: Validates hostname is exactly raw.githubusercontent.com
 * Note: This does NOT check if the repo is in the allowlist - use isAllowedGitHubRawUrl for that
 *
 * @param urlString - The URL to validate
 * @returns true if hostname is raw.githubusercontent.com, false otherwise
 *
 * @example
 * isGitHubRawUrl('https://raw.githubusercontent.com/grafana/...') // true
 * isGitHubRawUrl('https://github.com/grafana/grafana') // false
 * isGitHubRawUrl('https://raw.githubusercontent.com.evil.com/...') // false
 */
export function isGitHubRawUrl(urlString: string): boolean {
  const url = parseUrlSafely(urlString);
  if (!url) {
    return false;
  }

  // Only allow https protocol for GitHub
  if (url.protocol !== 'https:') {
    return false;
  }

  // Exact hostname match only (prevents subdomain hijacking)
  return url.hostname === 'raw.githubusercontent.com';
}

/**
 * Check if URL is any GitHub URL (github.com or raw.githubusercontent.com)
 *
 * Security: Validates hostname is exactly one of the known GitHub domains
 * Note: This does NOT check if the repo is in the allowlist - use isAllowedGitHubRawUrl for that
 *
 * @param urlString - The URL to validate
 * @returns true if hostname is github.com or raw.githubusercontent.com, false otherwise
 *
 * @example
 * isAnyGitHubUrl('https://github.com/grafana/grafana') // true
 * isAnyGitHubUrl('https://raw.githubusercontent.com/grafana/...') // true
 * isAnyGitHubUrl('https://github.com.evil.com/...') // false
 */
export function isAnyGitHubUrl(urlString: string): boolean {
  return isGitHubUrl(urlString) || isGitHubRawUrl(urlString);
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

/**
 * GitHub URL Validator for Tutorial Testing
 * Validates and parses GitHub tree URLs for tutorial directories
 */

export interface URLValidation {
  isValid: boolean;
  errorMessage?: string;
}

/**
 * Validates tutorial URLs for the URL tester component
 * In dev mode, allows localhost URLs for local testing
 * Always allows Grafana docs URLs
 *
 * @param url - The URL to validate
 * @returns Validation result with error message if invalid
 */
export function validateTutorialUrl(url: string): URLValidation {
  if (!url) {
    return {
      isValid: false,
      errorMessage: 'Please provide a URL',
    };
  }

  // Check if it's a valid URL
  let urlObj: URL;
  try {
    urlObj = new URL(url);
  } catch {
    return {
      isValid: false,
      errorMessage: 'Invalid URL format. Please provide a valid URL.',
    };
  }

  const pathParts = urlObj.pathname.split('/').filter(Boolean);

  // In dev mode, allow localhost URLs for testing
  if (isDevModeEnabled() && isLocalhostUrl(url)) {
    // Require /unstyled.html suffix for localhost tutorials
    if (pathParts[pathParts.length - 1] !== 'unstyled.html') {
      return {
        isValid: false,
        errorMessage: 'Localhost tutorial URL must include the /unstyled.html suffix',
      };
    }
    return {
      isValid: true,
    };
  }

  // Allow Grafana docs URLs
  if (isGrafanaDocsUrl(url)) {
    return {
      isValid: true,
    };
  }

  return {
    isValid: false,
    errorMessage: 'URL must be a Grafana docs URL. In dev mode, localhost URLs are also allowed.',
  };
}

/**
 * Validates and parses a GitHub tree URL
 * Expected format: https://github.com/{owner}/{repo}/tree/{branch}/{path}
 *
 * @param url - The GitHub URL to validate
 * @returns Validation result with parsed data or error message
 */
export function validateGitHubUrl(url: string): URLValidation {
  if (!url) {
    return {
      isValid: false,
      errorMessage: 'Please provide a URL',
    };
  }

  // Check if it's a valid URL
  let urlObj: URL;
  try {
    urlObj = new URL(url);
  } catch {
    return {
      isValid: false,
      errorMessage: 'Invalid URL format. Please provide a valid GitHub URL.',
    };
  }

  // Check if it's a GitHub URL
  if (urlObj.hostname !== 'github.com') {
    return {
      isValid: false,
      errorMessage: 'URL must be from github.com',
    };
  }

  // Parse the path: /{owner}/{repo}/tree/{branch}/{path}
  const pathParts = urlObj.pathname.split('/').filter(Boolean);

  // Need at least: owner, repo, tree, branch, path
  if (pathParts.length < 5) {
    return {
      isValid: false,
      errorMessage:
        'URL must be a GitHub tree URL pointing to a directory. Format: github.com/{owner}/{repo}/tree/{branch}/{path}',
    };
  }

  // Check that it's a tree URL (not blob, etc.)
  if (pathParts[2] !== 'tree') {
    return {
      isValid: false,
      errorMessage: 'URL must be a GitHub tree URL (not blob). Use tree URLs that point to directories.',
    };
  }

  // Extract tutorial name from the last path segment
  const tutorialName = pathParts[pathParts.length - 1];

  if (!tutorialName) {
    return {
      isValid: false,
      errorMessage: 'Could not extract tutorial name from URL',
    };
  }

  return {
    isValid: true,
  };
}
