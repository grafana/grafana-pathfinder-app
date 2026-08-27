import { getMilestoneSlug, getNextMilestoneUrl, getPreviousMilestoneUrl } from './learning-journey-helpers';
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
