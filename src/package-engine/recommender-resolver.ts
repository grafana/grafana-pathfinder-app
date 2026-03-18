/**
 * Recommender Package Resolver
 *
 * Implements PackageResolver by calling the recommender's
 * `GET /api/v1/packages/{id}` endpoint to resolve bare package IDs
 * to CDN content/manifest URLs.
 *
 * Used for deep links, milestone navigation, or any by-ID load that
 * falls outside the recommendation flow.
 *
 * @coupling Types: PackageResolver, PackageResolution in package.types.ts
 * @coupling Recommender API: GET /api/v1/packages/{id}
 * @security URL construction uses new URL() per F3 rule
 */

import type {
  ContentJson,
  ManifestJson,
  PackageResolution,
  PackageResolutionFailure,
  PackageResolutionSuccess,
  PackageResolver,
  ResolveOptions,
} from '../types/package.types';
import { ContentJsonSchema, ManifestJsonObjectSchema } from '../types/package.schema';

// ============ API RESPONSE TYPES ============

interface PackageResolutionResponse {
  id: string;
  contentUrl: string;
  manifestUrl: string;
  repository: string;
}

interface PackageResolutionErrorBody {
  error: string;
  code: string;
}

// ============ HELPERS ============

function notFound(id: string, message: string): PackageResolutionFailure {
  return { ok: false, id, error: { code: 'not-found', message } };
}

function networkError(id: string, message: string): PackageResolutionFailure {
  return { ok: false, id, error: { code: 'network-error', message } };
}

function isPackageResolutionResponse(body: unknown): body is PackageResolutionResponse {
  return (
    typeof body === 'object' &&
    body !== null &&
    typeof (body as PackageResolutionResponse).id === 'string' &&
    typeof (body as PackageResolutionResponse).contentUrl === 'string' &&
    typeof (body as PackageResolutionResponse).manifestUrl === 'string' &&
    typeof (body as PackageResolutionResponse).repository === 'string'
  );
}

async function fetchJson(url: string): Promise<{ ok: boolean; status: number; body: unknown }> {
  const response = await fetch(url);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { ok: response.ok, status: response.status, body };
}

async function fetchContent(contentUrl: string): Promise<ContentJson | undefined> {
  try {
    const response = await fetch(contentUrl);
    if (!response.ok) {
      return undefined;
    }
    const raw = await response.json();
    const result = ContentJsonSchema.safeParse(raw);
    return result.success ? (result.data as ContentJson) : undefined;
  } catch {
    return undefined;
  }
}

async function fetchManifest(manifestUrl: string): Promise<ManifestJson | undefined> {
  try {
    const response = await fetch(manifestUrl);
    if (!response.ok) {
      return undefined;
    }
    const raw = await response.json();
    const result = ManifestJsonObjectSchema.loose().safeParse(raw);
    return result.success ? (result.data as ManifestJson) : undefined;
  } catch {
    return undefined;
  }
}

// ============ RESOLVER ============

/**
 * PackageResolver backed by the recommender's `GET /api/v1/packages/{id}` endpoint.
 * Resolves bare package IDs to CDN URLs. Supports optional content loading.
 */
export class RecommenderPackageResolver implements PackageResolver {
  private readonly baseUrl: string;

  constructor(recommenderBaseUrl: string) {
    this.baseUrl = recommenderBaseUrl;
  }

  async resolve(packageId: string, options?: ResolveOptions): Promise<PackageResolution> {
    // F3: use new URL() for URL construction to prevent path-traversal
    let resolveUrl: URL;
    try {
      resolveUrl = new URL(`/api/v1/packages/${encodeURIComponent(packageId)}`, this.baseUrl);
    } catch {
      return notFound(packageId, `Invalid recommender base URL: ${this.baseUrl}`);
    }

    let result: { ok: boolean; status: number; body: unknown };
    try {
      result = await fetchJson(resolveUrl.toString());
    } catch (err) {
      return networkError(
        packageId,
        `Network error resolving package "${packageId}": ${err instanceof Error ? err.message : String(err)}`
      );
    }

    if (result.ok && result.status === 200) {
      if (!isPackageResolutionResponse(result.body)) {
        return notFound(packageId, `Invalid resolution response for package "${packageId}"`);
      }

      const { contentUrl, manifestUrl, repository } = result.body;

      const resolution: PackageResolutionSuccess = {
        ok: true,
        id: packageId,
        contentUrl,
        manifestUrl,
        repository,
      };

      if (options?.loadContent) {
        const [content, manifest] = await Promise.all([fetchContent(contentUrl), fetchManifest(manifestUrl)]);
        if (content !== undefined) {
          resolution.content = content;
        }
        if (manifest !== undefined) {
          resolution.manifest = manifest;
        }
      }

      return resolution;
    }

    // 404: package not found
    if (result.status === 404) {
      const errorBody = result.body as Partial<PackageResolutionErrorBody>;
      return notFound(packageId, errorBody?.error ?? `Package "${packageId}" not found`);
    }

    // 400: invalid package ID — treat as not-found (invalid IDs don't exist)
    if (result.status === 400) {
      const errorBody = result.body as Partial<PackageResolutionErrorBody>;
      return notFound(packageId, errorBody?.error ?? `Invalid package ID: "${packageId}"`);
    }

    // Other HTTP errors
    return networkError(packageId, `HTTP ${result.status} resolving package "${packageId}"`);
  }
}
