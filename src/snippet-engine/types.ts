/** Internal shapes for the resolver pipeline; the renderer never sees these. */

import type { JsonSnippet, SnippetCatalog, SnippetCatalogEntry } from '../types/json-snippet.types';

export interface SnippetResolutionSuccess {
  ok: true;
  id: string;
  snippet: JsonSnippet;
  source: 'online-cdn';
}

export type SnippetResolutionErrorCode = 'not-found' | 'network-error' | 'validation-error' | 'parse-error';

export interface SnippetResolutionFailure {
  ok: false;
  id: string;
  error: { code: SnippetResolutionErrorCode; message: string };
}

export type SnippetResolution = SnippetResolutionSuccess | SnippetResolutionFailure;

export interface SnippetResolver {
  resolve(snippetId: string): Promise<SnippetResolution>;
}

/** Lists every snippet for the picker without fetching each body. */
export interface SnippetCatalogProvider {
  list(): Promise<SnippetCatalog>;
}

export type { JsonSnippet, SnippetCatalog, SnippetCatalogEntry };
