import {
  getGuideCompletionSource,
  markGuideEndViewed,
  markStepCompleted,
  peekGuidePercentage,
  refreshGuidePercentageOnLoad,
  resetCompletionStoreForTests,
} from './completion-store';
import { resetContentKeyForTests, setActiveTabUrl } from './content-key';
import { publishGuideIndex } from './active-guide-index';
import { computeGuideBlockIndex, type CountableBlock } from '../lib/guide-stats';
import { guideCompletionMarkStorage, interactiveStepStorage } from '../lib/user-storage';

const PROSE = 'bundled:prose-only';
const STEPS = 'bundled:steps-then-prose';
const DOCS = 'https://grafana.com/docs/grafana/latest/fundamentals/';
const SECTION = 'section-one';

function publish(contentKey: string, blocks: CountableBlock[]) {
  publishGuideIndex({ contentKey, denominatorSource: 'live-pre-inlining', index: computeGuideBlockIndex(blocks) });
}

const proseBlocks: CountableBlock[] = [{ type: 'markdown' }, { type: 'markdown' }];
const stepBlocks: CountableBlock[] = [
  { type: 'interactive', id: 'first' },
  { type: 'interactive', id: 'last' },
  { type: 'markdown' },
  { type: 'markdown' },
];

beforeEach(async () => {
  localStorage.clear();
  await interactiveStepStorage.clearAll();
  resetCompletionStoreForTests();
  resetContentKeyForTests();
});

describe('a prose-only guide', () => {
  beforeEach(() => {
    setActiveTabUrl(PROSE);
    publish(PROSE, proseBlocks);
  });

  it('is incomplete until its end is seen', () => {
    expect(peekGuidePercentage(PROSE)).toBe(0);
  });

  it('completes as objectives when its end is seen', async () => {
    expect(markGuideEndViewed(PROSE, true)).toBe(true);
    expect(peekGuidePercentage(PROSE)).toBe(100);
    expect(getGuideCompletionSource(PROSE)).toBe('objectives');
    await expect(guideCompletionMarkStorage.get(PROSE)).resolves.toBe(true);
  });

  it('still reads 100% after a reload and its load-time recompute', () => {
    markGuideEndViewed(PROSE, true);
    resetCompletionStoreForTests();
    publish(PROSE, proseBlocks);
    refreshGuidePercentageOnLoad(PROSE);
    expect(peekGuidePercentage(PROSE)).toBe(100);
    expect(getGuideCompletionSource(PROSE)).toBe('objectives');
  });

  it('can be viewed again after its mark is reset', async () => {
    markGuideEndViewed(PROSE, true);
    await guideCompletionMarkStorage.clear(PROSE);
    expect(peekGuidePercentage(PROSE)).toBe(0);
    expect(markGuideEndViewed(PROSE, true)).toBe(true);
  });

  it('keeps a click as the source when the guide was already marked complete', async () => {
    await guideCompletionMarkStorage.set(PROSE, true);
    expect(markGuideEndViewed(PROSE, true)).toBe(false);
    expect(getGuideCompletionSource(PROSE)).toBe('manual');
  });
});

describe('a guide with completable blocks', () => {
  beforeEach(() => {
    setActiveTabUrl(STEPS);
    publish(STEPS, stepBlocks);
  });

  it('ignores its end being seen', () => {
    expect(markGuideEndViewed(STEPS, true)).toBe(false);
    expect(guideCompletionMarkStorage.isMarked(STEPS)).toBe(false);
    expect(peekGuidePercentage(STEPS)).toBe(0);
  });

  it('completes at the final interactive block without the trailing prose', async () => {
    markStepCompleted('first', SECTION, 'manual');
    await Promise.resolve();
    expect(peekGuidePercentage(STEPS)).toBe(25);
    markStepCompleted('last', SECTION, 'objectives');
    await Promise.resolve();
    expect(peekGuidePercentage(STEPS)).toBe(100);
    expect(getGuideCompletionSource(STEPS)).toBe('objectives');
  });

  it('completes as skipped when the final interactive block is skipped', async () => {
    markStepCompleted('first', SECTION, 'manual');
    markStepCompleted('last', SECTION, 'skipped');
    await Promise.resolve();
    expect(peekGuidePercentage(STEPS)).toBe(100);
    expect(getGuideCompletionSource(STEPS)).toBe('skipped');
  });
});

describe('content with no block index', () => {
  it('treats a docs page as prose-only', () => {
    setActiveTabUrl(DOCS);
    expect(markGuideEndViewed(DOCS, false)).toBe(true);
    expect(peekGuidePercentage(DOCS)).toBe(100);
  });

  it('waits for a guide whose index has not published yet', () => {
    setActiveTabUrl(PROSE);
    expect(markGuideEndViewed(PROSE, true)).toBe(false);
    expect(guideCompletionMarkStorage.isMarked(PROSE)).toBe(false);
  });
});

it('never persists a block-editor preview', () => {
  const preview = 'block-editor://preview/draft';
  publish(preview, proseBlocks);
  expect(markGuideEndViewed(preview, true)).toBe(false);
  expect(guideCompletionMarkStorage.isMarked(preview)).toBe(false);
});
