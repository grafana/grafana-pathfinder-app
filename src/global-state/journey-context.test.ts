import {
  setActiveJourneyContext,
  getActiveJourneyCompletionPercentage,
  getJourneyCompletionPercentageFor,
  primeJourneyCompletedMilestones,
  noteMilestoneCompleted,
  clearJourneyCompletedMilestonesCache,
  resetJourneyContextForTests,
} from './journey-context';
import { getGuideProgress } from './completion-store';

jest.mock('./completion-store', () => ({
  getGuideProgress: jest.fn(() => ({ completed: 0, total: 0, percentage: 0 })),
}));

jest.mock('./content-key', () => ({
  getContentKey: jest.fn(() => 'https://example.com/lj/m2/content.json'),
}));

const mockGetGuideProgress = getGuideProgress as jest.Mock;

const JOURNEY = 'https://example.com/lj';
const ROSTER = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'];

function setContext(overrides: Partial<Parameters<typeof setActiveJourneyContext>[0] & object> = {}) {
  setActiveJourneyContext({
    journeyUrl: JOURNEY,
    milestoneNumber: 2,
    totalMilestones: 6,
    activeMilestoneSlug: 'm2',
    milestoneSlugs: ROSTER,
    ...overrides,
  });
}

describe('journey-context completion', () => {
  beforeEach(() => {
    resetJourneyContextForTests();
    mockGetGuideProgress.mockReturnValue({ completed: 0, total: 0, percentage: 0 });
  });

  it('returns null with no active context and 0 for a zero-milestone journey', () => {
    expect(getActiveJourneyCompletionPercentage()).toBeNull();
    setContext({ totalMilestones: 0 });
    expect(getActiveJourneyCompletionPercentage()).toBe(0);
  });

  it('counts completed milestones from the cache', () => {
    setContext();
    primeJourneyCompletedMilestones(JOURNEY, ['m1', 'm3']);
    expect(getActiveJourneyCompletionPercentage()).toBe(33);
  });

  it('adds the active milestone step fraction when it is not yet completed', () => {
    setContext();
    primeJourneyCompletedMilestones(JOURNEY, ['m1']);
    mockGetGuideProgress.mockReturnValue({ completed: 3, total: 6, percentage: 50 });
    // (1 completed + 0.5 fraction) / 6 = 25
    expect(getActiveJourneyCompletionPercentage()).toBe(25);
  });

  it('never double-counts a completed active milestone', () => {
    setContext();
    primeJourneyCompletedMilestones(JOURNEY, ['m1', 'm2']);
    mockGetGuideProgress.mockReturnValue({ completed: 6, total: 6, percentage: 100 });
    // m2 counted once via the set; fraction not added on top.
    expect(getActiveJourneyCompletionPercentage()).toBe(33);
  });

  it('adds no fraction on the cover page (milestone 0)', () => {
    setContext({ milestoneNumber: 0, activeMilestoneSlug: 'lj' });
    primeJourneyCompletedMilestones(JOURNEY, ['m1', 'm2']);
    mockGetGuideProgress.mockReturnValue({ completed: 3, total: 3, percentage: 100 });
    expect(getActiveJourneyCompletionPercentage()).toBe(33);
  });

  it('reports actual completion on the end-journey page (never a forced 100)', () => {
    setContext({ milestoneNumber: 6, activeMilestoneSlug: 'end-journey' });
    primeJourneyCompletedMilestones(JOURNEY, ['m1', 'm2', 'm3']);
    mockGetGuideProgress.mockReturnValue({ completed: 0, total: 0, percentage: 0 });
    expect(getActiveJourneyCompletionPercentage()).toBe(50);
  });

  it('ignores stale slugs and the step-less cover wart via roster intersection', () => {
    setContext();
    primeJourneyCompletedMilestones(JOURNEY, ['m1', 'renamed-away', 'lj']);
    expect(getActiveJourneyCompletionPercentage()).toBe(17);
  });

  it('clamps the degraded no-roster fallback to the total', () => {
    setContext({ milestoneSlugs: undefined, activeMilestoneSlug: undefined, totalMilestones: 2 });
    primeJourneyCompletedMilestones(JOURNEY, ['a', 'b', 'c']);
    expect(getActiveJourneyCompletionPercentage()).toBe(100);
  });

  it('union-merges primes so a late prime never drops a noted slug', () => {
    setContext();
    noteMilestoneCompleted(JOURNEY, 'm4');
    primeJourneyCompletedMilestones(JOURNEY, ['m1']);
    expect(getActiveJourneyCompletionPercentage()).toBe(33);
  });

  it('normalizes trailing slashes on journey URLs', () => {
    setContext();
    noteMilestoneCompleted(`${JOURNEY}/`, 'm1');
    expect(getActiveJourneyCompletionPercentage()).toBe(17);
  });

  describe('getJourneyCompletionPercentageFor', () => {
    it('delegates to the live active supplier for the active journey', () => {
      setContext();
      primeJourneyCompletedMilestones(JOURNEY, ['m1']);
      mockGetGuideProgress.mockReturnValue({ completed: 3, total: 6, percentage: 50 });
      expect(getJourneyCompletionPercentageFor(JOURNEY, ROSTER, 6)).toBe(25);
    });

    it('returns milestone-level completion without fraction for background journeys', () => {
      setContext();
      primeJourneyCompletedMilestones('https://example.com/other-lj', ['a', 'b']);
      mockGetGuideProgress.mockReturnValue({ completed: 3, total: 6, percentage: 50 });
      expect(getJourneyCompletionPercentageFor('https://example.com/other-lj', ['a', 'b', 'c', 'd'], 4)).toBe(50);
    });

    it('returns null when nothing is cached for the journey', () => {
      expect(getJourneyCompletionPercentageFor('https://example.com/unknown-lj', ['a'], 4)).toBeNull();
    });
  });

  it('clearJourneyCompletedMilestonesCache clears one journey or all', () => {
    setContext();
    primeJourneyCompletedMilestones(JOURNEY, ['m1']);
    primeJourneyCompletedMilestones('https://example.com/other-lj', ['a']);
    clearJourneyCompletedMilestonesCache(JOURNEY);
    expect(getActiveJourneyCompletionPercentage()).toBe(0);
    expect(getJourneyCompletionPercentageFor('https://example.com/other-lj', ['a'], 2)).toBe(50);
    clearJourneyCompletedMilestonesCache();
    expect(getJourneyCompletionPercentageFor('https://example.com/other-lj', ['a'], 2)).toBeNull();
  });
});
