/**
 * CDN repository client for the Pathfinder authoring MCP.
 *
 * Read-only fetcher for the public Pathfinder package CDN. Used by the
 * `pathfinder_list_packages` / `pathfinder_get_package` /
 * `pathfinder_get_manifest` / `pathfinder_launch_package` tools (P6 in
 * `docs/design/AI-AUTHORING-IMPLEMENTATION.md`).
 *
 * Design notes:
 *   - No auth — repository is public.
 *   - 60-second in-process TTL on `repository.json` only. Per-package
 *     `content.json` / `manifest.json` fetches are uncached because they
 *     are small, accessed by id, and the cache invalidation story for
 *     individual packages is not worth the complexity.
 *   - Validation is non-fatal: schema drift in CDN-hosted JSON is surfaced
 *     as `validation.issues` but never throws. Callers always see the raw
 *     JSON the CDN returned.
 *   - Network failures, 4xx/5xx, and parse errors all return a structured
 *     `{ ok: false, code, message }` discriminated union — never throw.
 *   - Slash-normalization mirrors `buildPackageFileUrl` in
 *     `src/lib/package-recommendations-client.ts`. We do NOT import that
 *     file because it pulls in `@grafana/runtime`, which is not available
 *     to the MCP Node process.
 */

import type { z } from 'zod';

import { ContentJsonSchema, ManifestJsonObjectSchema, RepositoryEntrySchema } from '../../../types/package.schema';
import type { RepositoryEntry } from '../../../types/package.types';

const DEFAULT_REPOSITORY_URL = 'https://interactive-learning.grafana.net/packages/';
const REPOSITORY_INDEX_TTL_MS = 60_000;
const FETCH_TIMEOUT_MS = 10_000;

export const REPOSITORY_URL_ENV_VAR = 'PATHFINDER_REPOSITORY_URL';

export interface RepositoryPackage extends RepositoryEntry {
  id: string;
}

export interface ValidationReport {
  isValid: boolean;
  issues: Array<{ path: Array<string | number>; message: string }>;
}

export type RepositoryClientError =
  | { ok: false; code: 'HTTP_ERROR'; message: string; status: number }
  | { ok: false; code: 'NETWORK_ERROR'; message: string }
  | { ok: false; code: 'PARSE_ERROR'; message: string }
  | { ok: false; code: 'NOT_FOUND'; message: string };

export type RepositoryIndexResult =
  | {
      ok: true;
      baseUrl: string;
      packages: RepositoryPackage[];
      rawIndex: Record<string, unknown>;
      validation: ValidationReport;
    }
  | RepositoryClientError;

export type PackageJsonResult<T> =
  | {
      ok: true;
      url: string;
      raw: T;
      parsed: T | null;
      validation: ValidationReport;
    }
  | RepositoryClientError;

interface IndexCacheEntry {
  at: number;
  baseUrl: string;
  result: Extract<RepositoryIndexResult, { ok: true }>;
}

let indexCache: IndexCacheEntry | null = null;
let indexInFlight: Promise<RepositoryIndexResult> | null = null;

/**
 * Read the configured repository base URL. Always trailing-slash terminated
 * so callers can append `repository.json` directly.
 */
export function getRepositoryBaseUrl(): string {
  const fromEnv = process.env[REPOSITORY_URL_ENV_VAR];
  const raw = fromEnv && fromEnv.trim() !== '' ? fromEnv.trim() : DEFAULT_REPOSITORY_URL;
  return raw.endsWith('/') ? raw : `${raw}/`;
}

/**
 * Build a CDN URL from a repository `baseUrl`, an entry's `path`, and a
 * `fileName`. Mirrors `buildPackageFileUrl` in
 * `src/lib/package-recommendations-client.ts` — keep the two in sync.
 *
 * Returns `''` when any required component is empty after trimming, so
 * callers can fail closed on pathological input (e.g. all-slashes baseUrl,
 * empty entryPath).
 */
export function buildPackageFileUrl(baseUrl: string, entryPath: string, fileName: string): string {
  const trimmedBase = baseUrl.replace(/\/+$/, '');
  const cleanPath = entryPath.replace(/^\/+|\/+$/g, '');
  if (!trimmedBase || !cleanPath || !fileName) {
    return '';
  }
  return `${trimmedBase}/${cleanPath}/${fileName}`;
}

/**
 * Fetch and validate `repository.json`. Cached for 60 s by base URL.
 *
 * Errors are returned, never thrown. Schema drift on the index does not
 * hard-fail — `validation.issues` is populated and `packages` is built
 * best-effort from whatever entries did parse.
 */
export async function fetchRepositoryIndex(): Promise<RepositoryIndexResult> {
  const baseUrl = getRepositoryBaseUrl();
  const now = Date.now();
  if (indexCache && indexCache.baseUrl === baseUrl && now - indexCache.at < REPOSITORY_INDEX_TTL_MS) {
    return indexCache.result;
  }
  // Concurrent callers (e.g. tools that fetch content.json and manifest.json
  // in parallel) share one in-flight request so we hit the CDN once per
  // cache miss, not N times.
  if (indexInFlight) {
    return indexInFlight;
  }

  indexInFlight = doFetchRepositoryIndex(baseUrl, now).finally(() => {
    indexInFlight = null;
  });
  return indexInFlight;
}

