/**
 * Boundary-nav invariants the cover-page landing relies on (issue #1467,
 * feature 3): on the cover page (milestone 0) there is no previous milestone,
 * and on the last milestone there is no next one. The shared milestone toolbar
 * disables its arrows off these results, so landing on the cover disables Back
 * with no extra nav code.
 */

import { getNextMilestoneUrl, getPreviousMilestoneUrl } from './learning-journey-helpers';
import type { RawContent, Milestone } from '../types/content.types';

const baseUrl = 'https://grafana.com/docs/learning-paths/demo/';
const milestones: Milestone[] = [
  { number: 1, title: 'One', duration: '', url: `${baseUrl}one/`, isActive: false },
  { number: 2, title: 'Two', duration: '', url: `${baseUrl}two/`, isActive: false },
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
