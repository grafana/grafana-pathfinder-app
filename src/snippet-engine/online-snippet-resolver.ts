/**
 * Online Snippet Resolver
 *
 * Fetches the catalog from `<host>/guides/shared/snippets/index.json` and
 * snippets from `<host>/guides/shared/snippets/<id>.json`. The host is
 * derived from the package-recommendations `baseUrl` (see
 * `deriveSnippetsBaseUrl`).
 */

import { fetchOnlinePackageRecommendations } from '../lib/package-recommendations-client';
import { JsonSnippetSchema, SnippetCatalogSchema } from '../types/json-snippet.schema';
import type { JsonSnippet, SnippetCatalog } from '../types/json-snippet.types';

import type { SnippetCatalogProvider, SnippetResolution, SnippetResolver } from './types';

/**
 * Snippets directory URL derived from the package-recommendations `baseUrl`.
 * Returns `''` when unusable so callers can short-circuit.
 */
export function deriveSnippetsBaseUrl(packagesBaseUrl: string): string {
  const trimmed = packagesBaseUrl.replace(/\/+$/, '');
  if (!trimmed) {
    return '';
  }
  // Snippets deploy under `/guides/shared/snippets/`: the interactive-tutorials
  // workflow does `cp -r shared guides/` before pushing to GCS. Swap the
  // `/packages` segment for it.
  if (trimmed.endsWith('/packages')) {
    return trimmed.slice(0, -'/packages'.length) + '/guides/shared/snippets';
  }
  // Defensive fallback if upstream changes the convention — a 404 is harmless.
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
