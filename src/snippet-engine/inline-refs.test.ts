import { inlineSnippetRefsInGuide } from './inline-refs';
import type { SnippetResolution, SnippetResolver } from './types';
import type { JsonBlock, JsonGuide } from '../types/json-guide.types';

function ok(id: string, blocks: JsonBlock[]): SnippetResolution {
  return {
    ok: true,
    id,
    source: 'bundled',
    snippet: {
      id,
      title: id,
      description: `desc for ${id}`,
      blocks,
    },
  };
}

function notFound(id: string): SnippetResolution {
  return { ok: false, id, error: { code: 'not-found', message: `unknown snippet ${id}` } };
}

class StubResolver implements SnippetResolver {
  constructor(private readonly map: Record<string, SnippetResolution>) {}
  async resolve(id: string): Promise<SnippetResolution> {
    return this.map[id] ?? notFound(id);
  }
}

describe('inlineSnippetRefsInGuide', () => {
  it('returns the guide unchanged when there are no refs', async () => {
    const guide: JsonGuide = {
      id: 'g',
      title: 'g',
      blocks: [{ type: 'markdown', content: 'hi' }],
    };
    const out = await inlineSnippetRefsInGuide(guide, new StubResolver({}));
    expect(out).toEqual(guide);
  });

  it('replaces a top-level snippet-ref with the snippet blocks at the same position', async () => {
    const guide: JsonGuide = {
      id: 'g',
      title: 'g',
      blocks: [
        { type: 'markdown', content: 'before' },
        { type: 'snippet-ref', snippetId: 's' },
        { type: 'markdown', content: 'after' },
      ],
    };
    const resolver = new StubResolver({
      s: ok('s', [
        { type: 'markdown', content: 'one' },
        { type: 'markdown', content: 'two' },
      ]),
    });
    const out = await inlineSnippetRefsInGuide(guide, resolver);
    expect(out.blocks).toEqual([
      { type: 'markdown', content: 'before' },
      { type: 'markdown', content: 'one' },
      { type: 'markdown', content: 'two' },
      { type: 'markdown', content: 'after' },
    ]);
  });

  it('replaces a snippet-ref nested inside a section', async () => {
    const guide: JsonGuide = {
      id: 'g',
      title: 'g',
      blocks: [
        {
          type: 'section',
          title: 'Setup',
          blocks: [{ type: 'snippet-ref', snippetId: 's' }],
        },
      ],
    };
    const resolver = new StubResolver({ s: ok('s', [{ type: 'markdown', content: 'inner' }]) });
    const out = await inlineSnippetRefsInGuide(guide, resolver);
    expect(out.blocks[0]).toMatchObject({
      type: 'section',
      blocks: [{ type: 'markdown', content: 'inner' }],
    });
  });

  it('replaces a snippet-ref nested in a conditional branch', async () => {
    const guide: JsonGuide = {
      id: 'g',
      title: 'g',
      blocks: [
        {
          type: 'conditional',
          conditions: ['has-datasource:prometheus'],
          whenTrue: [{ type: 'snippet-ref', snippetId: 's' }],
          whenFalse: [],
        },
      ],
    };
    const resolver = new StubResolver({ s: ok('s', [{ type: 'markdown', content: 't' }]) });
    const out = await inlineSnippetRefsInGuide(guide, resolver);
    expect(out.blocks[0]).toMatchObject({
      type: 'conditional',
      whenTrue: [{ type: 'markdown', content: 't' }],
      whenFalse: [],
    });
  });

  it('renders an inert placeholder block when a snippet fails to resolve', async () => {
    const guide: JsonGuide = {
      id: 'g',
      title: 'g',
      blocks: [{ type: 'snippet-ref', snippetId: 'missing' }],
    };
    const out = await inlineSnippetRefsInGuide(guide, new StubResolver({}));
    expect(out.blocks).toHaveLength(1);
    const placeholder = out.blocks[0]!;
    expect(placeholder.type).toBe('markdown');
    expect((placeholder as { content: string }).content).toMatch(/missing/);
  });
});
