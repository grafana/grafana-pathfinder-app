/**
 * Behavioural tests for the serializable summary and the milestone rollup.
 */

import type { CountableBlock } from './block-index';
import { GUIDE_STATS_VERSION, rollUpGuideStats, summarizeGuideBlocks } from './summary';

const markdown = (): CountableBlock => ({ type: 'markdown' });
const interactive = (): CountableBlock => ({ type: 'interactive' });

describe('summarizeGuideBlocks', () => {
  it('publishes the denominator and the counts a reader needs without the guide body', () => {
    const summary = summarizeGuideBlocks([{ type: 'section', blocks: [markdown(), interactive()] }, markdown()]);

    expect(summary).toEqual({
      version: GUIDE_STATS_VERSION,
      blockCount: 3,
      sectionCount: 1,
      interactiveBlockCount: 1,
      finalInteractivePosition: 2,
    });
  });

  it('emits keys in a fixed order so a build step writing it is byte-stable', () => {
    const keys = Object.keys(summarizeGuideBlocks([markdown()]));

    expect(keys).toEqual([
      'version',
      'blockCount',
      'sectionCount',
      'interactiveBlockCount',
      'finalInteractivePosition',
    ]);
  });

  it('summarizes an empty guide without special casing', () => {
    expect(summarizeGuideBlocks([])).toMatchObject({ blockCount: 0, finalInteractivePosition: 0 });
  });
});

describe('rollUpGuideStats', () => {
  const first = summarizeGuideBlocks([markdown(), interactive(), markdown()]);
  const second = summarizeGuideBlocks([{ type: 'section', blocks: [interactive(), markdown()] }]);
  const prose = summarizeGuideBlocks([markdown(), markdown()]);

  it('sums the counts of its parts', () => {
    expect(rollUpGuideStats([first, second])).toMatchObject({
      blockCount: 5,
      sectionCount: 1,
      interactiveBlockCount: 2,
    });
  });

  it('offsets the final interactive position into the concatenation', () => {
    expect(rollUpGuideStats([first, second]).finalInteractivePosition).toBe(4);
    expect(rollUpGuideStats([second, first]).finalInteractivePosition).toBe(4);
  });

  it('keeps the last part that has an interactive block, not the last part', () => {
    expect(rollUpGuideStats([first, prose]).finalInteractivePosition).toBe(2);
  });

  it('reports no interactive position when no part has one', () => {
    expect(rollUpGuideStats([prose, prose]).finalInteractivePosition).toBe(0);
  });

  it('rolls up an empty list to zeroes', () => {
    expect(rollUpGuideStats([])).toEqual({
      version: GUIDE_STATS_VERSION,
      blockCount: 0,
      sectionCount: 0,
      interactiveBlockCount: 0,
      finalInteractivePosition: 0,
    });
  });

  it('is associative, so grouping milestones cannot change the result', () => {
    const flat = rollUpGuideStats([first, second, prose]);
    const grouped = rollUpGuideStats([rollUpGuideStats([first, second]), prose]);

    expect(grouped).toEqual(flat);
  });

  it('lets a metapackage with no body of its own contribute a zero part', () => {
    const empty = summarizeGuideBlocks([]);

    expect(rollUpGuideStats([empty, first, second])).toEqual(rollUpGuideStats([first, second]));
  });
});
