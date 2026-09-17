/**
 * Online Snippet Resolver
 *
 * Fetches the catalog from `<host>/guides/shared/snippets/index.json` and
 * snippets from `<host>/guides/shared/snippets/<id>.json`. The host is
 * derived from the package-recommendations `baseUrl` (see
 * `deriveSnippetsBaseUrl`).
 */

import { DEFAULT_CONTENT_FETCH_TIMEOUT } from '../constants';
import { logger } from '../lib/logging';
import { fetchOnlinePackageRecommendations } from '../lib/package-recommendations-client';
import { JsonSnippetSchema, SnippetCatalogSchema } from '../types/json-snippet.schema';
import type { JsonSnippet, SnippetCatalog } from '../types/json-snippet.types';
import { formatPath } from '../validation/errors';
import { validateGuidedActionsInBlocks } from '../validation/guided-action-validator';

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
      const response = await fetch(url, { signal: AbortSignal.timeout(DEFAULT_CONTENT_FETCH_TIMEOUT) });
      if (!response.ok) {
        return {
          ok: false,
          id: snippetId,
          error: {
            code: response.status === 404 ? 'not-found' : 'network-error',
            message: `Snippet fetch failed: HTTP ${response.status}`,
          },
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
      const snippet = parsed.data as JsonSnippet;
      // Runtime path: an already-published snippet keeps resolving so every
      // block that does work still renders. Only the authoring gate in
      // `build-snippets` refuses a guided verb the handler cannot drive.
      for (const issue of validateGuidedActionsInBlocks(snippet.blocks)) {
        logger.warn(`[OnlineSnippetResolver] snippet "${snippetId}" ${formatPath(issue.path)}: ${issue.message}`);
      }
      return { ok: true, id: snippetId, snippet, source: 'online-cdn' };
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
      const response = await fetch(`${baseUrl}/index.json`, {
        signal: AbortSignal.timeout(DEFAULT_CONTENT_FETCH_TIMEOUT),
      });
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
