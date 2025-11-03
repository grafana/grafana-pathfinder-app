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
import { parseUrlSafely } from './url-validator';

/**
 * Plugin ID from plugin.json metadata
 */
export const PLUGIN_ID = pluginJson.id;

/**
 * Data proxy route paths configured in plugin.json
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
 * Format: https://raw.githubusercontent.com/{owner}/{repo}/{ref}/{path}
 *         → /api/plugin-proxy/{PLUGIN_ID}/github-raw/{owner}/{repo}/{ref}/{path}
 *
 * @param githubRawUrl - The GitHub raw URL to convert
 * @returns Data proxy URL, or null if invalid/not allowed
 *
 * @example
 * convertGitHubRawToProxyUrl('https://raw.githubusercontent.com/grafana/interactive-tutorials/main/tutorial.html')
 * // Returns: '/api/plugin-proxy/grafana-pathfinder-app/github-raw/grafana/interactive-tutorials/main/tutorial.html'
 */
export function convertGitHubRawToProxyUrl(githubRawUrl: string): string | null {
  console.warn(`[convertGitHubRawToProxyUrl] Input URL: ${githubRawUrl}`);
  
  const url = parseUrlSafely(githubRawUrl);
  if (!url) {
    console.warn(`[convertGitHubRawToProxyUrl] Failed to parse URL`);
    return null;
  }

  // Only convert raw.githubusercontent.com URLs
  if (url.hostname !== 'raw.githubusercontent.com') {
    console.warn(`[convertGitHubRawToProxyUrl] Not a raw.githubusercontent.com URL, hostname: ${url.hostname}`);
    return null;
  }

  // Parse pathname: /{owner}/{repo}/{ref}/{path...}
  // Example: /grafana/interactive-tutorials/main/tutorial.html
  const pathParts = url.pathname.split('/').filter(Boolean);
  console.warn(`[convertGitHubRawToProxyUrl] Path parts:`, pathParts);

  if (pathParts.length < 3) {
    // Need at least: owner, repo, ref
    console.warn(`[convertGitHubRawToProxyUrl] Not enough path parts (need at least 3): ${pathParts.length}`);
    return null;
  }

  const owner = pathParts[0];
  const repo = pathParts[1];
  const ref = pathParts[2];
  const repoPath = `/${owner}/${repo}/`;

  console.warn(`[convertGitHubRawToProxyUrl] Parsed: owner=${owner}, repo=${repo}, ref=${ref}, repoPath=${repoPath}`);

  // SECURITY: Validate against allowed repositories
  const allowedRepo = ALLOWED_GITHUB_REPOS.find((allowed) => allowed.repo === repoPath);
  if (!allowedRepo) {
    console.warn(`[convertGitHubRawToProxyUrl] Repository not in allowlist: ${repoPath}`);
    console.warn(`[convertGitHubRawToProxyUrl] Allowed repos:`, ALLOWED_GITHUB_REPOS);
    return null;
  }

  // SECURITY: Validate ref (branch/tag)
  if (!allowedRepo.allowedRefs.includes(ref)) {
    console.warn(`[convertGitHubRawToProxyUrl] Ref not allowed for repository ${repoPath}: ${ref}`);
    console.warn(`[convertGitHubRawToProxyUrl] Allowed refs:`, allowedRepo.allowedRefs);
    return null;
  }

  // Construct the path for the proxy: {owner}/{repo}/{ref}/{path...}
  // Remove the leading slash from pathname
  const proxyPath = url.pathname.slice(1);
  const proxyUrl = getDataProxyUrl(DATA_PROXY_ROUTES.GITHUB_RAW, proxyPath);
  
  console.warn(`[convertGitHubRawToProxyUrl] SUCCESS - Generated proxy URL: ${proxyUrl}`);
  return proxyUrl;
}

/**
 * Check if a URL is a data proxy URL
 *
 * Data proxy URLs follow the pattern: api/plugin-proxy/{PLUGIN_ID}/{route}/...
 * Note: Can be with or without leading slash
 *
 * @param urlString - The URL to check
 * @returns true if URL is a data proxy URL, false otherwise
 *
 * @example
 * isDataProxyUrl('api/plugin-proxy/grafana-pathfinder-app/github-raw/grafana/repo/main/file.html') // true
 * isDataProxyUrl('/api/plugin-proxy/grafana-pathfinder-app/github-raw/grafana/repo/main/file.html') // true (also accepted)
 * isDataProxyUrl('https://raw.githubusercontent.com/grafana/repo/main/file.html') // false
 */
export function isDataProxyUrl(urlString: string): boolean {
  if (!urlString) {
    return false;
  }

  // Normalize by removing leading slash if present
  const normalized = urlString.startsWith('/') ? urlString.slice(1) : urlString;

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
 *
 * @param dataProxyUrl - The data proxy URL
 * @returns Original GitHub raw URL, or null if not a valid GitHub proxy URL
 *
 * @example
 * extractGitHubRawUrl('api/plugin-proxy/grafana-pathfinder-app/github-raw/grafana/repo/main/file.html')
 * // Returns: 'https://raw.githubusercontent.com/grafana/repo/main/file.html'
 */
export function extractGitHubRawUrl(dataProxyUrl: string): string | null {
  if (!isDataProxyUrl(dataProxyUrl)) {
    return null;
  }

  // Normalize by removing leading slash if present
  const normalized = dataProxyUrl.startsWith('/') ? dataProxyUrl.slice(1) : dataProxyUrl;

  const proxyPrefix = `api/plugin-proxy/${PLUGIN_ID}/${DATA_PROXY_ROUTES.GITHUB_RAW}/`;
  if (!normalized.startsWith(proxyPrefix)) {
    return null;
  }

  // Extract the path after the route
  const path = normalized.slice(proxyPrefix.length);

  return `https://raw.githubusercontent.com/${path}`;
}

