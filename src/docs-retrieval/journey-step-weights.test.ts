import { resolveJourneyStepWeights, resetJourneyStepWeightsResolverForTests } from './journey-step-weights';
import { fetchContent } from './content-fetcher';
import { getJourneyStepWeights, resetJourneyWeightsForTests } from '../global-state/journey-weights';
import type { Milestone } from '../types/content.types';

jest.mock('./content-fetcher', () => ({
  fetchContent: jest.fn(),
}));

const mockFetchContent = fetchContent as jest.Mock;

const JOURNEY = 'https://example.com/lj';

function milestone(slug: string, number = 1): Milestone {
  return { number, title: slug, duration: '5-10 min', url: `${JOURNEY}/${slug}/content.json`, isActive: false };
}

function guideResult(stepBlockCount: number) {
  const blocks = Array.from({ length: stepBlockCount }, () => ({
    type: 'interactive',
    action: 'noop',
    content: 'x',
  }));
  return { content: { content: JSON.stringify({ id: 'g', title: 'g', blocks }) } };
}

describe('resolveJourneyStepWeights', () => {
  beforeEach(() => {
    resetJourneyStepWeightsResolverForTests();
    resetJourneyWeightsForTests();
    mockFetchContent.mockReset();
  });

  it('fetches all milestones in parallel and stores weights keyed by slug', async () => {
    mockFetchContent.mockImplementation((url: string) => Promise.resolve(guideResult(url.includes('m1') ? 4 : 2)));
    await resolveJourneyStepWeights(JOURNEY, [milestone('m1'), milestone('m2', 2)]);

    expect(mockFetchContent).toHaveBeenCalledTimes(2);
    expect(mockFetchContent).toHaveBeenCalledWith(expect.any(String), {
      skipJourneyMetadata: true,
      timeout: expect.any(Number),
    });
    const weights = getJourneyStepWeights(JOURNEY);
    expect(weights?.get('m1')).toBe(4);
    expect(weights?.get('m2')).toBe(2);
  });

  it('weighs passive, html-wrapped, and malformed milestones as a deterministic 1', async () => {
    mockFetchContent.mockImplementation((url: string) => {
      if (url.includes('passive')) {
        return Promise.resolve(guideResult(0));
      }
      if (url.includes('malformed')) {
        return Promise.resolve({ content: { content: 'not json {' } });
      }
      return Promise.resolve({
        content: { content: JSON.stringify({ id: 'g', title: 'g', blocks: [{ type: 'html', content: '<p/>' }] }) },
      });
    });

    await resolveJourneyStepWeights(JOURNEY, [
      milestone('passive'),
      milestone('malformed', 2),
      milestone('htmlwrapped', 3),
    ]);

    const weights = getJourneyStepWeights(JOURNEY);
    expect(weights?.get('passive')).toBe(1);
    expect(weights?.get('malformed')).toBe(1);
    expect(weights?.get('htmlwrapped')).toBe(1);
  });

  it('leaves the journey unresolved when any milestone fetch fails, so consumers fall back to milestone-equal', async () => {
    mockFetchContent.mockImplementation((url: string) => {
      if (url.includes('broken')) {
        return Promise.reject(new Error('network'));
      }
      if (url.includes('nullcontent')) {
        return Promise.resolve({ content: null, error: 'not found' });
      }
      return Promise.resolve(guideResult(3));
    });

    await resolveJourneyStepWeights(JOURNEY, [milestone('m1'), milestone('broken', 2), milestone('nullcontent', 3)]);

    expect(getJourneyStepWeights(JOURNEY)).toBeNull();
  });

  it('backs off after failure, then retries only failed milestones and publishes once all succeed', async () => {
    jest.useFakeTimers();
    let brokenFails = true;
    mockFetchContent.mockImplementation((url: string) =>
      url.includes('broken') && brokenFails ? Promise.reject(new Error('network')) : Promise.resolve(guideResult(3))
    );
    const roster = [milestone('m1'), milestone('broken', 2)];

    await resolveJourneyStepWeights(JOURNEY, roster);
    expect(mockFetchContent).toHaveBeenCalledTimes(2);
    expect(getJourneyStepWeights(JOURNEY)).toBeNull();

    try {
      brokenFails = false;
      await resolveJourneyStepWeights(JOURNEY, roster);
      expect(mockFetchContent).toHaveBeenCalledTimes(2);

      await jest.advanceTimersByTimeAsync(30_000);
      await resolveJourneyStepWeights(JOURNEY, roster);
      expect(mockFetchContent).toHaveBeenCalledTimes(3);
      const weights = getJourneyStepWeights(JOURNEY);
      expect(weights?.get('m1')).toBe(3);
      expect(weights?.get('broken')).toBe(3);
    } finally {
      jest.useRealTimers();
    }
  });

  it('makes no further fetches once a journey is fully resolved', async () => {
    mockFetchContent.mockImplementation(() => Promise.resolve(guideResult(3)));
    const roster = [milestone('m1'), milestone('m2', 2)];

    await resolveJourneyStepWeights(JOURNEY, roster);
    await resolveJourneyStepWeights(JOURNEY, roster);
    expect(mockFetchContent).toHaveBeenCalledTimes(2);
  });

  it('reuses cached weights for milestone URLs shared across journeys', async () => {
    mockFetchContent.mockImplementation(() => Promise.resolve(guideResult(3)));
    await resolveJourneyStepWeights(JOURNEY, [milestone('m1')]);
    await resolveJourneyStepWeights('https://example.com/other-lj', [milestone('m1'), milestone('m2', 2)]);

    expect(mockFetchContent).toHaveBeenCalledTimes(2);
    expect(getJourneyStepWeights('https://example.com/other-lj')?.get('m1')).toBe(3);
  });

  it('dedupes concurrent resolves of the same journey', async () => {
    mockFetchContent.mockImplementation(() => Promise.resolve(guideResult(2)));
    const roster = [milestone('m1'), milestone('m2', 2)];
    await Promise.all([resolveJourneyStepWeights(JOURNEY, roster), resolveJourneyStepWeights(`${JOURNEY}/`, roster)]);

    expect(mockFetchContent).toHaveBeenCalledTimes(2);
  });

  it('re-resolves when the roster grows, fetching only uncached milestones', async () => {
    mockFetchContent.mockImplementation(() => Promise.resolve(guideResult(2)));
    await resolveJourneyStepWeights(JOURNEY, [milestone('m1')]);
    await resolveJourneyStepWeights(JOURNEY, [milestone('m1'), milestone('m2', 2)]);

    expect(mockFetchContent).toHaveBeenCalledTimes(2);
    const weights = getJourneyStepWeights(JOURNEY);
    expect(weights?.get('m1')).toBe(2);
    expect(weights?.get('m2')).toBe(2);
  });

  it('clears a previously published roster when an expanded roster cannot fully resolve', async () => {
    mockFetchContent.mockResolvedValue(guideResult(2));
    await resolveJourneyStepWeights(JOURNEY, [milestone('m1')]);

    mockFetchContent.mockRejectedValue(new Error('network'));
    await resolveJourneyStepWeights(JOURNEY, [milestone('m1'), milestone('m2', 2)]);

    expect(getJourneyStepWeights(JOURNEY)).toBeNull();
  });

  it('rechecks a concurrent superset roster after the narrower resolution settles', async () => {
    let releaseFirst: ((value: ReturnType<typeof guideResult>) => void) | undefined;
    mockFetchContent.mockImplementation((url: string) => {
      if (url.includes('m1')) {
        return new Promise((resolve) => {
          releaseFirst = resolve;
        });
      }
      return Promise.resolve(guideResult(4));
    });

    const narrow = resolveJourneyStepWeights(JOURNEY, [milestone('m1')]);
    const superset = resolveJourneyStepWeights(JOURNEY, [milestone('m1'), milestone('m2', 2)]);
    releaseFirst?.(guideResult(2));
    await Promise.all([narrow, superset]);

    expect(mockFetchContent).toHaveBeenCalledTimes(2);
    expect(getJourneyStepWeights(JOURNEY)).toEqual(
      new Map([
        ['m1', 2],
        ['m2', 4],
      ])
    );
  });

  it('caps concurrent milestone fetches at six', async () => {
    let active = 0;
    let maxActive = 0;
    const releases: Array<() => void> = [];
    mockFetchContent.mockImplementation(
      () =>
        new Promise((resolve) => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          releases.push(() => {
            active -= 1;
            resolve(guideResult(1));
          });
        })
    );
    const roster = Array.from({ length: 8 }, (_, index) => milestone(`m${index + 1}`, index + 1));

    const resolution = resolveJourneyStepWeights(JOURNEY, roster);
    await Promise.resolve();
    expect(mockFetchContent).toHaveBeenCalledTimes(6);

    releases.splice(0, 6).forEach((release) => release());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockFetchContent).toHaveBeenCalledTimes(8);

    releases.forEach((release) => release());
    await resolution;
    expect(maxActive).toBe(6);
  });

  it('ends an unresolved burst at the aggregate time budget', async () => {
    jest.useFakeTimers();
    mockFetchContent.mockImplementation(() => new Promise(() => undefined));

    try {
      const resolution = resolveJourneyStepWeights(JOURNEY, [milestone('m1')]);
      await jest.advanceTimersByTimeAsync(3_000);
      await resolution;

      expect(getJourneyStepWeights(JOURNEY)).toBeNull();
      expect(mockFetchContent).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does nothing for an empty roster', async () => {
    await resolveJourneyStepWeights(JOURNEY, []);
    expect(mockFetchContent).not.toHaveBeenCalled();
    expect(getJourneyStepWeights(JOURNEY)).toBeNull();
  });
});
