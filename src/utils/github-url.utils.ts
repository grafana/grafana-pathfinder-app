/**
 * Shared utilities for GitHub URL conversion
 * Eliminates duplication between content-fetcher and custom docs fetcher
 */

/**
 * Convert GitHub tree/blob URLs to raw content URLs
 * Handles multiple GitHub URL formats for content access
 */
export function convertGitHubUrlToRaw(githubUrl: string): string {
  try {
    // Handle GitHub tree URLs: https://github.com/owner/repo/tree/branch/path
    const treeMatch = githubUrl.match(/https:\/\/github\.com\/([^\/]+)\/([^\/]+)\/tree\/([^\/]+)\/(.+)/);
    if (treeMatch) {
      const [, owner, repo, branch, path] = treeMatch;
      return `https://raw.githubusercontent.com/${owner}/${repo}/refs/heads/${branch}/${path}/unstyled.html`;
    }

    // Handle GitHub blob URLs: https://github.com/owner/repo/blob/branch/path/file
    const blobMatch = githubUrl.match(/https:\/\/github\.com\/([^\/]+)\/([^\/]+)\/blob\/([^\/]+)\/(.+)/);
    if (blobMatch) {
      const [, owner, repo, branch, path] = blobMatch;
      return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
    }

    // Handle direct GitHub repo URLs: https://github.com/owner/repo
    const repoMatch = githubUrl.match(/https:\/\/github\.com\/([^\/]+)\/([^\/]+)(?:\/)?$/);
    if (repoMatch) {
      const [, owner, repo] = repoMatch;
      return `https://raw.githubusercontent.com/${owner}/${repo}/main/unstyled.html`;
    }

    // If already raw, return as-is
    if (githubUrl.includes('raw.githubusercontent.com')) {
      return githubUrl;
    }

    // Fallback: return original URL
    return githubUrl;
  } catch (error) {
    console.warn('Failed to convert GitHub URL to raw format:', githubUrl, error);
    return githubUrl;
  }
}

/**
 * Convert GitHub URLs to index.json URLs for metadata fetching
 * Specialized version for fetching repository index files
 */
export function convertToRawIndexUrl(repoUrl: string): string {
  try {
    // Handle GitHub tree URLs: https://github.com/owner/repo/tree/branch/path
    const treeMatch = repoUrl.match(/https:\/\/github\.com\/([^\/]+)\/([^\/]+)\/tree\/([^\/]+)(?:\/(.*))?/);
    if (treeMatch) {
      const [, owner, repo, branch, path = ''] = treeMatch;
      const basePath = path ? `${path}/` : '';
      return `https://raw.githubusercontent.com/${owner}/${repo}/refs/heads/${branch}/${basePath}index.json`;
    }

    // Handle GitHub blob URLs: https://github.com/owner/repo/blob/branch/path/file
    const blobMatch = repoUrl.match(/https:\/\/github\.com\/([^\/]+)\/([^\/]+)\/blob\/([^\/]+)\/(.+)/);
    if (blobMatch) {
      const [, owner, repo, branch, path] = blobMatch;
      // Extract directory path and append index.json
      const dirPath = path.substring(0, path.lastIndexOf('/'));
      return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${dirPath}/index.json`;
    }

    // Handle direct GitHub repo URLs: https://github.com/owner/repo
    const repoMatch = repoUrl.match(/https:\/\/github\.com\/([^\/]+)\/([^\/]+)(?:\/)?$/);
    if (repoMatch) {
      const [, owner, repo] = repoMatch;
      return `https://raw.githubusercontent.com/${owner}/${repo}/main/index.json`;
    }

    // Handle raw.githubusercontent.com URLs (already raw)
    if (repoUrl.includes('raw.githubusercontent.com')) {
      // If it's already a raw URL, just ensure it points to index.json
      if (repoUrl.endsWith('/index.json')) {
        return repoUrl;
      }
      return `${repoUrl.replace(/\/$/, '')}/index.json`;
    }

    // Fallback: assume it's a direct URL to index.json
    if (repoUrl.endsWith('/index.json')) {
      return repoUrl;
    }
    return `${repoUrl.replace(/\/$/, '')}/index.json`;
  } catch (error) {
    console.warn('Failed to convert GitHub URL to raw index.json URL:', repoUrl, error);
    return `${repoUrl.replace(/\/$/, '')}/index.json`;
  }
}

/**
 * Generate GitHub raw content URL variations to try (legacy support)
 * Used by content-fetcher for fallback URL generation
 */
export function generateGitHubVariations(url: string): string[] {
  const variations: string[] = [];

  // Only try GitHub variations for GitHub URLs
  if (url.includes('github.com') || url.includes('raw.githubusercontent.com')) {
    // If it's a regular GitHub URL, try converting to raw.githubusercontent.com first (more targeted)
    if (url.includes('github.com') && !url.includes('raw.githubusercontent.com')) {
      // Handle tree URLs (directories) - convert to directory/unstyled.html
      const treeMatch = url.match(/https:\/\/github\.com\/([^\/]+)\/([^\/]+)\/tree\/([^\/]+)\/(.+)/);
      if (treeMatch) {
        const [_fullMatch, owner, repo, branch, path] = treeMatch;
        const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/refs/heads/${branch}/${path}/unstyled.html`;
        variations.push(rawUrl);
      }

      // Handle blob URLs (specific files)
      const blobMatch = url.match(/https:\/\/github\.com\/([^\/]+)\/([^\/]+)\/blob\/([^\/]+)\/(.+)/);
      if (blobMatch) {
        const [_fullMatch, owner, repo, branch, path] = blobMatch;
        const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
        variations.push(rawUrl);

        // Also try unstyled version of raw URL
        if (!rawUrl.includes('/unstyled.html')) {
          variations.push(`${rawUrl}/unstyled.html`);
        }
      }
    }

    // Generic fallback: try unstyled.html version (only if no specific conversion worked)
    if (!url.includes('/unstyled.html') && variations.length === 0) {
      variations.push(`${url.replace(/\/$/, '')}/unstyled.html`);
    }
  }

  return variations;
}
