import {
  getJourneyCompletionPercentageAsync,
  recordJourneyCompletion,
  markMilestoneDone,
  computeMilestoneCompletionPercentage,
  syncJourneyMilestoneCompletion,
} from './learning-journey-helpers';
import { journeyCompletionStorage, milestoneCompletionStorage } from '../lib/user-storage';
import { noteMilestoneCompleted, primeJourneyCompletedMilestones } from '../global-state/journey-context';
import { markGuideCompleted } from '../learning-paths';
import type { Milestone } from '../types/content.types';

jest.mock('../lib/user-storage', () => {
  const store = new Map<string, number>();
  const milestoneStore = new Map<string, Set<string>>();
  return {
    journeyCompletionStorage: {
      get: jest.fn(async (key: string) => store.get(key) ?? 0),
      set: jest.fn(async (key: string, value: number) => {
        store.set(key, value);
      }),
      clear: jest.fn(async (key: string) => {
        store.delete(key);
      }),
      getAll: jest.fn(async () => Object.fromEntries(store)),
      __store: store,
    },
    milestoneCompletionStorage: {
      getCompleted: jest.fn(async (key: string) => new Set(milestoneStore.get(key) ?? [])),
      markCompleted: jest.fn(async (key: string, slug: string) => {
        const existing = milestoneStore.get(key) ?? new Set<string>();
        existing.add(slug);
        milestoneStore.set(key, existing);
      }),
      clear: jest.fn(async (key: string) => {
        milestoneStore.delete(key);
      }),
      __store: milestoneStore,
    },
    learningProgressStorage: { get: jest.fn(), set: jest.fn(), clear: jest.fn(), awardBadge: jest.fn() },
  };
});

jest.mock('../global-state/journey-context', () => ({
  noteMilestoneCompleted: jest.fn(),
  primeJourneyCompletedMilestones: jest.fn(),
  resetJourneyContextForTests: jest.fn(),
}));

jest.mock('../learning-paths', () => ({
  markGuideCompleted: jest.fn(async () => undefined),
  getPathsData: jest.fn(() => ({ paths: [] })),
}));

function makeMilestone(number: number, slug: string): Milestone {
  return { number, title: slug, duration: '', url: `https://example.com/lj/${slug}/content.json`, isActive: false };
}

const store = (journeyCompletionStorage as unknown as { __store: Map<string, number> }).__store;

describe('journey completion storage', () => {
  beforeEach(() => {
    store.clear();
    jest.clearAllMocks();
  });

  it('records progress monotonically — revisiting an earlier milestone never lowers stored completion', async () => {
    await recordJourneyCompletion('https://example.com/lj', 100);
    await recordJourneyCompletion('https://example.com/lj', 17);

    expect(await getJourneyCompletionPercentageAsync('https://example.com/lj')).toBe(100);
  });

  it('raises stored completion as the user advances', async () => {
    await recordJourneyCompletion('https://example.com/lj', 33);
    await recordJourneyCompletion('https://example.com/lj', 67);

    expect(await getJourneyCompletionPercentageAsync('https://example.com/lj')).toBe(67);
  });

  it('clamps writes to 0-100 (pre-fix builds computed > 100 from raw website milestone numbers)', async () => {
    await recordJourneyCompletion('https://example.com/lj', 117);
    expect(store.get('https://example.com/lj')).toBe(100);
  });

  it('clamps historical bad values on read', async () => {
    store.set('https://example.com/lj', 117);
    expect(await getJourneyCompletionPercentageAsync('https://example.com/lj')).toBe(100);
  });

  it('marks bundled guides completed only when reaching 100%', async () => {
    await recordJourneyCompletion('bundled:first-dashboard', 50);
    expect(markGuideCompleted).not.toHaveBeenCalled();

    await recordJourneyCompletion('bundled:first-dashboard', 100);
    expect(markGuideCompleted).toHaveBeenCalledWith('first-dashboard');
  });
});

describe('milestone-driven journey completion', () => {
  const milestoneStore = (milestoneCompletionStorage as unknown as { __store: Map<string, Set<string>> }).__store;

  beforeEach(() => {
    milestoneStore.clear();
    jest.clearAllMocks();
  });

  it('markMilestoneDone updates the synchronous journey-context cache before any await', () => {
    void markMilestoneDone('https://example.com/lj', 'm2');
    // Assert synchronously — no await — the cache write already happened.
    expect(noteMilestoneCompleted).toHaveBeenCalledWith('https://example.com/lj', 'm2');
  });

  it('computeMilestoneCompletionPercentage intersects against the roster and clamps', () => {
    const milestones = [makeMilestone(1, 'm1'), makeMilestone(2, 'm2'), makeMilestone(3, 'm3')];
    expect(computeMilestoneCompletionPercentage(new Set(), milestones)).toBe(0);
    expect(computeMilestoneCompletionPercentage(new Set(['m1', 'm3']), milestones)).toBe(67);
    expect(computeMilestoneCompletionPercentage(new Set(['m1', 'stale-slug', 'lj']), milestones)).toBe(33);
    expect(computeMilestoneCompletionPercentage(new Set(['m1']), [])).toBe(0);
  });

  it('syncJourneyMilestoneCompletion primes the cache and returns the milestone-level percentage', async () => {
    await milestoneCompletionStorage.markCompleted('https://example.com/lj', 'm1');
    await milestoneCompletionStorage.markCompleted('https://example.com/lj', 'm2');

    const milestones = [makeMilestone(1, 'm1'), makeMilestone(2, 'm2'), makeMilestone(3, 'm3'), makeMilestone(4, 'm4')];
    const pct = await syncJourneyMilestoneCompletion('https://example.com/lj', milestones);

    expect(pct).toBe(50);
    expect(primeJourneyCompletedMilestones).toHaveBeenCalledWith('https://example.com/lj', new Set(['m1', 'm2']));
  });
});
