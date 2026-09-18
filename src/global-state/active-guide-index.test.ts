import { computeGuideBlockIndex } from '../lib/guide-stats';
import { publishGuideIndex, getGuideIndex, evictGuideIndex, evictAllGuideIndexes } from './active-guide-index';

function fakeIndex(totalBlockCount: number) {
  return computeGuideBlockIndex(Array.from({ length: totalBlockCount }, () => ({ type: 'markdown' })));
}

describe('active-guide-index', () => {
  afterEach(() => {
    evictAllGuideIndexes();
  });

  it('returns undefined for a content key that was never published', () => {
    expect(getGuideIndex('bundled:unknown')).toBeUndefined();
  });

  it('publishes and reads back an index for a content key', () => {
    const index = fakeIndex(5);
    publishGuideIndex({ contentKey: 'bundled:guide-1', index, denominatorSource: 'live-pre-inlining' });

    expect(getGuideIndex('bundled:guide-1')).toEqual({
      contentKey: 'bundled:guide-1',
      index,
      denominatorSource: 'live-pre-inlining',
    });
  });

  it('is idempotent — a second publish for the same content key is ignored', () => {
    const first = fakeIndex(5);
    const second = fakeIndex(9);
    publishGuideIndex({ contentKey: 'bundled:guide-1', index: first, denominatorSource: 'live-pre-inlining' });
    publishGuideIndex({ contentKey: 'bundled:guide-1', index: second, denominatorSource: 'live-pre-inlining' });

    expect(getGuideIndex('bundled:guide-1')?.index).toBe(first);
  });

  it('evictGuideIndex lets the next publish for that key take effect', () => {
    const first = fakeIndex(5);
    const second = fakeIndex(9);
    publishGuideIndex({ contentKey: 'bundled:guide-1', index: first, denominatorSource: 'live-pre-inlining' });

    evictGuideIndex('bundled:guide-1');
    publishGuideIndex({ contentKey: 'bundled:guide-1', index: second, denominatorSource: 'live-pre-inlining' });

    expect(getGuideIndex('bundled:guide-1')?.index).toBe(second);
  });

  it('evictGuideIndex on an unknown key is a no-op', () => {
    expect(() => evictGuideIndex('bundled:never-published')).not.toThrow();
  });

  it('evictAllGuideIndexes clears every content key', () => {
    publishGuideIndex({ contentKey: 'bundled:a', index: fakeIndex(1), denominatorSource: 'live-pre-inlining' });
    publishGuideIndex({ contentKey: 'bundled:b', index: fakeIndex(2), denominatorSource: 'live-pre-inlining' });

    evictAllGuideIndexes();

    expect(getGuideIndex('bundled:a')).toBeUndefined();
    expect(getGuideIndex('bundled:b')).toBeUndefined();
  });

  it('keeps distinct content keys independent', () => {
    const a = fakeIndex(3);
    const b = fakeIndex(7);
    publishGuideIndex({ contentKey: 'bundled:a', index: a, denominatorSource: 'live-pre-inlining' });
    publishGuideIndex({ contentKey: 'bundled:b', index: b, denominatorSource: 'live-post-inlining-degraded' });

    expect(getGuideIndex('bundled:a')?.index.totalBlockCount).toBe(3);
    expect(getGuideIndex('bundled:b')?.index.totalBlockCount).toBe(7);
    expect(getGuideIndex('bundled:b')?.denominatorSource).toBe('live-post-inlining-degraded');
  });
});
