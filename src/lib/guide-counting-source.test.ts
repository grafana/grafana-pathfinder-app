import { createPreparedContent, rewriteGuideTrees, selectCountingTree } from './guide-counting-source';
import type { RawContent } from '../types/content.types';
import type { JsonGuide } from '../types/json-guide.types';

const fetched: RawContent = {
  content: '{"id":"g","title":"g","blocks":[]}',
  metadata: { title: 'g' },
  type: 'interactive',
  url: 'bundled:g',
  lastFetched: '2026-09-15T00:00:00.000Z',
};

const countingGuide: JsonGuide = {
  id: 'g',
  title: 'g',
  blocks: [{ type: 'snippet-ref', snippetId: 'two-block-snippet' }],
};

const expandedGuide: JsonGuide = {
  id: 'g',
  title: 'g',
  blocks: [
    { type: 'markdown', content: 'one' },
    { type: 'markdown', content: 'two' },
  ],
};

describe('createPreparedContent', () => {
  it('serializes the expanded tree to render and the pre-inlining tree to count', () => {
    const prepared = createPreparedContent({ fetched, countingGuide, expandedGuide });

    expect(JSON.parse(prepared.content)).toEqual(expandedGuide);
    expect(JSON.parse(prepared.countingSource.guideJson)).toEqual(countingGuide);
  });

  it('carries the fetched payload url, type and metadata through', () => {
    const prepared = createPreparedContent({ fetched, countingGuide, expandedGuide });

    expect(prepared.url).toBe('bundled:g');
    expect(prepared.type).toBe('interactive');
    expect(prepared.metadata).toEqual({ title: 'g' });
  });
});

describe('selectCountingTree', () => {
  it('counts the rendered tree when no source is named — every direct open', () => {
    expect(selectCountingTree(fetched.content, undefined)).toEqual({ available: true, guideJson: fetched.content });
  });

  it('counts the preserved pre-inlining tree, not the expanded one', () => {
    const prepared = createPreparedContent({ fetched, countingGuide, expandedGuide });

    expect(selectCountingTree(prepared.content, prepared.countingSource)).toEqual({
      available: true,
      guideJson: prepared.countingSource.guideJson,
    });
  });

  // Substituting the expanded tree here is exactly the defect: its count is
  // not the canonical one, and the frozen index would keep it.
  it('declines rather than substituting the expanded tree when the source was lost', () => {
    expect(selectCountingTree(JSON.stringify(expandedGuide), { kind: 'unavailable' })).toEqual({ available: false });
  });
});

describe('rewriteGuideTrees', () => {
  it('rewrites the rendered tree alone when there is no separate counting tree', () => {
    const rewritten = rewriteGuideTrees(fetched, () => 'rewritten');

    expect(rewritten.content).toBe('rewritten');
    expect(rewritten.countingSource).toBeUndefined();
  });

  it('rewrites both trees, so they keep differing only by snippet expansion', () => {
    const prepared = createPreparedContent({ fetched, countingGuide, expandedGuide });

    const rewritten = rewriteGuideTrees(prepared, (guideJson) => `${guideJson}!`);

    expect(rewritten.content).toBe(`${prepared.content}!`);
    expect(rewritten.countingSource).toEqual({
      kind: 'pre-inlining',
      guideJson: `${prepared.countingSource.guideJson}!`,
    });
  });

  it('leaves a lost counting source lost rather than rebuilding one', () => {
    const rewritten = rewriteGuideTrees(
      { ...fetched, countingSource: { kind: 'unavailable' } },
      (guideJson) => `${guideJson}!`
    );

    expect(rewritten.countingSource).toEqual({ kind: 'unavailable' });
  });
});
