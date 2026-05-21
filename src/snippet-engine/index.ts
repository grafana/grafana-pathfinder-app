/**
 * Snippet Engine — Tier 2
 *
 * Resolves `snippet-ref` blocks to their concrete content by fetching
 * from the CDN (`<host>/shared/snippets/...`). The CDN is the single
 * source of truth; there is no bundled fallback. A short-lived
 * in-memory cache + in-flight dedupe keep repeated lookups cheap.
 *
 * Consumers:
 *  - `docs-retrieval/content-renderer.tsx` — splices resolved snippets
 *    into guides before the parser runs.
 *  - `components/block-editor` — populates the Snippet Picker.
 */

export { CachingSnippetResolver, getSnippetResolver, __resetSnippetResolverForTests } from './caching-snippet-resolver';
export {
  OnlineCdnSnippetResolver,
  createOnlineSnippetResolver,
  deriveSnippetsBaseUrl,
} from './online-snippet-resolver';
export { inlineSnippetRefsInBlocks, inlineSnippetRefsInGuide } from './inline-refs';
export type {
  SnippetCatalogProvider,
  SnippetResolution,
  SnippetResolutionErrorCode,
  SnippetResolutionFailure,
  SnippetResolutionSuccess,
  SnippetResolver,
} from './types';
