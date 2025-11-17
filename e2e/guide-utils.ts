/**
 * Utility functions for guide type detection and URL handling
 */

/**
 * Check if a guide URL is a bundled guide
 * Bundled guides start with "bundled:" prefix
 * 
 * @param url - The guide URL to check
 * @returns true if the guide is bundled, false otherwise
 */
export function isBundledGuide(url: string): boolean {
  return url.startsWith('bundled:');
}

/**
 * Normalize a guide URL for use in URLTester component
 * URLTester expects GitHub tree URLs in format: https://github.com/{owner}/{repo}/tree/{branch}/{path}
 * 
 * If the URL is already a GitHub tree URL, return as-is
 * If it's a GitHub raw URL, convert to tree URL format
 * If it's a data proxy URL, extract and convert to tree URL format
 * Otherwise, return as-is (for other URL types)
 * 
 * @param url - The guide URL to normalize
 * @returns Normalized URL suitable for URLTester input
 */
export function normalizeGuideUrlForTester(url: string): string {
  // If already a GitHub tree URL, return as-is
  if (url.includes('github.com') && url.includes('/tree/')) {
    return url;
  }

  // If it's a GitHub raw URL, convert to tree URL
  // Example: https://raw.githubusercontent.com/grafana/interactive-tutorials/main/path/unstyled.html
  // -> https://github.com/grafana/interactive-tutorials/tree/main/path
  const rawMatch = url.match(/https?:\/\/raw\.githubusercontent\.com\/([^\/]+)\/([^\/]+)\/([^\/]+)\/(.+)\/unstyled\.html/);
  if (rawMatch) {
    const [, owner, repo, branch, path] = rawMatch;
    return `https://github.com/${owner}/${repo}/tree/${branch}/${path}`;
  }

  // If it's a data proxy URL, extract the GitHub raw URL and convert
  // Example: api/plugin-proxy/grafana-pathfinder-app/github-raw/path/unstyled.html
  // This is trickier - we'd need to know the base URL, but for now, try to extract what we can
  const proxyMatch = url.match(/api\/plugin-proxy\/[^\/]+\/github-raw\/(.+)\/unstyled\.html/);
  if (proxyMatch) {
    const [, path] = proxyMatch;
    // Assume standard grafana/interactive-tutorials repo and main branch
    // This is a best-effort conversion
    return `https://github.com/grafana/interactive-tutorials/tree/main/${path}`;
  }

  // For other URL types (including direct HTML URLs), return as-is
  // URLTester's "Other" tab can handle these
  return url;
}

