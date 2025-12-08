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

import { isDevModeEnabledGlobal } from '../utils/dev-mode';
import { ALLOWED_GRAFANA_DOCS_HOSTNAMES, ALLOWED_INTERACTIVE_LEARNING_HOSTNAMES } from '../constants';

/**
 * Check if URL uses HTTPS protocol
 *
 * @param url - Parsed URL object
 * @returns true if protocol is https:
 */
function requiresHttps(url: URL): boolean {
  return url.protocol === 'https:';
}

/**
 * Check if URL uses HTTP or HTTPS protocol
 *
 * @param url - Parsed URL object
 * @returns true if protocol is http: or https:
 */
function allowsHttpOrHttps(url: URL): boolean {
  return url.protocol === 'http:' || url.protocol === 'https:';
}

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
  if (!allowsHttpOrHttps(url)) {
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
 * In production: Only Grafana docs, interactive learning domains, and bundled content
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

  // Interactive learning domains are always allowed
  if (isInteractiveLearningUrl(urlString)) {
    return true;
  }

  // In dev mode, allow localhost URLs for local testing
  // IMPORTANT: Must check that localhost URLs have valid docs paths to avoid
  // intercepting menu items and other UI links that also resolve to localhost
  const url = parseUrlSafely(urlString);
  if (isDevModeEnabledGlobal() && isLocalhostUrl(urlString)) {
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
  if (!requiresHttps(url)) {
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
 * Check if URL is a valid Vimeo domain
 *
 * Security: Validates hostname is an exact match to known Vimeo domains
 *
 * @param urlString - The URL to validate
 * @returns true if valid Vimeo URL, false otherwise
 *
 * @example
 * isVimeoDomain('https://player.vimeo.com/video/123456') // true
 * isVimeoDomain('https://vimeo.com.evil.com/video/') // false
 */
export function isVimeoDomain(urlString: string): boolean {
  const url = parseUrlSafely(urlString);
  if (!url) {
    return false;
  }

  // Only allow https protocol
  if (!requiresHttps(url)) {
    return false;
  }

  // Exact hostname matching (no subdomain wildcards)
  const allowedHosts = [
    'player.vimeo.com',
    'vimeo.com',
    'www.vimeo.com',
    'vimeocdn.com', // CDN domain for Vimeo scripts
    'f.vimeocdn.com', // Froogaloop API domain
  ];

  return allowedHosts.includes(url.hostname);
}

/**
 * Check if URL is a valid Grafana domain (for general use, not just docs)
 *
 * Security: Uses exact hostname matching from ALLOWED_GRAFANA_DOCS_HOSTNAMES
 * NO wildcard subdomains to prevent subdomain takeover attacks
 *
 * @param urlString - The URL to validate
 * @returns true if hostname is in the allowlist
 */
export function isGrafanaDomain(urlString: string): boolean {
  const url = parseUrlSafely(urlString);
  if (!url) {
    return false;
  }

  // Only allow http and https protocols
  if (!allowsHttpOrHttps(url)) {
    return false;
  }

  // Check hostname is in allowlist (exact match only, no subdomains)
  return ALLOWED_GRAFANA_DOCS_HOSTNAMES.includes(url.hostname);
}

/**
 * Check if URL is from the interactive learning domains
 *
 * Security: Validates hostname is exactly one of the allowed interactive learning domains
 * NO wildcard subdomains to prevent subdomain takeover attacks
 *
 * @param urlString - The URL to validate
 * @returns true if valid interactive learning URL, false otherwise
 *
 * @example
 * isInteractiveLearningUrl('https://interactive-learning.grafana.net/guide/') // true
 * isInteractiveLearningUrl('https://interactive-learning.grafana-dev.net/guide/') // true
 * isInteractiveLearningUrl('https://interactive-learning.grafana.net.evil.com/') // false
 */
export function isInteractiveLearningUrl(urlString: string): boolean {
  const url = parseUrlSafely(urlString);
  if (!url) {
    return false;
  }

  // Only allow https protocol
  if (url.protocol !== 'https:') {
    return false;
  }

  // Check hostname is in allowlist (exact match only, no subdomains)
  return ALLOWED_INTERACTIVE_LEARNING_HOSTNAMES.includes(url.hostname);
}

/**
 * Check if URL is a GitHub raw content URL (DEV MODE ONLY)
 *
 * Security: This function is ONLY used in dev mode to allow testing with GitHub content.
 * In production, GitHub URLs are not allowed.
 *
 * @param urlString - The URL to validate
 * @returns true if valid GitHub raw URL, false otherwise
 */
export function isGitHubRawUrl(urlString: string): boolean {
  const url = parseUrlSafely(urlString);
  if (!url) {
    return false;
  }

  // Only allow https protocol
  if (url.protocol !== 'https:') {
    return false;
  }

  // Allow raw.githubusercontent.com for raw content
  return url.hostname === 'raw.githubusercontent.com';
}

export interface UrlValidation {
  isValid: boolean;
  errorMessage?: string;
}

/**
 * Validates tutorial URLs for the URL tester component
 * In dev mode, allows localhost URLs for local testing
 * Always allows Grafana docs URLs and interactive learning URLs
 *
 * @param url - The URL to validate
 * @returns Validation result with error message if invalid
 */
export function validateTutorialUrl(url: string): UrlValidation {
  if (!url) {
    return {
      isValid: false,
      errorMessage: 'Please provide a URL',
    };
  }

  // Check for valid URL format early
  const parsedUrl = parseUrlSafely(url);
  if (!parsedUrl) {
    return {
      isValid: false,
      errorMessage: 'Invalid URL format',
    };
  }

  // In dev mode, allow localhost URLs for testing
  // Note: The content fetcher automatically appends /unstyled.html suffix when needed
  if (isDevModeEnabledGlobal() && isLocalhostUrl(url)) {
    return {
      isValid: true,
    };
  }

  // In dev mode, allow GitHub raw URLs for testing
  if (isDevModeEnabledGlobal() && isGitHubRawUrl(url)) {
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

  // Allow interactive learning URLs
  if (isInteractiveLearningUrl(url)) {
    return {
      isValid: true,
    };
  }

  return {
    isValid: false,
    errorMessage:
      'URL must be a Grafana docs URL or interactive learning URL. In dev mode, localhost and GitHub raw URLs are also allowed.',
  };
}
