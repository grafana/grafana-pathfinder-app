/**
 * Snippet Engine Types
 *
 * Internal shape for the resolver pipeline. The renderer never sees a
 * `SnippetResolution` — the parser splices the resolved blocks in place.
 */

import type { JsonSnippet, SnippetCatalog, SnippetCatalogEntry } from '../types/json-snippet.types';

export interface SnippetResolutionSuccess {
  ok: true;
  id: string;
  /** The validated snippet body. */
  snippet: JsonSnippet;
  /** Which tier resolved the snippet. */
  source: 'online-cdn';
}

export type SnippetResolutionErrorCode = 'not-found' | 'network-error' | 'validation-error' | 'parse-error';

export interface SnippetResolutionFailure {
  ok: false;
  id: string;
  error: { code: SnippetResolutionErrorCode; message: string };
}

export type SnippetResolution = SnippetResolutionSuccess | SnippetResolutionFailure;

/** A resolver can answer "give me snippet X" from the live CDN. */
export interface SnippetResolver {
  resolve(snippetId: string): Promise<SnippetResolution>;
}

/**
 * A catalog provider lists every snippet known to the editor — used to
 * populate the Snippet Picker without fetching every snippet body.
 */
export interface SnippetCatalogProvider {
  list(): Promise<SnippetCatalog>;
}

export type { JsonSnippet, SnippetCatalog, SnippetCatalogEntry };
