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
  | { type: 'forbidden'; message: string }
  | { type: 'aborted'; message: string }
  | { type: 'network_error'; message: string }
  | { type: 'api_error'; message: string; status: number }
  | { type: 'no_files'; message: string };

/** GitHub API response for PR metadata */
interface GitHubPrMetadata {
  head?: { sha?: string };
}

/** GitHub API response for a file in a PR */
interface GitHubPrFileEntry {
  filename: string;
  status: string;
}

/** Result type for PR content file fetching */
export type FetchPrFilesResult =
  | { success: true; files: PrContentFile[]; warning?: string }
  | { success: false; error: GitHubApiError };

// Pattern to extract owner, repo, and PR number from GitHub PR URL
const PR_URL_PATTERN = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/;

// SECURITY: Validates Git commit SHA format (40 hex characters)
const SHA_PATTERN = /^[0-9a-f]{40}$/i;

// SECURITY: Detects path traversal and control characters in file paths
const UNSAFE_PATH_PATTERN = /\.\.|[\x00-\x1f\x7f]/;

/**
 * Maximum files to fetch from GitHub API per request.
 *
 * The GitHub PR files API defaults to 30 files per page, but supports
 * up to 100 files per page via the `per_page` parameter. We request
 * the maximum (100) to minimize missed content.json files.
 *
 * Limitation: If a PR has >100 total files and content.json files appear
 * after the first 100 files, those guides won't be detected. This is a
 * reasonable tradeoff for a dev tool - PRs with >100 files are rare and
 * should generally be split up anyway.
 */
const MAX_FILES_PER_PAGE = 100;

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
  const prNumber = parseInt(prNumberStr!, 10);

  if (isNaN(prNumber) || prNumber <= 0) {
    return null;
  }

  return { owner: owner!, repo: repo!, prNumber };
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
  return (
    filePath
      .replace(/\/?content\.json$/, '')
      .split('/')
      .filter(Boolean)
      .join('/') || filePath
  );
}

/**
 * Build a GitHub API URL using the URL API for safe path construction.
 * Encodes path components to prevent path injection.
 */
function buildGitHubApiUrl(baseUrl: string, ...pathSegments: Array<string | number>): string {
  const encodedPath = pathSegments.map((seg) => encodeURIComponent(String(seg))).join('/');
  return new URL(`/${encodedPath}`, baseUrl).toString();
}

/**
 * Build a raw.githubusercontent.com URL for a file in a repo.
 * Handles filenames with directory separators by encoding each path component individually.
 */
function buildRawContentUrl(owner: string, repo: string, sha: string, filename: string): string {
  const fileSegments = filename.split('/').map(encodeURIComponent);
  const fullPath = [encodeURIComponent(owner), encodeURIComponent(repo), encodeURIComponent(sha), ...fileSegments].join(
    '/'
  );
  return new URL(`/${fullPath}`, 'https://raw.githubusercontent.com').toString();
}

/**
 * Fetch content.json files from a GitHub PR
 *
 * Makes two sequential GitHub API calls:
 * 1. GET /repos/{owner}/{repo}/pulls/{number} - Get head SHA
 * 2. GET /repos/{owner}/{repo}/pulls/{number}/files - Get changed files
 *
 * Note: Returns at most MAX_CONTENT_FILES (100) files, matching the GitHub
 * API's default page size.
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param prNumber - Pull request number
 * @param signal - Optional AbortSignal for request cancellation
 * @returns Result containing files or error
 */
export async function fetchPrContentFiles(
  owner: string,
  repo: string,
  prNumber: number,
  signal?: AbortSignal
): Promise<FetchPrFilesResult> {
  const baseUrl = 'https://api.github.com';

  try {
    // Step 1: Fetch PR metadata to get head SHA
    const prApiUrl = buildGitHubApiUrl(baseUrl, 'repos', owner, repo, 'pulls', prNumber);
    const prResponse = await fetch(prApiUrl, {
      headers: {
        Accept: 'application/vnd.github.v3+json',
      },
      signal,
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
      // Not rate limited - likely access denied (private repo)
      return {
        success: false,
        error: {
          type: 'forbidden',
          message: 'Access denied. The repository may be private.',
        },
      };
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

    const prData: GitHubPrMetadata = await prResponse.json();
    const headSha = prData.head?.sha;

    if (!headSha || !SHA_PATTERN.test(headSha)) {
      return {
        success: false,
        error: {
          type: 'api_error',
          message: 'Could not determine PR head SHA',
          status: 0,
        },
      };
    }

    // Step 2: Fetch PR files list (request max 100 files per page)
    const filesApiUrl = new URL(buildGitHubApiUrl(baseUrl, 'repos', owner, repo, 'pulls', prNumber, 'files'));
    filesApiUrl.searchParams.set('per_page', String(MAX_FILES_PER_PAGE));
    const filesResponse = await fetch(filesApiUrl.toString(), {
      headers: {
        Accept: 'application/vnd.github.v3+json',
      },
      signal,
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
      // Not rate limited - likely access denied
      return {
        success: false,
        error: {
          type: 'forbidden',
          message: 'Access denied. The repository may be private.',
        },
      };
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

    const filesData: unknown = await filesResponse.json();

    // Runtime validation: ensure response is an array
    if (!Array.isArray(filesData)) {
      return {
        success: false,
        error: {
          type: 'api_error',
          message: 'Unexpected API response format',
          status: 0,
        },
      };
    }

    const totalFilesInPr = filesData.length;
    const mightHaveMoreFiles = totalFilesInPr >= MAX_FILES_PER_PAGE;

    // Filter for content.json files and construct raw URLs
    const contentFiles: PrContentFile[] = (filesData as GitHubPrFileEntry[])
      .filter(
        (file) =>
          typeof file.filename === 'string' &&
          file.filename.endsWith('content.json') &&
          !UNSAFE_PATH_PATTERN.test(file.filename)
      )
      .map((file) => ({
        directoryName: extractDirectoryName(file.filename),
        rawUrl: buildRawContentUrl(owner, repo, headSha, file.filename),
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

    // Generate warning if we hit the GitHub API pagination limit
    // We can only see the first 100 files from the PR - there might be more content.json files beyond that
    const warning = mightHaveMoreFiles
      ? `This PR has ${totalFilesInPr}+ files (GitHub API limit reached). Found ${contentFiles.length} content.json file(s) in the first ${totalFilesInPr} files. There may be additional guides not shown. Consider splitting large PRs.`
      : undefined;

    return {
      success: true,
      files: contentFiles,
      warning,
    };
  } catch (error) {
    // Handle abort errors separately
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        success: false,
        error: {
          type: 'aborted',
          message: 'Request cancelled',
        },
      };
    }
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
 * @param signal - Optional AbortSignal for request cancellation
 * @returns Result containing files or error
 */
export async function fetchPrContentFilesFromUrl(prUrl: string, signal?: AbortSignal): Promise<FetchPrFilesResult> {
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

  return fetchPrContentFiles(parsed.owner, parsed.repo, parsed.prNumber, signal);
}