async function doFetchRepositoryIndex(baseUrl: string, now: number): Promise<RepositoryIndexResult> {
  const url = `${baseUrl}repository.json`;
  const fetched = await fetchJson(url);
  if (!fetched.ok) {
    return fetched;
  }

  const raw = fetched.value;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      code: 'PARSE_ERROR',
      message: `repository.json is not a JSON object`,
    };
  }

  const rawIndex = raw as Record<string, unknown>;
  const packages: RepositoryPackage[] = [];
  const issues: ValidationReport['issues'] = [];

  for (const [id, entry] of Object.entries(rawIndex)) {
    const parsed = RepositoryEntrySchema.safeParse(entry);
    if (parsed.success) {
      packages.push({ id, ...parsed.data });
    } else {
      for (const issue of parsed.error.issues) {
        issues.push({ path: [id, ...normalizeIssuePath(issue.path)], message: issue.message });
      }
      // Best-effort include: surface metadata fields if entry is at least an object,
      // so callers can still see the id/path even when validation failed.
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        const e = entry as Record<string, unknown>;
        const path = typeof e.path === 'string' ? e.path : '';
        if (path) {
          packages.push({ id, ...(e as unknown as RepositoryEntry), path });
        }
      }
    }
  }

  const result: Extract<RepositoryIndexResult, { ok: true }> = {
    ok: true,
    baseUrl,
    packages,
    rawIndex,
    validation: { isValid: issues.length === 0, issues },
  };

  indexCache = { at: now, baseUrl, result };
  return result;
}

/**
 * Find a single repository entry by id. Loads the index on demand.
 */
export async function findRepositoryEntry(
  id: string
): Promise<{ ok: true; baseUrl: string; entry: RepositoryPackage } | RepositoryClientError> {
  const index = await fetchRepositoryIndex();
  if (!index.ok) {
    return index;
  }
  const entry = index.packages.find((p) => p.id === id);
  if (!entry) {
    return { ok: false, code: 'NOT_FOUND', message: `Package "${id}" not found in repository.json` };
  }
  return { ok: true, baseUrl: index.baseUrl, entry };
}

/**
 * Fetch a package's `content.json`. Validation is non-fatal.
 */
export async function fetchPackageContent(id: string): Promise<PackageJsonResult<Record<string, unknown>>> {
  const found = await findRepositoryEntry(id);
  if (!found.ok) {
    return found;
  }
  const url = buildPackageFileUrl(found.baseUrl, found.entry.path, 'content.json');
  if (!url) {
    return {
      ok: false,
      code: 'PARSE_ERROR',
      message: `Cannot construct content.json URL for "${id}" — baseUrl or path is empty after trimming`,
    };
  }
  return parseFetched(url, ContentJsonSchema);
}

/**
 * Fetch a package's `manifest.json`. Validation is non-fatal — uses
 * `ManifestJsonObjectSchema.loose()` so unknown fields surface as raw
 * properties without failing.
 */
export async function fetchPackageManifest(id: string): Promise<PackageJsonResult<Record<string, unknown>>> {
  const found = await findRepositoryEntry(id);
  if (!found.ok) {
    return found;
  }
  const url = buildPackageFileUrl(found.baseUrl, found.entry.path, 'manifest.json');
  if (!url) {
    return {
      ok: false,
      code: 'PARSE_ERROR',
      message: `Cannot construct manifest.json URL for "${id}" — baseUrl or path is empty after trimming`,
    };
  }
  return parseFetched(url, ManifestJsonObjectSchema.loose());
}

/**
 * Test-only: clear the index cache so a fresh fetch is performed on the
 * next call. Mirrors `__resetPackageRecommendationsClientForTests` in
 * `src/lib/package-recommendations-client.ts`.
 */
export function __resetRepositoryClientForTests(): void {
  indexCache = null;
  indexInFlight = null;
}

// ----------------- internals -----------------

function normalizeIssuePath(path: readonly PropertyKey[]): Array<string | number> {
  return path.map((segment) => (typeof segment === 'symbol' ? segment.toString() : segment));
}

async function fetchJson(url: string): Promise<{ ok: true; value: unknown } | RepositoryClientError> {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (err) {
    return {
      ok: false,
      code: 'NETWORK_ERROR',
      message: err instanceof Error ? err.message : String(err),
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      code: 'HTTP_ERROR',
      status: response.status,
      message: `${response.status} ${response.statusText} fetching ${url}`,
    };
  }
  let value: unknown;
  try {
    value = await response.json();
  } catch (err) {
    return {
      ok: false,
      code: 'PARSE_ERROR',
      message: err instanceof Error ? err.message : String(err),
    };
  }
  return { ok: true, value };
}

async function parseFetched<T>(url: string, schema: z.ZodType<T>): Promise<PackageJsonResult<Record<string, unknown>>> {
  const fetched = await fetchJson(url);
  if (!fetched.ok) {
    return fetched;
  }
  const raw = fetched.value;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      code: 'PARSE_ERROR',
      message: `Response from ${url} is not a JSON object`,
    };
  }
  const parsed = schema.safeParse(raw);
  const issues: ValidationReport['issues'] = parsed.success
    ? []
    : parsed.error.issues.map((i) => ({ path: normalizeIssuePath(i.path), message: i.message }));
  return {
    ok: true,
    url,
    raw: raw as Record<string, unknown>,
    parsed: parsed.success ? (parsed.data as Record<string, unknown>) : null,
    validation: { isValid: issues.length === 0, issues },
  };
}
