/**
 * Grafana Data Proxy Utilities
 *
 * Provides utilities for routing requests through Grafana's data proxy to avoid CORS issues.
 * The data proxy routes requests from the browser through the Grafana backend to external services.
 *
 * Security: All proxy requests must still pass the same security validation as direct requests
 * (ALLOWED_GITHUB_REPOS, branch/ref validation, etc.)
 */

import pluginJson from '../plugin.json';
import { ALLOWED_GITHUB_REPOS } from '../constants';
import { parseUrlSafely } from '../security';

/**
 * Plugin ID from plugin.json metadata
 */
export const PLUGIN_ID = pluginJson.id;

/**
 * Data proxy route paths configured in plugin.json
 *
 * SECURITY: Routes are configured with specific paths to limit backend access
 * - github-raw: Points to https://raw.githubusercontent.com/grafana/interactive-tutorials/main
 *   Only allows access to the interactive-tutorials repo's main branch
 */
export const DATA_PROXY_ROUTES = {
  GITHUB_RAW: 'github-raw',
} as const;

/**
 * Construct a data proxy URL for the given path
 *
 * Format: api/plugin-proxy/{PLUGIN_ID}/{route}/{path}
 * Note: NO leading slash as per Grafana documentation
 *
 * @param route - The route name from plugin.json (e.g., 'github-raw')
 * @param path - The path to append after the route (e.g., 'grafana/repo/main/file.html')
 * @returns Full data proxy URL
 *
 * @example
 * getDataProxyUrl('github-raw', 'grafana/interactive-tutorials/main/tutorial.html')
 * // Returns: 'api/plugin-proxy/grafana-pathfinder-app/github-raw/grafana/interactive-tutorials/main/tutorial.html'
 */
export function getDataProxyUrl(route: string, path: string): string {
  // Remove leading slash from path if present
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  return `api/plugin-proxy/${PLUGIN_ID}/${route}/${cleanPath}`;
}

/**
 * Convert a GitHub raw URL to a data proxy URL
 *
 * SECURITY: Only converts URLs from allowed repositories with allowed refs
 * The proxy route is configured to point to /grafana/interactive-tutorials/main/
 * so we only append the file path after that base
 *
 * Format: https://raw.githubusercontent.com/grafana/interactive-tutorials/main/{path}
 *         → api/plugin-proxy/{PLUGIN_ID}/github-raw/{path}
 *
 * @param githubRawUrl - The GitHub raw URL to convert
 * @returns Data proxy URL, or null if invalid/not allowed
 *
 * @example
 * convertGitHubRawToProxyUrl('https://raw.githubusercontent.com/grafana/interactive-tutorials/main/explore-drilldowns-101/unstyled.html')
 * // Returns: 'api/plugin-proxy/grafana-pathfinder-app/github-raw/explore-drilldowns-101/unstyled.html'
 */
export function convertGitHubRawToProxyUrl(githubRawUrl: string): string | null {
  const url = parseUrlSafely(githubRawUrl);
  if (!url) {
    return null;
  }

  // Only convert raw.githubusercontent.com URLs
  if (url.hostname !== 'raw.githubusercontent.com') {
    return null;
  }

  // Parse pathname: /{owner}/{repo}/{ref}/{path...}
  // Example: /grafana/interactive-tutorials/main/tutorial.html
  const pathParts = url.pathname.split('/').filter(Boolean);

  if (pathParts.length < 4) {
    // Need at least: owner, repo, ref, and some file path
    return null;
  }

  const owner = pathParts[0];
  const repo = pathParts[1];
  const ref = pathParts[2];
  const repoPath = `/${owner}/${repo}/`;

  // Extract the file path after owner/repo/ref
  const filePath = pathParts.slice(3).join('/');

  // SECURITY: Validate against allowed repositories
  const allowedRepo = ALLOWED_GITHUB_REPOS.find((allowed) => allowed.repo === repoPath);
  if (!allowedRepo) {
    return null;
  }

  // SECURITY: Validate ref (branch/tag)
  if (!allowedRepo.allowedRefs.includes(ref)) {
    return null;
  }

  // SECURITY: Route is configured to /grafana/interactive-tutorials/main/
  // So we only append the file path, not the owner/repo/ref
  return getDataProxyUrl(DATA_PROXY_ROUTES.GITHUB_RAW, filePath);
}

