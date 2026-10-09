import type { ContentRendererCompletion } from '../components/content-renderer/content-renderer';
import type { SurfaceCompletionInput } from '../docs-retrieval';
import type { RawContent } from '../types/content.types';

/** For tests of rendering that must record nothing, as a preview does. */
export const UNTRACKED_COMPLETION: ContentRendererCompletion = { kind: 'untracked', reason: 'preview' };

/** The completion a surface hands the renderer for `content`, as the guide reader builds it. */
export function trackedCompletion(
  content: RawContent,
  overrides: Partial<SurfaceCompletionInput> = {}
): ContentRendererCompletion {
  return {
    kind: 'tracked',
    input: {
      contentUrl: content.url,
      currentUrl: content.url,
      contentType: content.type,
      metadata: content.metadata,
      ...overrides,
    },
  };
}
