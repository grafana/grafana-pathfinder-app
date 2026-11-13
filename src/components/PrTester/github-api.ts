import { snapshotFileUrl, type PrSnapshot } from '../../lib/pr-preview-core';
import { z } from 'zod';

import { ContentJsonSchema } from '../../types/package.schema';
import { RuntimeManifestJsonObjectSchema } from '../../lib/runtime-manifest';
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
export type PrJsonFileKind = 'content' | 'manifest' | 'kiosk';

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
  head?: { sha?: string; repo?: { name?: string; owner?: { login?: string } } };
}

/** GitHub API response for a file in a PR */
interface GitHubPrFileEntry {
  filename: string;
  status: string;
}

/** Result type for PR content file fetching */
export type FetchPrFilesResult =
  | { success: true; files: PrJsonFile[]; snapshot: PrSnapshot; warning?: string }
  | { success: false; error: GitHubApiError };

export function parsePrUrl(value: string): ParsedPrUrl | null {
  try {
    const url = new URL(value.startsWith('github.com/') ? `https://${value}` : value);
    const match = url.pathname.match(/^\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)(?:\/.*)?$/);
    if (
      !['https://github.com', 'https://www.github.com'].includes(url.origin) ||
      url.username ||
      url.password ||
      !match ||
      Number(match[3]) <= 0
    ) {
      return null;
    }
    return { owner: match[1]!, repo: match[2]!, prNumber: Number(match[3]) };
  } catch {
    return null;
  }
}

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
      .replace(/\/?(content|manifest|rules)\.json$/, '')
      .split('/')
      .filter(Boolean)
      .join('/') || filePath
  );
}

/** Returns the file kind for paths the PR tester cares about. */
function classifyJsonFile(filePath: string): PrJsonFileKind | null {
  if (/^kiosk\/.+\/rules\.json$/.test(filePath)) {
    return 'kiosk';
  }
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

class GitHubRequestError extends Error {
  constructor(readonly detail: GitHubApiError) {
    super(detail.message);
  }
}

async function githubJson(url: URL | string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(String(url), {
    headers: { Accept: 'application/vnd.github.v3+json' },
    cache: 'no-cache',
    credentials: 'omit',
    redirect: 'error',
    signal,
  });
  if (!response.ok) {
    const type =
      response.status === 404
        ? 'not_found'
        : response.status === 403
          ? response.headers.get('X-RateLimit-Remaining') === '0'
            ? 'rate_limited'
            : 'forbidden'
          : 'api_error';
    const message =
      type === 'not_found'
        ? 'PR not found. Check the URL or ensure the repo is public.'
        : type === 'rate_limited'
          ? 'GitHub API rate limit exceeded. Try again later.'
          : type === 'forbidden'
            ? 'Access denied. The repository may be private.'
            : `GitHub request failed: ${response.status}`;
    throw new GitHubRequestError({ type, message, status: response.status });
  }
  return response.json();
}

export async function fetchPrContentFiles(
  owner: string,
  repo: string,
  prNumber: number,
  signal?: AbortSignal
): Promise<FetchPrFilesResult> {
  const composed = composeAbortSignals(...(signal ? [signal] : []), AbortSignal.timeout(30000));
  try {
    const api = (...parts: Array<string | number>) =>
      buildGitHubApiUrl('https://api.github.com', 'repos', owner, repo, ...parts);
    const metadata = (await githubJson(api('pulls', prNumber), composed.signal)) as GitHubPrMetadata;
    const snapshot: PrSnapshot = {
      owner: metadata.head?.repo?.owner?.login ?? owner,
      repo: metadata.head?.repo?.name ?? repo,
      sha: metadata.head?.sha ?? '',
    };
    try {
      snapshotFileUrl(snapshot, 'content.json');
    } catch {
      throw new GitHubRequestError({ type: 'api_error', message: 'Could not determine PR head SHA', status: 0 });
    }
    const entries: GitHubPrFileEntry[] = [];
    let warning: string | undefined;
    for (let page = 1; page <= 30; page++) {
      const url = new URL(api('pulls', prNumber, 'files'));
      url.searchParams.set('per_page', '100');
      url.searchParams.set('page', String(page));
      const data = await githubJson(url, composed.signal);
      if (!Array.isArray(data)) {
        throw new GitHubRequestError({ type: 'api_error', message: 'Unexpected API response format', status: 0 });
      }
      entries.push(...data);
      if (data.length < 100) {
        break;
      }
      if (page === 30) {
        warning = 'GitHub limits changed files to 3000. Some changed guides may be missing.';
      }
    }
    const files: PrJsonFile[] = entries.flatMap((file) => {
      if (typeof file.filename !== 'string' || file.status === 'removed') {
        return [];
      }
      const kind = classifyJsonFile(file.filename);
      if (!kind) {
        return [];
      }
      try {
        return [
          {
            directoryName: extractDirectoryName(file.filename),
            rawUrl: snapshotFileUrl(snapshot, file.filename),
            status: file.status as PrJsonFile['status'],
            kind,
          },
        ];
      } catch {
        return [];
      }
    });
    try {
      const url = new URL(
        buildGitHubApiUrl(
          'https://api.github.com',
          'repos',
          snapshot.owner,
          snapshot.repo,
          'git',
          'trees',
          snapshot.sha
        )
      );
      url.searchParams.set('recursive', '1');
      const tree = (await githubJson(url, composed.signal)) as {
        tree?: Array<{ path: string; type: string }>;
        truncated?: boolean;
      };
      if (!Array.isArray(tree.tree) || tree.truncated) {
        throw new Error('Incomplete repository tree');
      }
      const known = new Set(files.map((file) => file.rawUrl));
      for (const entry of tree.tree) {
        if (entry.type !== 'blob' || classifyJsonFile(entry.path) !== 'kiosk') {
          continue;
        }
        const rawUrl = snapshotFileUrl(snapshot, entry.path);
        if (!known.has(rawUrl)) {
          files.push({ directoryName: extractDirectoryName(entry.path), rawUrl, status: 'unchanged', kind: 'kiosk' });
        }
      }
    } catch {
      composed.signal.throwIfAborted();
      warning = [warning, 'Could not discover unchanged kiosks. Re-fetch the PR to try again.']
        .filter(Boolean)
        .join(' ');
    }
    if (files.length === 0) {
      return {
        success: false,
        error: {
          type: 'no_files',
          message: 'No content.json, manifest.json, or kiosk catalogs found in this PR snapshot.',
        },
      };
    }
    return { success: true, files, snapshot, warning };
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
      return { success: false, error: { type: 'aborted', message: 'Request cancelled' } };
    }
    if (error instanceof GitHubRequestError) {
      return { success: false, error: error.detail };
    }
    return {
      success: false,
      error: { type: 'network_error', message: 'Network error. Check your connection and try again.' },
    };
  } finally {
    composed.dispose();
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
 * Uses {@link RuntimeManifestJsonObjectSchema} (no cross-field refinement) so partial
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
    const parsed = RuntimeManifestJsonObjectSchema.safeParse(json);
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
