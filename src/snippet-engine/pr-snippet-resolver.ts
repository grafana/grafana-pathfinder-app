import { activePrPreview, fetchSnapshotJson } from '../lib/pr-preview-fetch';
import { JsonSnippetSchema } from '../types/json-snippet.schema';
import type { JsonSnippet, SnippetResolver } from './types';

export function prSnippetResolver(contentUrl: string): SnippetResolver | undefined {
  const snapshot = activePrPreview(contentUrl);
  if (!snapshot) {
    return undefined;
  }
  return {
    async resolve(id) {
      try {
        if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
          throw new Error('Invalid snippet ID');
        }
        const snippet = JsonSnippetSchema.parse(await fetchSnapshotJson(snapshot, `shared/snippets/${id}.json`));
        return { ok: true, id, snippet: snippet as JsonSnippet, source: 'online-cdn' };
      } catch (error) {
        return {
          ok: false,
          id,
          error: {
            code: 'validation-error',
            message: error instanceof Error ? error.message : 'PR snippet unavailable',
          },
        };
      }
    },
  };
}
