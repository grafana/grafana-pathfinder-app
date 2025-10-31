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

import { isDevModeEnabledGlobal } from './dev-mode';
import { ALLOWED_GRAFANA_DOCS_HOSTNAMES } from '../constants';

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
  if (url.protocol !== 'https:') {
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
 * Check if URL is a valid GitHub raw content URL from allowed repositories
 *
 * SECURITY: Validates both repository AND branch/ref to prevent PR/commit-based attacks
 * Format: https://raw.githubusercontent.com/{owner}/{repo}/{ref}/{path}
 *
 * @param urlString - The URL to validate
 * @param allowedRepos - Array of allowed repos with specific branches/refs
 * @returns true if valid GitHub URL from allowed repo AND ref, false otherwise
 */
export function isAllowedGitHubRawUrl(
  urlString: string,
  allowedRepos: Array<{ repo: string; allowedRefs: string[] }>
): boolean {
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

  // Parse pathname: /{owner}/{repo}/{ref}/{path...}
  // Example: /grafana/interactive-tutorials/main/tutorial.md
  const pathParts = url.pathname.split('/').filter(Boolean);

  if (pathParts.length < 3) {
    // Need at least: owner, repo, ref
    return false;
  }

  const owner = pathParts[0];
  const repo = pathParts[1];
  const ref = pathParts[2];
  const repoPath = `/${owner}/${repo}/`;

  // Find matching allowed repository
  const allowedRepo = allowedRepos.find((allowed) => allowed.repo === repoPath);

  if (!allowedRepo) {
    return false;
  }

  // CRITICAL SECURITY CHECK: Validate the ref (branch/tag/commit)
  // This prevents attackers from using PR branches or malicious commits
  return allowedRepo.allowedRefs.includes(ref);
}

/**
 * Check if a jsDelivr CDN URL is allowed based on GitHub repository allowlist
 *
 * SECURITY: jsDelivr URLs must map to the same approved GitHub repos as raw.githubusercontent.com
 * This prevents using jsDelivr as a backdoor to bypass GitHub repo restrictions
 *
 * Format: https://cdn.jsdelivr.net/gh/{owner}/{repo}@{ref}/{path}
 *
 * @param urlString - The jsDelivr URL to validate
 * @param allowedRepos - Array of allowed GitHub repositories with permitted refs
 * @returns true if jsDelivr URL maps to an allowed GitHub repo/ref, false otherwise
 */
export function isAllowedJsDelivrUrl(
  urlString: string,
  allowedRepos: Array<{ repo: string; allowedRefs: string[] }>
): boolean {
  const url = parseUrlSafely(urlString);
  if (!url) {
    return false;
  }

  // SECURITY (F3): Only allow https protocol
  if (url.protocol !== 'https:') {
    return false;
  }

  // SECURITY: Check hostname is exactly cdn.jsdelivr.net
  if (url.hostname !== 'cdn.jsdelivr.net') {
    return false;
  }

  // SECURITY: Only allow GitHub content (/gh/ prefix)
  // This blocks npm packages, WordPress plugins, etc.
  if (!url.pathname.startsWith('/gh/')) {
    return false;
  }

  // Parse pathname: /gh/{owner}/{repo}@{ref}/{path...}
  // Example: /gh/grafana/interactive-tutorials@main/tutorial.md
  const pathWithoutPrefix = url.pathname.slice(4); // Remove '/gh/'
  const pathParts = pathWithoutPrefix.split('/').filter(Boolean);

  if (pathParts.length < 2) {
    // Need at least: owner, repo@ref
    return false;
  }

  const owner = pathParts[0]; // 'grafana'
  const repoAndRef = pathParts[1]; // 'interactive-tutorials@main'

  // Split by '@' to get repo and ref
  const atIndex = repoAndRef.indexOf('@');
  if (atIndex === -1) {
    return false; // Must have @ref
  }

  const repo = repoAndRef.slice(0, atIndex); // 'interactive-tutorials'
  const ref = repoAndRef.slice(atIndex + 1); // 'main'

  const repoPath = `/${owner}/${repo}/`; // '/grafana/interactive-tutorials/'

  // Find matching allowed repository
  const allowedRepo = allowedRepos.find((allowed) => allowed.repo === repoPath);

  if (!allowedRepo) {
    return false;
  }

  // CRITICAL SECURITY CHECK: Validate the ref (branch/tag) same as raw GitHub
  // This prevents attackers from using PR branches or malicious commits via jsDelivr
  return allowedRepo.allowedRefs.includes(ref);
}

/**
 * Detect if current browser needs CORS proxy for GitHub raw content
 *
 * Chrome: Works with raw.githubusercontent.com (no CORS issues)
 * Firefox/Safari: Need jsDelivr CDN for CORS headers
 *
 * @returns true if browser needs CORS proxy (Firefox/Safari), false otherwise (Chrome)
 */
export function browserNeedsCorsProxy(): boolean {
  const userAgent = navigator.userAgent.toLowerCase();

  // Detect Firefox
  if (userAgent.includes('firefox')) {
    return true;
  }

  // Detect Safari (but not Chrome, which also contains 'safari' in UA)
  if (userAgent.includes('safari') && !userAgent.includes('chrome') && !userAgent.includes('chromium')) {
    return true;
  }

  // Chrome and Chromium-based browsers don't need proxy
  return false;
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
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return false;
  }

  // Check hostname is in allowlist (exact match only, no subdomains)
  return ALLOWED_GRAFANA_DOCS_HOSTNAMES.includes(url.hostname);
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
  if (isDevModeEnabledGlobal() && isLocalhostUrl(url)) {
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
