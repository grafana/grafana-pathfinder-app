/**
 * Milestone traversal tests focused on locked-milestone skip behavior
 * (RFC CUSTOM-GUIDE-PACKAGES.md §6.5) — a path whose next/previous member
 * hasn't published yet must not dead-end the toolbar.
 */
import { getNextMilestoneUrl, getPreviousMilestoneUrl } from './learning-journey-helpers';
import type { RawContent, Milestone } from '../types/content.types';

function milestone(number: number, overrides: Partial<Milestone> = {}): Milestone {
  return {
    number,
    title: `Milestone ${number}`,
    duration: '5-10 min',
    url: `backend-guide:milestone-${number}`,
    isActive: false,
    ...overrides,
  };
}

function journeyContent(currentMilestone: number, milestones: Milestone[], baseUrl = 'backend-guide:path'): RawContent {
  return {
    content: '',
    type: 'learning-journey',
    url: 'backend-guide:path',
    lastFetched: new Date().toISOString(),
    metadata: {
      title: 'Test path',
      learningJourney: {
        currentMilestone,
        totalMilestones: milestones.length,
        milestones,
        baseUrl,
      },
    },
  };
}

describe('getNextMilestoneUrl', () => {
  it('returns the immediate next milestone when it is resolved', () => {
    const content = journeyContent(1, [milestone(1), milestone(2), milestone(3)]);
    expect(getNextMilestoneUrl(content)).toBe('backend-guide:milestone-2');
  });

  it('skips a locked next milestone and returns the next resolved one', () => {
    const content = journeyContent(1, [milestone(1), milestone(2, { isLocked: true, url: '' }), milestone(3)]);
    expect(getNextMilestoneUrl(content)).toBe('backend-guide:milestone-3');
  });

  it('skips a run of consecutive locked milestones', () => {
    const content = journeyContent(1, [
      milestone(1),
      milestone(2, { isLocked: true, url: '' }),
      milestone(3, { isLocked: true, url: '' }),
      milestone(4),
    ]);
    expect(getNextMilestoneUrl(content)).toBe('backend-guide:milestone-4');
  });

  it('returns null when every remaining milestone is locked', () => {
    const content = journeyContent(1, [milestone(1), milestone(2, { isLocked: true, url: '' })]);
    expect(getNextMilestoneUrl(content)).toBeNull();
  });

  it('returns null when already on the last milestone', () => {
    const content = journeyContent(2, [milestone(1), milestone(2)]);
    expect(getNextMilestoneUrl(content)).toBeNull();
  });

  it('returns null for non-journey content', () => {
    const content: RawContent = {
      content: '',
      type: 'single-doc',
      url: 'x',
      lastFetched: new Date().toISOString(),
      metadata: { title: 'x' },
    };
    expect(getNextMilestoneUrl(content)).toBeNull();
  });
});

describe('getPreviousMilestoneUrl', () => {
  it('returns the immediate previous milestone when it is resolved', () => {
    const content = journeyContent(2, [milestone(1), milestone(2), milestone(3)]);
    expect(getPreviousMilestoneUrl(content)).toBe('backend-guide:milestone-1');
  });

  it('skips a locked previous milestone and returns the nearest resolved one', () => {
    const content = journeyContent(3, [milestone(1), milestone(2, { isLocked: true, url: '' }), milestone(3)]);
    expect(getPreviousMilestoneUrl(content)).toBe('backend-guide:milestone-1');
  });

  it('falls back to the cover page (baseUrl) when every prior milestone is locked', () => {
    const content = journeyContent(2, [milestone(1, { isLocked: true, url: '' }), milestone(2)], 'backend-guide:cover');
    expect(getPreviousMilestoneUrl(content)).toBe('backend-guide:cover');
  });

  it('returns the cover page (baseUrl) from milestone 1', () => {
    const content = journeyContent(1, [milestone(1), milestone(2)], 'backend-guide:cover');
    expect(getPreviousMilestoneUrl(content)).toBe('backend-guide:cover');
  });

  it('returns null when already on the cover page (milestone 0)', () => {
    const content = journeyContent(0, [milestone(1), milestone(2)]);
    expect(getPreviousMilestoneUrl(content)).toBeNull();
  });
});
