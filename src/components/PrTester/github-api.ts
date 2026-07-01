/**
 * GitHub API utilities for PR Tester
 *
 * Provides URL parsing and API fetch functions to retrieve
 * content.json AND manifest.json files from GitHub pull requests.
 *
 * Manifest files are surfaced alongside content so the PR tester can
 * detect path/journey packages and assemble a real `PackageOpenInfo`
 * (manifest + pre-resolved milestones) rather than synthesising a
 * single mega-guide.
 */

import { z } from 'zod';

import { ContentJsonSchema, ManifestJsonObjectSchema } from '../../types/package.schema';
import type { ManifestJson } from '../../types/package.types';
import { DEFAULT_CONTENT_FETCH_TIMEOUT } from '../../constants';

/**
 * The package `id` (and optional `title`) read from a content.json. `title` is
 * optional so an in-progress content.json without one still yields its id.
 */
const ContentMetaSchema = ContentJsonSchema.pick({ id: true }).extend({ title: z.string().optional() });

/** Minimal content.json metadata the PR tester reads to map a file to its package ID. */
export interface PrContentMeta {
  id: string;
  title?: string;
}

/** Parsed GitHub PR URL components */
export interface ParsedPrUrl {
  owner: string;
  repo: string;
  prNumber: number;
}

/** Distinguishes the two file kinds the PR tester cares about. */
export type PrJsonFileKind = 'content' | 'manifest';

/**
 * JSON file metadata from a PR.
 *
 * `directoryName` is shared between sibling `content.json` and `manifest.json`
 * within the same package directory, so callers can pair them up by name.
 */
export interface PrJsonFile {
  directoryName: string;
  rawUrl: string;
  status: 'added' | 'modified' | 'removed' | 'renamed' | 'unchanged';
  kind: PrJsonFileKind;
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
  | { success: true; files: PrJsonFile[]; warning?: string }
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
 * Extract directory name from a JSON file path.
 * Strips the trailing `content.json` or `manifest.json` segment.
 *
 * @param filePath - File path (e.g., "connect-metrics-data/content.json")
 * @returns Directory name (e.g., "connect-metrics-data")
 */
function extractDirectoryName(filePath: string): string {
  return (
    filePath
      .replace(/\/?(content|manifest)\.json$/, '')
      .split('/')
      .filter(Boolean)
      .join('/') || filePath
  );
}

/** Returns the file kind for paths the PR tester cares about. */
function classifyJsonFile(filePath: string): PrJsonFileKind | null {
  if (filePath.endsWith('/content.json') || filePath === 'content.json') {
    return 'content';
  }
  if (filePath.endsWith('/manifest.json') || filePath === 'manifest.json') {
    return 'manifest';
  }
  return null;
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

    // Filter for content.json + manifest.json and construct raw URLs.
    const jsonFiles: PrJsonFile[] = (filesData as GitHubPrFileEntry[]).flatMap((file) => {
      if (typeof file.filename !== 'string' || UNSAFE_PATH_PATTERN.test(file.filename)) {
        return [];
      }
      const kind = classifyJsonFile(file.filename);
      if (!kind) {
        return [];
      }
      return [
        {
          directoryName: extractDirectoryName(file.filename),
          rawUrl: buildRawContentUrl(owner, repo, headSha, file.filename),
          status: file.status as PrJsonFile['status'],
          kind,
        },
      ];
    });

    const contentCount = jsonFiles.filter((f) => f.kind === 'content').length;
    const manifestCount = jsonFiles.length - contentCount;

    // Only fail when the PR has neither content nor manifest files we
    // care about. A PR that only modifies a path package's `manifest.json`
    // (e.g. fixing milestone order or targeting) is still useful to
    // surface — PrTester will show the manifest preview and a clear
    // "missing_cover" hint via the path-build pipeline so the author
    // knows which sibling content.json to add.
    if (jsonFiles.length === 0) {
      return {
        success: false,
        error: {
          type: 'no_files',
          message: 'No content.json or manifest.json files found in this PR',
        },
      };
    }

    // Generate warning if we hit the GitHub API pagination limit.
    // The summary distinguishes content vs manifest counts so the user can
    // tell at a glance which kinds of files we found in the first page.
    const warning = mightHaveMoreFiles
      ? `This PR has ${totalFilesInPr}+ files (GitHub API limit reached). Found ${contentCount} content.json and ${manifestCount} manifest.json file(s) in the first ${totalFilesInPr} files. There may be additional guides not shown. Consider splitting large PRs.`
      : undefined;

    return {
      success: true,
      files: jsonFiles,
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

/**
 * Compose multiple AbortSignals into one that aborts as soon as any of the
 * inputs aborts. Equivalent to `AbortSignal.any` but without depending on
 * the runtime supporting it (the project's existing `AbortSignal.timeout`
 * mocks in tests show we can't assume the latest API surface).
 *
 * Returns a `dispose` callback the caller MUST invoke when the composed
 * signal is no longer needed — typically in a `finally` after the fetch
 * settles. Without it the bridge listeners stay attached to the inputs:
 * `AbortSignal.timeout` self-cleans when it fires, but a long-lived
 * caller signal (e.g. a component-level abort controller) accumulates
 * one listener per call and keeps the composed controller's closure
 * alive, blocking GC of both.
 */
export function composeAbortSignals(...signals: AbortSignal[]): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      controller.abort(s.reason);
      // Nothing to detach — we never registered listeners.
      return { signal: controller.signal, dispose: () => {} };
    }
  }
  const registered: Array<{ signal: AbortSignal; listener: () => void }> = [];
  for (const s of signals) {
    const listener = () => controller.abort(s.reason);
    s.addEventListener('abort', listener, { once: true });
    registered.push({ signal: s, listener });
  }
  return {
    signal: controller.signal,
    dispose: () => {
      for (const { signal, listener } of registered) {
        signal.removeEventListener('abort', listener);
      }
      registered.length = 0;
    },
  };
}