/**
 * Check if a URL is a data proxy URL
 *
 * Data proxy URLs follow the pattern: api/plugin-proxy/{PLUGIN_ID}/{route}/...
 * Note: Can be with or without leading slash, and can be absolute or relative
 *
 * @param urlString - The URL to check
 * @returns true if URL is a data proxy URL, false otherwise
 *
 * @example
 * isDataProxyUrl('api/plugin-proxy/grafana-pathfinder-app/github-raw/file.html') // true
 * isDataProxyUrl('/api/plugin-proxy/grafana-pathfinder-app/github-raw/file.html') // true
 * isDataProxyUrl('http://localhost:3000/api/plugin-proxy/grafana-pathfinder-app/github-raw/file.html') // true
 */
export function isDataProxyUrl(urlString: string): boolean {
  if (!urlString) {
    return false;
  }

  // Handle absolute URLs - extract just the pathname
  let pathToCheck = urlString;
  if (urlString.startsWith('http://') || urlString.startsWith('https://')) {
    try {
      const url = new URL(urlString);
      pathToCheck = url.pathname;
    } catch {
      return false;
    }
  }

  // Normalize by removing leading slash if present
  const normalized = pathToCheck.startsWith('/') ? pathToCheck.slice(1) : pathToCheck;

  // Data proxy URLs start with api/plugin-proxy/
  if (!normalized.startsWith('api/plugin-proxy/')) {
    return false;
  }

  // Check if it includes our plugin ID
  const proxyPrefix = `api/plugin-proxy/${PLUGIN_ID}/`;
  return normalized.startsWith(proxyPrefix);
}

/**
 * Extract the original GitHub raw URL from a data proxy URL
 *
 * This is useful for logging and debugging purposes
 * The route is configured to /grafana/interactive-tutorials/main/ so we reconstruct the full URL
 *
 * @param dataProxyUrl - The data proxy URL
 * @returns Original GitHub raw URL, or null if not a valid GitHub proxy URL
 *
 * @example
 * extractGitHubRawUrl('api/plugin-proxy/grafana-pathfinder-app/github-raw/explore-drilldowns-101/unstyled.html')
 * // Returns: 'https://raw.githubusercontent.com/grafana/interactive-tutorials/main/explore-drilldowns-101/unstyled.html'
 */
export function extractGitHubRawUrl(dataProxyUrl: string): string | null {
  if (!isDataProxyUrl(dataProxyUrl)) {
    return null;
  }

  // Handle absolute URLs - extract just the pathname
  let pathToCheck = dataProxyUrl;
  if (dataProxyUrl.startsWith('http://') || dataProxyUrl.startsWith('https://')) {
    try {
      const url = new URL(dataProxyUrl);
      pathToCheck = url.pathname;
    } catch {
      return null;
    }
  }

  // Normalize by removing leading slash if present
  const normalized = pathToCheck.startsWith('/') ? pathToCheck.slice(1) : pathToCheck;

  const proxyPrefix = `api/plugin-proxy/${PLUGIN_ID}/${DATA_PROXY_ROUTES.GITHUB_RAW}/`;
  if (!normalized.startsWith(proxyPrefix)) {
    return null;
  }

  // Extract the file path after the route
  const filePath = normalized.slice(proxyPrefix.length);

  // Reconstruct the full GitHub URL with the base path configured in plugin.json
  return `https://raw.githubusercontent.com/grafana/interactive-tutorials/main/${filePath}`;
}
