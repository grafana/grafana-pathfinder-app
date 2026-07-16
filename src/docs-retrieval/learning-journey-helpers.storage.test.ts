import { getJourneyCompletionPercentageAsync, recordJourneyCompletion } from './learning-journey-helpers';
import { journeyCompletionStorage } from '../lib/user-storage';
import { markGuideCompleted } from '../learning-paths';

jest.mock('../lib/user-storage', () => {
  const store = new Map<string, number>();
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
    milestoneCompletionStorage: { get: jest.fn(async () => []), set: jest.fn(), clear: jest.fn() },
    learningProgressStorage: { get: jest.fn(), set: jest.fn(), clear: jest.fn() },
  };
});

jest.mock('../learning-paths', () => ({
  markGuideCompleted: jest.fn(async () => undefined),
}));

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
