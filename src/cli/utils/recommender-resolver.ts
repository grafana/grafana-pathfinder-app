/**
 * CLI recommender client.
 *
 * Resolves a bare package id to its CDN content/manifest URLs via the
 * recommender's `GET /api/v1/packages/{id}` endpoint, returning the parsed
 * manifest metadata (type, testEnvironment) the e2e runner routes on.
 */

import { ManifestJsonObjectSchema } from '../../types/package.schema';
import type { ManifestJson } from '../../types/package.types';

const FETCH_TIMEOUT_MS = 15_000;

/** Subset of the recommender `GET /api/v1/packages/{id}` response we consume. */
interface PackageResolutionResponse {
  id: string;
  contentUrl: string;
  manifestUrl: string;
}

/** Outcome of resolving a bare package id. Failures never throw. */
export type RecommenderResolution =
  | { ok: true; id: string; contentUrl: string; manifest?: ManifestJson }
  | { ok: false; message: string };

/**
 * Resolve a bare package id through the recommender, then fetch its manifest
 * for routing metadata. Network, HTTP, and parse failures map to
 * `{ ok: false }` rather than throwing, so the caller can record a structured
 * skip outcome.
 */
export async function resolvePackageById(resolverUrl: string, id: string): Promise<RecommenderResolution> {
  let response: Response;
  try {
    // SECURITY: build the URL via the URL API and encode the id (F3).
    const endpoint = new URL(`/api/v1/packages/${encodeURIComponent(id)}`, resolverUrl);
    response = await fetch(endpoint.toString(), {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: 'application/json' },
    });
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Unknown network error' };
  }

  if (!response.ok) {
    return { ok: false, message: `HTTP ${response.status} ${response.statusText}` };
  }

  let data: PackageResolutionResponse;
  try {
    data = (await response.json()) as PackageResolutionResponse;
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Invalid resolution response' };
  }

  return { ok: true, id: data.id, contentUrl: data.contentUrl, manifest: await fetchManifest(data.manifestUrl) };
}

/**
 * Fetch and parse a package manifest for routing metadata. Optional and
 * non-fatal: a missing, unreachable, or malformed manifest yields `undefined`
 * so the guide can still run under default targeting.
 */
async function fetchManifest(manifestUrl: string): Promise<ManifestJson | undefined> {
  if (!manifestUrl) {
    return undefined;
  }
  let raw: unknown;
  try {
    const res = await fetch(manifestUrl, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      return undefined;
    }
    raw = await res.json();
  } catch {
    return undefined;
  }
  const parsed = ManifestJsonObjectSchema.loose().safeParse(raw);
  return parsed.success ? (parsed.data as ManifestJson) : undefined;
}
