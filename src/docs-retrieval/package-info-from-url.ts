/**
 * Derive PackageOpenInfo from a remote package content URL.
 *
 * Used by the URL/handoff entry paths (deep-link `?doc=`, fullscreen handoff,
 * floating-to-fullscreen) which historically opened package URLs without the
 * manifest the recommender normally provides. Without the manifest the model
 * falls through to plain `fetchContent` and renders a "default doc" with no
 * milestone toolbar — see context-panel.tsx ("All packages route through
 * openDocsPage because it handles packageInfo").
 *
 * Two URL shapes are recognized:
 * - `https://interactive-learning.grafana.{net,-dev.net}/packages/<id>/content.json`
 *   — the sibling `manifest.json` is fetched directly and parsed with the loose
 *   `ManifestJsonObjectSchema` (no cross-field refinement) so partially-spec
 *   manifests still yield enough metadata for routing.
 * - `backend-guide:<id>` — App Platform custom guides. There is no sibling
 *   manifest URL to fetch; the manifest is resolved metadata-only through the
 *   shared PackageResolver (same call `resolvePackageMilestones` uses), which
 *   ultimately reaches `AppPlatformPackageResolver`.
 */
import { isInteractiveLearningUrl } from '../security';
import type { PackageOpenInfo } from '../types/content-panel.types';
import { ManifestJsonObjectSchema } from '../types/package.schema';
import { DEFAULT_CONTENT_FETCH_TIMEOUT } from '../constants';
import { getPackageResolver } from './content-fetcher/package-resolver-registry';

const PACKAGE_CONTENT_URL_PATTERN = /\/packages\/([^/]+)\/content\.json(?:[?#].*)?$/;
const BACKEND_GUIDE_URL_PREFIX = 'backend-guide:';

/** True if the URL is shaped like an interactive-learning package content URL. */
function isInteractiveLearningPackageUrl(url: string): boolean {
  return isInteractiveLearningUrl(url) && PACKAGE_CONTENT_URL_PATTERN.test(url);
}

/** Extracts the bare package id from a `backend-guide:<id>` URL, or undefined if not that scheme. */
function extractBackendGuideId(url: string): string | undefined {
  if (!url.startsWith(BACKEND_GUIDE_URL_PREFIX)) {
    return undefined;
  }
  const id = url.slice(BACKEND_GUIDE_URL_PREFIX.length).trim();
  return id.length > 0 ? id : undefined;
}

/** True if the URL is a package-content URL this module can resolve packageInfo for. */
export function isPackageContentUrl(url: string): boolean {
  return isInteractiveLearningPackageUrl(url) || extractBackendGuideId(url) !== undefined;
}

/**
 * Resolve packageInfo for a `backend-guide:<id>` URL via the shared
 * PackageResolver, metadata-only (no content fetch). Mirrors the
 * resolution → field mapping `resolvePackageMilestones`/`resolvePackageNavLinks`
 * already use in package-content.ts, just shaped as PackageOpenInfo.
 */
async function fetchAppPlatformPackageInfo(packageId: string): Promise<PackageOpenInfo | undefined> {
  const resolver = await getPackageResolver();
  if (!resolver) {
    return undefined;
  }
  try {
    const resolution = await resolver.resolve(packageId, { loadContent: 'metadata-only' });
    if (!resolution.ok) {
      return undefined;
    }
    return {
      packageId: resolution.id,
      packageManifest: resolution.manifest as unknown as Record<string, unknown> | undefined,
      repository: resolution.repository,
    };
  } catch {
    return undefined;
  }
}

function deriveManifestUrl(contentUrl: string): string | undefined {
  if (!PACKAGE_CONTENT_URL_PATTERN.test(contentUrl)) {
    return undefined;
  }
  return contentUrl.replace(/\/content\.json(?=([?#]|$))/, '/manifest.json');
}

/**
 * Fetch and parse the sibling manifest.json for a package content URL.
 * Returns `undefined` for non-package URLs, network errors, or schema failures
 * — callers fall back to the legacy plain-fetch path in those cases.
 */
export async function fetchPackageInfoFromUrl(url: string): Promise<PackageOpenInfo | undefined> {
  const backendGuideId = extractBackendGuideId(url);
  if (backendGuideId) {
    return fetchAppPlatformPackageInfo(backendGuideId);
  }

  if (!isInteractiveLearningPackageUrl(url)) {
    return undefined;
  }
  const manifestUrl = deriveManifestUrl(url);
  if (!manifestUrl) {
    return undefined;
  }

  try {
    const response = await fetch(manifestUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(DEFAULT_CONTENT_FETCH_TIMEOUT),
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
    const manifest = parsed.data;
    return {
      packageId: typeof manifest.id === 'string' ? manifest.id : undefined,
      packageManifest: manifest as unknown as Record<string, unknown>,
      // Carry the manifest's repository to the top-level completion key. The
      // schema defaults an absent repository to 'interactive-tutorials', so this
      // is the true source when the author set one and the default otherwise.
      repository: typeof manifest.repository === 'string' ? manifest.repository : undefined,
    };
  } catch {
    return undefined;
  }
}