/**
 * Fetch and loosely parse a manifest.json from a PR raw URL.
 *
 * Uses {@link ManifestJsonObjectSchema} (no cross-field refinement) so partial
 * or in-progress manifests still yield enough metadata for the PR tester to
 * decide whether the PR contains a path/journey package. Returns `undefined`
 * for network errors, schema failures, or invalid JSON — callers fall back
 * to per-guide testing in those cases.
 *
 * @param rawUrl - Raw GitHub URL to manifest.json (from {@link PrJsonFile.rawUrl})
 * @param signal - Optional AbortSignal for request cancellation. The fetch
 *                 always carries its own timeout (`DEFAULT_CONTENT_FETCH_TIMEOUT`);
 *                 the caller's signal is composed *with* the timeout so a
 *                 hung GitHub endpoint can't block until component unmount
 *                 even when the caller passes its own controller.
 */
export async function fetchPrManifest(rawUrl: string, signal?: AbortSignal): Promise<ManifestJson | undefined> {
  const timeoutSignal = AbortSignal.timeout(DEFAULT_CONTENT_FETCH_TIMEOUT);
  // When no caller signal is supplied the timeout signal stands alone — no
  // composition needed, no listener cleanup required. Otherwise we bridge
  // the two via `composeAbortSignals` and detach in `finally` below so the
  // caller's (potentially long-lived) signal doesn't accumulate listeners
  // across repeated `fetchPrManifest` calls.
  const composed = signal ? composeAbortSignals(signal, timeoutSignal) : { signal: timeoutSignal, dispose: () => {} };
  try {
    const response = await fetch(rawUrl, {
      method: 'GET',
      signal: composed.signal,
      redirect: 'follow',
    });
    if (!response.ok) {
      return undefined;
    }
    const json: unknown = await response.json();
    const parsed = ManifestJsonObjectSchema.safeParse(json);
    if (!parsed.success) {
      return undefined;
    }
    return parsed.data as unknown as ManifestJson;
  } catch {
    return undefined;
  } finally {
    composed.dispose();
  }
}

/**
 * Fetch a content.json from a PR raw URL and read its own package `id` (+ title).
 *
 * The content's `id` is the canonical package ID — so a milestone whose
 * content.json is in the PR can be matched to a path's `manifest.milestones[]`
 * even when its sibling manifest.json isn't in the diff. Mirrors
 * {@link fetchPrManifest}'s timeout + signal composition and error swallowing.
 */
export async function fetchPrContentMeta(rawUrl: string, signal?: AbortSignal): Promise<PrContentMeta | undefined> {
  const timeoutSignal = AbortSignal.timeout(DEFAULT_CONTENT_FETCH_TIMEOUT);
  const composed = signal ? composeAbortSignals(signal, timeoutSignal) : { signal: timeoutSignal, dispose: () => {} };
  try {
    const response = await fetch(rawUrl, {
      method: 'GET',
      signal: composed.signal,
      redirect: 'follow',
    });
    if (!response.ok) {
      return undefined;
    }
    const json: unknown = await response.json();
    const parsed = ContentMetaSchema.safeParse(json);
    if (!parsed.success) {
      return undefined;
    }
    return parsed.data;
  } catch {
    return undefined;
  } finally {
    composed.dispose();
  }
}
