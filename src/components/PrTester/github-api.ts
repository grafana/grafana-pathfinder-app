/**
 * GitHub API utilities for PR Tester
 *
 * Provides URL parsing and API fetch functions to retrieve
 * content.json files from GitHub pull requests.
 */

/** Parsed GitHub PR URL components */
export interface ParsedPrUrl {
  owner: string;
  repo: string;
  prNumber: number;
}

/** Content file metadata from a PR */
export interface PrContentFile {
  directoryName: string;
  rawUrl: string;
  status: 'added' | 'modified' | 'removed' | 'renamed' | 'unchanged';
}

/** Error types for GitHub API operations */
export type GitHubApiError =
  | { type: 'invalid_url'; message: string }
  | { type: 'not_found'; message: string }
  | { type: 'rate_limited'; message: string }
  | { type: 'network_error'; message: string }
  | { type: 'api_error'; message: string; status: number }
  | { type: 'no_files'; message: string };

/** Result type for PR content file fetching */
export type FetchPrFilesResult =
  | { success: true; files: PrContentFile[] }
  | { success: false; error: GitHubApiError };

// Pattern to extract owner, repo, and PR number from GitHub PR URL
const PR_URL_PATTERN = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/;

/**
 * Parse a GitHub PR URL and extract components
 *
 * @param url - GitHub PR URL (e.g., https://github.com/grafana/interactive-tutorials/pull/70)
 * @returns Parsed components or null if invalid
 *
 * @example
 * parsePrUrl('https://github.com/grafana/interactive-tutorials/pull/70')
 * // Returns: { owner: 'grafana', repo: 'interactive-tutorials', prNumber: 70 }
 */
export function parsePrUrl(url: string): ParsedPrUrl | null {
  const match = url.match(PR_URL_PATTERN);
  if (!match) {
    return null;
  }

  const [, owner, repo, prNumberStr] = match;
  const prNumber = parseInt(prNumberStr, 10);

  if (isNaN(prNumber) || prNumber <= 0) {
    return null;
  }

  return { owner, repo, prNumber };
}

/**
 * Validate a PR URL format without making API calls
 *
 * @param url - URL to validate
 * @returns true if URL matches expected PR URL format
 */
export function isValidPrUrl(url: string): boolean {
  return parsePrUrl(url) !== null;
}

/**
 * Extract directory name from a content.json file path
 *
 * @param filePath - File path (e.g., "connect-metrics-data/content.json")
 * @returns Directory name (e.g., "connect-metrics-data")
 */
function extractDirectoryName(filePath: string): string {
  // Remove the content.json suffix and any trailing slashes
  return filePath.replace(/\/?content\.json$/, '').split('/').filter(Boolean).join('/') || filePath;
}

/**
 * Fetch content.json files from a GitHub PR
 *
 * Makes two sequential GitHub API calls:
 * 1. GET /repos/{owner}/{repo}/pulls/{number} - Get head SHA
 * 2. GET /repos/{owner}/{repo}/pulls/{number}/files - Get changed files
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param prNumber - Pull request number
 * @returns Result containing files or error
 */
export async function fetchPrContentFiles(
  owner: string,
  repo: string,
  prNumber: number
): Promise<FetchPrFilesResult> {
  const baseUrl = 'https://api.github.com';

  try {
    // Step 1: Fetch PR metadata to get head SHA
    const prResponse = await fetch(`${baseUrl}/repos/${owner}/${repo}/pulls/${prNumber}`, {
      headers: {
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (prResponse.status === 404) {
      return {
        success: false,
        error: {
          type: 'not_found',
          message: 'PR not found. Check the URL or ensure the repo is public.',
        },
      };
    }

    if (prResponse.status === 403) {
      const rateLimitRemaining = prResponse.headers.get('X-RateLimit-Remaining');
      if (rateLimitRemaining === '0') {
        return {
          success: false,
          error: {
            type: 'rate_limited',
            message: 'GitHub API rate limit exceeded. Try again later.',
          },
        };
      }
    }

    if (!prResponse.ok) {
      return {
        success: false,
        error: {
          type: 'api_error',
          message: `Failed to fetch PR: ${prResponse.status}`,
          status: prResponse.status,
        },
      };
    }

    const prData = await prResponse.json();
    const headSha = prData.head?.sha;

    if (!headSha) {
      return {
        success: false,
        error: {
          type: 'api_error',
          message: 'Could not determine PR head SHA',
          status: 0,
        },
      };
    }

    // Step 2: Fetch PR files list
    const filesResponse = await fetch(`${baseUrl}/repos/${owner}/${repo}/pulls/${prNumber}/files`, {
      headers: {
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (filesResponse.status === 403) {
      const rateLimitRemaining = filesResponse.headers.get('X-RateLimit-Remaining');
      if (rateLimitRemaining === '0') {
        return {
          success: false,
          error: {
            type: 'rate_limited',
            message: 'GitHub API rate limit exceeded. Try again later.',
          },
        };
      }
    }

    if (!filesResponse.ok) {
      return {
        success: false,
        error: {
          type: 'api_error',
          message: `Failed to fetch PR files: ${filesResponse.status}`,
          status: filesResponse.status,
        },
      };
    }

    const filesData = await filesResponse.json();

    // Filter for content.json files and construct raw URLs
    const contentFiles: PrContentFile[] = filesData
      .filter((file: { filename: string }) => file.filename.endsWith('content.json'))
      .map((file: { filename: string; status: string }) => ({
        directoryName: extractDirectoryName(file.filename),
        rawUrl: `https://raw.githubusercontent.com/${owner}/${repo}/${headSha}/${file.filename}`,
        status: file.status as PrContentFile['status'],
      }));

    if (contentFiles.length === 0) {
      return {
        success: false,
        error: {
          type: 'no_files',
          message: 'No content.json files found in this PR',
        },
      };
    }

    return {
      success: true,
      files: contentFiles,
    };
  } catch (error) {
    // Network errors (offline, DNS failure, etc.)
    return {
      success: false,
      error: {
        type: 'network_error',
        message: 'Network error. Check your connection and try again.',
      },
    };
  }
}

/**
 * Fetch PR content files from a PR URL string
 *
 * Convenience function that combines URL parsing and API fetching.
 *
 * @param prUrl - GitHub PR URL
 * @returns Result containing files or error
 */
export async function fetchPrContentFilesFromUrl(prUrl: string): Promise<FetchPrFilesResult> {
  const parsed = parsePrUrl(prUrl);

  if (!parsed) {
    return {
      success: false,
      error: {
        type: 'invalid_url',
        message: 'Invalid PR URL. Expected format: github.com/owner/repo/pull/123',
      },
    };
  }

  return fetchPrContentFiles(parsed.owner, parsed.repo, parsed.prNumber);
}
