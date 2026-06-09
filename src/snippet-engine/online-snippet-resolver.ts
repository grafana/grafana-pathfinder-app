/**
 * Online Snippet Resolver
 *
 * Fetches the catalog from `<host>/guides/shared/snippets/index.json`
 * and individual snippets from `<host>/guides/shared/snippets/<id>.json`.
 * The `/guides/shared/` prefix reflects the existing CDN deploy in
 * `grafana/interactive-tutorials`: `.github/workflows/deploy.yml` does
 * `cp -r shared guides/` before pushing to GCS, so everything in the
 * upstream repo's `shared/` directory lands under `guides/shared/` on
 * the CDN. The `shared/` segment reserves space for sibling reusable
 * types (e.g. templates).
 *
 * The host is derived from the existing `/package-recommendations`
 * response by stripping the trailing `/packages` segment off its
 * `baseUrl` field. This keeps the upstream content repo as the
 * single source of truth without adding a new backend endpoint.
 */

import { fetchOnlinePackageRecommendations } from '../lib/package-recommendations-client';
import { JsonSnippetSchema, SnippetCatalogSchema } from '../types/json-snippet.schema';
import type { JsonSnippet, SnippetCatalog } from '../types/json-snippet.types';

import type { SnippetCatalogProvider, SnippetResolution, SnippetResolver } from './types';

/**
 * Derive the snippets directory URL from the package recommendations
 * `baseUrl`. Returns `''` when the input is unusable so callers can
 * short-circuit (a failed lookup renders the inert placeholder).
 */
export function deriveSnippetsBaseUrl(packagesBaseUrl: string): string {
  const trimmed = packagesBaseUrl.replace(/\/+$/, '');
  if (!trimmed) {
    return '';
  }
  // The recommendations baseUrl points at the packages directory
  // (e.g. `https://interactive-learning.grafana.net/packages`). Snippets
  // are deployed under `/guides/shared/snippets/` because the
  // interactive-tutorials deploy workflow does `cp -r shared guides/`
  // before pushing to GCS — drop the `/packages` segment and append
  // `/guides/shared/snippets`.
  if (trimmed.endsWith('/packages')) {
    return trimmed.slice(0, -'/packages'.length) + '/guides/shared/snippets';
  }
  // Defensive fallback when upstream changes the convention. A 404 here
  // is harmless — a failed snippet renders the inert placeholder.
  return `${trimmed}/guides/shared/snippets`;
}

export class OnlineCdnSnippetResolver implements SnippetResolver, SnippetCatalogProvider {
  async resolve(snippetId: string): Promise<SnippetResolution> {
    const baseUrl = await this.getBaseUrl();
    if (!baseUrl) {
      return { ok: false, id: snippetId, error: { code: 'network-error', message: 'No snippets base URL available' } };
    }

    const url = `${baseUrl}/${encodeURIComponent(snippetId)}.json`;
    try {
      const response = await fetch(url);
      if (!response.ok) {
        return {
          ok: false,
          id: snippetId,
          error: { code: 'network-error', message: `Snippet fetch failed: HTTP ${response.status}` },
        };
      }
      const raw = await response.json();
      const parsed = JsonSnippetSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          ok: false,
          id: snippetId,
          error: { code: 'validation-error', message: `Online snippet validation failed: ${parsed.error.message}` },
        };
      }
      return { ok: true, id: snippetId, snippet: parsed.data as JsonSnippet, source: 'online-cdn' };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Snippet fetch failed';
      return { ok: false, id: snippetId, error: { code: 'network-error', message } };
    }
  }

  async list(): Promise<SnippetCatalog> {
    const baseUrl = await this.getBaseUrl();
    if (!baseUrl) {
      return {};
    }

    try {
      const response = await fetch(`${baseUrl}/index.json`);
      if (!response.ok) {
        return {};
      }
      const raw = await response.json();
      const parsed = SnippetCatalogSchema.safeParse(raw);
      return parsed.success ? parsed.data : {};
    } catch {
      return {};
    }
  }

  private async getBaseUrl(): Promise<string> {
    const { baseUrl } = await fetchOnlinePackageRecommendations();
    return deriveSnippetsBaseUrl(baseUrl);
  }
}

export function createOnlineSnippetResolver(): OnlineCdnSnippetResolver {
  return new OnlineCdnSnippetResolver();
}
