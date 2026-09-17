import {
  getMilestoneSlug,
  getNextMilestoneUrl,
  getPreviousMilestoneUrl,
  getNextMilestoneId,
  getPreviousMilestoneId,
} from './learning-journey-helpers';
import type { RawContent, Milestone } from '../types/content.types';

const baseUrl = 'https://grafana.com/docs/learning-paths/demo/';
const milestones: Milestone[] = [
  { number: 1, title: 'One', url: `${baseUrl}one/`, isActive: false },
  { number: 2, title: 'Two', url: `${baseUrl}two/`, isActive: false },
];

function contentAtMilestone(currentMilestone: number): RawContent {
  return {
    content: '{}',
    url: baseUrl,
    type: 'learning-journey',
    lastFetched: '2026-07-30T00:00:00.000Z',
    metadata: {
      title: 'Demo',
      learningJourney: { currentMilestone, totalMilestones: milestones.length, milestones, baseUrl },
    },
  } as RawContent;
}

describe('milestone navigation boundaries', () => {
  it('has no previous milestone on the cover page (milestone 0)', () => {
    expect(getPreviousMilestoneUrl(contentAtMilestone(0))).toBeNull();
  });

  it('returns the cover base URL as the previous target from milestone 1', () => {
    expect(getPreviousMilestoneUrl(contentAtMilestone(1))).toBe(baseUrl);
  });

  it('has no next milestone on the last milestone', () => {
    expect(getNextMilestoneUrl(contentAtMilestone(2))).toBeNull();
  });

  it('advances to the next milestone from the cover page', () => {
    expect(getNextMilestoneUrl(contentAtMilestone(0))).toBe(`${baseUrl}one/`);
  });
});

// Regression (code-review self-check on PR #1927, round 5, structural
// classification fix): the toolbar's Next/Previous arrows and Alt+arrow
// shortcuts call docs-panel.tsx's navigateToNextMilestone/
// navigateToPreviousMilestone, which thread these ids through loadTab's
// explicitGuideId so that navigation also classifies by direct id lookup,
// not the URL-comparison fallback.
const idMilestones: Milestone[] = [
  { id: 'step-one', number: 1, title: 'One', url: `${baseUrl}one/`, isActive: false },
  { id: 'step-two', number: 2, title: 'Two', url: `${baseUrl}two/`, isActive: false },
];

function contentAtMilestoneWithIds(currentMilestone: number): RawContent {
  return {
    content: '{}',
    url: baseUrl,
    type: 'learning-journey',
    lastFetched: '2026-07-30T00:00:00.000Z',
    metadata: {
      title: 'Demo',
      learningJourney: { currentMilestone, totalMilestones: idMilestones.length, milestones: idMilestones, baseUrl },
    },
  } as RawContent;
}

describe('milestone navigation boundaries (guide ids)', () => {
  it('has no previous milestone id on the cover page (milestone 0)', () => {
    expect(getPreviousMilestoneId(contentAtMilestoneWithIds(0))).toBeUndefined();
  });

  it('has no previous milestone id from milestone 1 (falls back to the cover page, which has no guide id)', () => {
    expect(getPreviousMilestoneId(contentAtMilestoneWithIds(1))).toBeUndefined();
  });

  it('returns the previous milestone id from milestone 2', () => {
    expect(getPreviousMilestoneId(contentAtMilestoneWithIds(2))).toBe('step-one');
  });

  it('has no next milestone id on the last milestone', () => {
    expect(getNextMilestoneId(contentAtMilestoneWithIds(2))).toBeUndefined();
  });

  it('advances to the next milestone id from the cover page', () => {
    expect(getNextMilestoneId(contentAtMilestoneWithIds(0))).toBe('step-one');
  });
});

describe('getMilestoneSlug', () => {
  it.each([
    ['https://grafana.com/docs/learning-paths/demo/set-up/', 'set-up'],
    ['https://grafana.com/docs/learning-paths/demo/set-up/content.json', 'set-up'],
    ['https://grafana.com/docs/learning-paths/demo/set-up/unstyled.html', 'set-up'],
    ['', ''],
  ])('extracts the milestone slug from %s', (url, expected) => {
    expect(getMilestoneSlug(url)).toBe(expected);
  });
});
