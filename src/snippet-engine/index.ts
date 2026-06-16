/**
 * Snippet engine: resolves `snippet-ref` blocks to CDN content, with a
 * short-lived cache and in-flight dedupe.
 */

export { CachingSnippetResolver, getSnippetResolver, __resetSnippetResolverForTests } from './caching-snippet-resolver';
export {
  OnlineCdnSnippetResolver,
  createOnlineSnippetResolver,
  deriveSnippetsBaseUrl,
} from './online-snippet-resolver';
export { guideHasSnippetRefs, inlineSnippetRefsInBlocks, inlineSnippetRefsInGuide } from './inline-refs';
export type {
  SnippetCatalogProvider,
  SnippetResolution,
  SnippetResolutionErrorCode,
  SnippetResolutionFailure,
  SnippetResolutionSuccess,
  SnippetResolver,
} from './types';
