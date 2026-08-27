/**
 * Milestone traversal tests focused on locked-milestone skip behavior
 * (RFC CUSTOM-GUIDE-PACKAGES.md §6.5) — a path whose next/previous member
 * hasn't published yet must not dead-end the toolbar.
 */
import {
  countUnlockedMilestones,
  generateJourneyContentWithExtras,
  getMilestoneSlug,
  getNextMilestoneUrl,
  getPreviousMilestoneUrl,
  isLastMilestone,
} from './learning-journey-helpers';
import type { RawContent, Milestone, LearningJourneyMetadata } from '../types/content.types';

function milestone(number: number, overrides: Partial<Milestone> = {}): Milestone {
  return {
    number,
    title: `Milestone ${number}`,
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

describe('getMilestoneSlug', () => {
  it('strips the backend-guide: scheme so private members key on the bare id (finding #1)', () => {
    expect(getMilestoneSlug('backend-guide:fe-alerting-01')).toBe('fe-alerting-01');
  });

  it('leaves path-style doc URLs untouched (last segment)', () => {
    expect(getMilestoneSlug('https://grafana.com/docs/learning-paths/linux/select-platform/')).toBe('select-platform');
    expect(getMilestoneSlug('https://grafana.com/docs/.../select-platform/content.json')).toBe('select-platform');
  });
});

function ljMetadata(currentMilestone: number, milestones: Milestone[]): LearningJourneyMetadata {
  return {
    title: 'Test path',
    currentMilestone,
    totalMilestones: milestones.length,
    milestones,
    baseUrl: 'backend-guide:path',
  } as LearningJourneyMetadata;
}

describe('countUnlockedMilestones', () => {
  it('counts only unlocked (navigable) milestones', () => {
    expect(countUnlockedMilestones([milestone(1), milestone(2, { isLocked: true, url: '' }), milestone(3)])).toBe(2);
  });
});

describe('isLastMilestone (locked-aware)', () => {
  it('is true on the last UNLOCKED milestone even when locked entries follow', () => {
    const content = journeyContent(2, [milestone(1), milestone(2), milestone(3, { isLocked: true, url: '' })]);
    expect(isLastMilestone(content)).toBe(true);
  });

  it('is false on a milestone that still has an unlocked successor', () => {
    const content = journeyContent(1, [milestone(1), milestone(2), milestone(3)]);
    expect(isLastMilestone(content)).toBe(false);
  });
});

describe('generateJourneyContentWithExtras — locked-milestone handling', () => {
  it('cover CTA targets the first UNLOCKED milestone, not a locked milestone 1', () => {
    const html = generateJourneyContentWithExtras(
      '',
      ljMetadata(0, [milestone(1, { isLocked: true, url: '' }), milestone(2, { url: 'backend-guide:m2' })])
    );
    expect(html).toContain('data-milestone-url="backend-guide:m2"');
    expect(html).not.toContain('data-milestone-url=""');
  });

  it('omits the cover CTA entirely when nothing is published yet', () => {
    const html = generateJourneyContentWithExtras(
      '',
      ljMetadata(0, [milestone(1, { isLocked: true, url: '' }), milestone(2, { isLocked: true, url: '' })])
    );
    expect(html).not.toContain('data-journey-start');
  });

  it('hides the bottom "Next →" when every remaining milestone is locked', () => {
    const html = generateJourneyContentWithExtras(
      '',
      ljMetadata(2, [milestone(1), milestone(2), milestone(3, { isLocked: true, url: '' })])
    );
    expect(html).not.toContain('Next →');
  });

  it('still renders "Next →" when an unlocked successor exists', () => {
    const html = generateJourneyContentWithExtras('', ljMetadata(1, [milestone(1), milestone(2), milestone(3)]));
    expect(html).toContain('Next →');
  });
});

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
