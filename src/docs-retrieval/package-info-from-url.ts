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
 * Pattern matched: `https://interactive-learning.grafana.{net,-dev.net}/packages/<id>/content.json`.
 * The sibling `manifest.json` is fetched and parsed with the loose
 * `ManifestJsonObjectSchema` (no cross-field refinement) so partially-spec
 * manifests still yield enough metadata for routing.
 */
import { isInteractiveLearningUrl } from '../security';
import type { PackageOpenInfo } from '../types/content-panel.types';
import { ManifestJsonObjectSchema } from '../types/package.schema';
import { DEFAULT_CONTENT_FETCH_TIMEOUT } from '../constants';

const PACKAGE_CONTENT_URL_PATTERN = /\/packages\/([^/]+)\/content\.json(?:[?#].*)?$/;

/** True if the URL is shaped like an interactive-learning package content URL. */
export function isPackageContentUrl(url: string): boolean {
  if (!isInteractiveLearningUrl(url)) {
    return false;
  }
  return PACKAGE_CONTENT_URL_PATTERN.test(url);
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
  if (!isPackageContentUrl(url)) {
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
    };
  } catch {
    return undefined;
  }
}
