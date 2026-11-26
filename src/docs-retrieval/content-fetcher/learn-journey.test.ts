import { classifyDocsUrl } from '../../lib/docs-url-family';
import { createLearnFetch } from '../../test-utils/learn-index-fetch';
import { learnMilestoneUrl } from '../../utils/learn-journey-mode';
import { getFeatureFlagValue } from '../../utils/openfeature';
import {
  LEARN_FAILURE_TTL_MS,
  LEARN_JOURNEY_TTL_MS,
  cleanLearnDocumentTitle,
  learnJourneyMetadata,
  planLearnJourney,
  resetLearnJourneyCache,
  resolveLearnJourney,
} from './learn-journey';

jest.mock('../../utils/openfeature', () => ({ getFeatureFlagValue: jest.fn() }));

const flag = getFeatureFlagValue as jest.MockedFunction<typeof getFeatureFlagValue>;

const ROOT = 'https://grafana.com/docs/learning-hub';
const DATA_SOURCES = `${ROOT}/intro-to-data-sources`;
const ASSISTANT = `${ROOT}/intro-to-grafana-assistant`;
const SYNTHETIC = `${ROOT}/synthetic-journey`;

let fetchMock: jest.Mock;

function installFetch(options?: Parameters<typeof createLearnFetch>[0]) {
  fetchMock = createLearnFetch(options);
  global.fetch = fetchMock as unknown as typeof fetch;
}

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.useRealTimers();
  resetLearnJourneyCache();
  flag.mockReturnValue(true);
  installFetch();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('resolveLearnJourney ordering', () => {
  it('sorts both levels by weight, so a weight-0 introduction listed last comes first', async () => {
    const journey = await resolveLearnJourney(DATA_SOURCES);

    expect(journey?.milestones.map((milestone) => milestone.title)).toEqual([
      'Connect Grafana to your data',
      'Prerequisites',
      'What are data sources?',
      'Data sources compared to integrations',
      'Browse the data sources',
      'Prometheus',
      'Troubleshoot a failed connection',
      'After you connect',
      'Build a dashboard',
      'Resources and next steps',
    ]);
    expect(journey?.milestones.map((milestone) => milestone.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(journey?.hasUnavailableMilestones).toBe(false);
    expect(journey?.baseUrl).toBe(DATA_SOURCES);
  });

  it('carries each step’s section as the display group, in website order', async () => {
    const journey = await resolveLearnJourney(DATA_SOURCES);

    const groups = journey!.milestones.reduce<string[]>((titles, milestone) => {
      const title = milestone.section!.title;
      return titles[titles.length - 1] === title ? titles : [...titles, title];
    }, []);
    expect(groups).toEqual(['Data source fundamentals', 'Common data sources', 'Put your data to work']);
    expect(journey!.milestones[0]!.section).toEqual({
      url: `${DATA_SOURCES}/00-overview`,
      title: 'Data source fundamentals',
    });
  });

  it('orders a journey that uses modules the same way', async () => {
    const journey = await resolveLearnJourney(ASSISTANT);

    expect(journey?.milestones.map((milestone) => [milestone.section!.title, milestone.title])).toEqual([
      ['Grafana Assistant fundamentals', 'Grafana Assistant journey outcomes'],
      ['Grafana Assistant fundamentals', 'What is Grafana Assistant?'],
      ['Grafana Assistant fundamentals', 'Privacy and security'],
      ['Get started with Grafana Assistant', 'Set up Grafana Assistant in Grafana Cloud'],
      ['Get started with Grafana Assistant', 'Use Learn mode'],
      ['Use Grafana Assistant', 'Navigate Grafana resources'],
      ['Use Grafana Assistant', 'Query your data'],
    ]);
  });

  it('keeps array order for equal weights and puts a missing weight last', async () => {
    const journey = await resolveLearnJourney(SYNTHETIC);

    expect(journey?.milestones.map((milestone) => [milestone.section!.title, milestone.title])).toEqual([
      ['Tied weight, listed second', 'Only step'],
      ['Tied weight, listed first', 'First step'],
      ['Tied weight, listed first', 'Second step'],
      ['No weight', 'Menu title only'],
      ['No weight', 'Step 5'],
    ]);
  });

  it('titles a step from its title, then its menu title, then a numbered label, never its slug', async () => {
    const journey = await resolveLearnJourney(SYNTHETIC);
    const titles = journey!.milestones.map((milestone) => milestone.title);

    expect(titles.slice(3)).toEqual(['Menu title only', 'Step 5']);
    expect(titles.join(' ')).not.toMatch(/untitled/);
  });
});

describe('resolveLearnJourney trust and shape', () => {
  it('drops a permalink on a foreign host, outside Learn, in another journey, or in another section', async () => {
    const journey = await resolveLearnJourney(SYNTHETIC);
    const urls = journey!.milestones.map((milestone) => milestone.url);

    expect(urls.every((url) => url.startsWith(`${SYNTHETIC}/`))).toBe(true);
    expect(urls.some((url) => url.includes('evil'))).toBe(false);
    expect(urls.some((url) => url.includes('wrong-section'))).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('evil'))).toBe(false);
  });

  it('skips entries flagged grafana.skip, entries without a permalink, and duplicates', async () => {
    const journey = await resolveLearnJourney(SYNTHETIC);
    const urls = journey!.milestones.map((milestone) => milestone.url);

    expect(journey!.milestones.some((milestone) => milestone.section!.title === 'Skipped section')).toBe(false);
    expect(journey!.milestones.some((milestone) => milestone.title === 'Skipped step')).toBe(false);
    expect(journey!.milestones.some((milestone) => milestone.section!.title.startsWith('Duplicate'))).toBe(false);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('builds every step URL so the classifier reads it as a step of the same journey and section', async () => {
    const journey = await resolveLearnJourney(DATA_SOURCES);

    for (const milestone of journey!.milestones) {
      const { family, learn } = classifyDocsUrl(milestone.url);
      expect(family).toBe('learn');
      expect(learn).toEqual({
        kind: 'step',
        journeyBaseUrl: DATA_SOURCES,
        sectionUrl: milestone.section!.url,
        journeySlug: 'intro-to-data-sources',
        relativePath: milestone.url.slice(ROOT.length + 1).replace(/\/$/, ''),
      });
    }
  });

  it('requests each index through the guide fetch with the index role and a timeout', async () => {
    await resolveLearnJourney(DATA_SOURCES);

    const urls = fetchMock.mock.calls.map(([url]) => url);
    expect(urls).toEqual(
      expect.arrayContaining([
        `${DATA_SOURCES}/index.json`,
        `${DATA_SOURCES}/00-overview/index.json`,
        `${DATA_SOURCES}/01-data-source-tour/index.json`,
        `${DATA_SOURCES}/02-after-you-connect/index.json`,
      ])
    );
    expect(urls).toHaveLength(4);
    expect(fetchMock.mock.calls[0]![1]).toEqual(expect.objectContaining({ signal: expect.anything() }));
  });

  it('refuses a journey whose index redirects off the trusted hosts', async () => {
    fetchMock = jest.fn(async (url: string) => ({
      ok: true,
      status: 200,
      url: 'https://evil.example.com/index.json',
      json: async () => [],
      text: async () => '[]',
      headers: new Headers(),
      statusText: 'OK',
      requestedUrl: url,
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(resolveLearnJourney(DATA_SOURCES)).resolves.toBeNull();
  });
});

describe('resolveLearnJourney partial failure', () => {
  it('marks a failed section as unavailable and keeps the rest', async () => {
    const journey = await resolveLearnJourney(SYNTHETIC);

    expect(journey?.hasUnavailableMilestones).toBe(true);
    expect(journey!.milestones.length).toBeGreaterThan(0);
  });

  it('marks the tree partial when one section of a healthy journey fails', async () => {
    installFetch({ failing: ['01-data-source-tour'] });

    const journey = await resolveLearnJourney(DATA_SOURCES);

    expect(journey?.hasUnavailableMilestones).toBe(true);
    expect(journey?.milestones.some((milestone) => milestone.title === 'Prometheus')).toBe(false);
    expect(journey?.milestones.map((milestone) => milestone.number)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(learnJourneyMetadata({ journey: journey!, currentMilestone: 0, fetchUrl: DATA_SOURCES }, '')).toEqual(
      expect.objectContaining({ hasUnavailableMilestones: true, totalMilestones: 7 })
    );
  });

  it('omits the partial-tree signal from a complete journey', async () => {
    const journey = await resolveLearnJourney(DATA_SOURCES);

    expect(
      learnJourneyMetadata({ journey: journey!, currentMilestone: 0, fetchUrl: DATA_SOURCES }, 'x')
    ).not.toHaveProperty('hasUnavailableMilestones');
  });

  it('resolves to null when the journey index fails', async () => {
    installFetch({ failing: [`${DATA_SOURCES}/index.json`] });

    await expect(resolveLearnJourney(DATA_SOURCES)).resolves.toBeNull();
  });

  it('resolves to null for a journey the website does not publish', async () => {
    await expect(resolveLearnJourney(`${ROOT}/no-such-journey`)).resolves.toBeNull();
  });
});

describe('resolveLearnJourney cache', () => {
  it('shares one in-flight load between concurrent callers', async () => {
    const [first, second] = await Promise.all([resolveLearnJourney(DATA_SOURCES), resolveLearnJourney(DATA_SOURCES)]);

    expect(first).toBe(second);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('serves a settled journey from memory until the ten-minute lifetime ends', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-24T10:00:00Z'), doNotFake: ['nextTick', 'setImmediate'] });
    await resolveLearnJourney(DATA_SOURCES);
    fetchMock.mockClear();

    jest.setSystemTime(Date.now() + LEARN_JOURNEY_TTL_MS - 1);
    await resolveLearnJourney(DATA_SOURCES);
    expect(fetchMock).not.toHaveBeenCalled();

    jest.setSystemTime(Date.now() + 2);
    await resolveLearnJourney(DATA_SOURCES);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('keeps a failure for thirty seconds only, then retries', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-24T10:00:00Z'), doNotFake: ['nextTick', 'setImmediate'] });
    installFetch({ failing: [`${DATA_SOURCES}/index.json`] });
    await expect(resolveLearnJourney(DATA_SOURCES)).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    jest.setSystemTime(Date.now() + LEARN_FAILURE_TTL_MS - 1);
    await resolveLearnJourney(DATA_SOURCES);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    installFetch();
    jest.setSystemTime(Date.now() + 2);
    const recovered = await resolveLearnJourney(DATA_SOURCES);
    expect(recovered?.milestones).toHaveLength(10);
  });

  it('keeps a partial tree for the short lifetime too, so a recovered section is picked up', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-24T10:00:00Z'), doNotFake: ['nextTick', 'setImmediate'] });
    installFetch({ failing: ['01-data-source-tour'] });
    expect((await resolveLearnJourney(DATA_SOURCES))?.hasUnavailableMilestones).toBe(true);

    installFetch();
    jest.setSystemTime(Date.now() + LEARN_FAILURE_TTL_MS + 1);
    expect((await resolveLearnJourney(DATA_SOURCES))?.hasUnavailableMilestones).toBe(false);
  });

  it('does not persist anything', async () => {
    const setItem = jest.spyOn(Storage.prototype, 'setItem');
    await resolveLearnJourney(DATA_SOURCES);

    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });
});

describe('planLearnJourney', () => {
  it('opens a journey URL at the cover', async () => {
    const plan = await planLearnJourney(`${DATA_SOURCES}/`);

    expect(plan).toEqual(expect.objectContaining({ currentMilestone: 0, fetchUrl: `${DATA_SOURCES}/` }));
  });

  it('opens a step URL at its milestone, with or without the trailing slash and with a content file', async () => {
    const step = `${DATA_SOURCES}/01-data-source-tour/07-prometheus`;

    for (const url of [step, `${step}/`, `${step}/unstyled.html`]) {
      const plan = await planLearnJourney(url);
      expect(plan?.currentMilestone).toBe(6);
      expect(plan?.fetchUrl).toBe(`${step}/`);
    }
  });

  it('opens a section or module URL at its first step', async () => {
    const section = await planLearnJourney(`${DATA_SOURCES}/01-data-source-tour/`);
    expect(section?.currentMilestone).toBe(5);
    expect(section?.fetchUrl).toBe(`${DATA_SOURCES}/01-data-source-tour/06-data-source-tour/`);

    const module = await planLearnJourney(`${ASSISTANT}/03-use-assistant`);
    expect(module?.currentMilestone).toBe(6);
  });

  it('opens an introduction listed last in the index at milestone 1', async () => {
    const plan = await planLearnJourney(`${DATA_SOURCES}/00-overview/`);

    expect(plan?.currentMilestone).toBe(1);
  });

  it('gives no plan for a URL missing from the tree, so it opens as a single document', async () => {
    await expect(planLearnJourney(`${DATA_SOURCES}/01-data-source-tour/99-missing/`)).resolves.toBeUndefined();
    await expect(planLearnJourney(`${DATA_SOURCES}/99-missing/`)).resolves.toBeUndefined();
  });

  it('gives no plan when the journey index fails', async () => {
    installFetch({ failing: [`${DATA_SOURCES}/index.json`] });

    await expect(planLearnJourney(`${DATA_SOURCES}/01-data-source-tour/07-prometheus/`)).resolves.toBeUndefined();
  });

  it('gives no plan, and makes no request, while the flag is off', async () => {
    flag.mockReturnValue(false);

    await expect(planLearnJourney(`${DATA_SOURCES}/`)).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['the Learn home', `${ROOT}/`],
    ['the Learn search page', `${ROOT}/search/`],
    ['a step page deeper than the tree', `${DATA_SOURCES}/00-overview/01-course-overview/extra/`],
    ['ordinary docs', 'https://grafana.com/docs/grafana/latest/'],
    ['a legacy learning path', 'https://grafana.com/docs/learning-paths/drilldown-logs/'],
    ['a look-alike host', 'https://grafana.com.evil.example/docs/learning-hub/intro-to-data-sources/'],
  ])('gives no plan for %s', async (_name, url) => {
    await expect(planLearnJourney(url)).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('learnMilestoneUrl', () => {
  it('names the milestone a section URL loaded, and nothing for a cover or a legacy journey', async () => {
    const section = await planLearnJourney(`${DATA_SOURCES}/01-data-source-tour/`);
    const metadata = learnJourneyMetadata(section!, '');
    expect(learnMilestoneUrl(metadata)).toBe(`${DATA_SOURCES}/01-data-source-tour/06-data-source-tour/`);

    const cover = await planLearnJourney(`${DATA_SOURCES}/`);
    expect(learnMilestoneUrl(learnJourneyMetadata(cover!, ''))).toBeUndefined();
    expect(learnMilestoneUrl(undefined)).toBeUndefined();
    expect(
      learnMilestoneUrl({
        currentMilestone: 1,
        totalMilestones: 1,
        baseUrl: 'https://grafana.com/docs/learning-paths/x',
        milestones: [
          { number: 1, title: 'One', url: 'https://grafana.com/docs/learning-paths/x/milestone-1/', isActive: false },
        ],
      })
    ).toBeUndefined();
  });
});

describe('cleanLearnDocumentTitle', () => {
  it('drops the site suffix and the whitespace the website leaves in the title', () => {
    expect(cleanLearnDocumentTitle('Connect Grafana to your data | Grafana Labs\n')).toBe(
      'Connect Grafana to your data'
    );
    expect(cleanLearnDocumentTitle('Plain title')).toBe('Plain title');
    expect(cleanLearnDocumentTitle('| Grafana Labs')).toBe('| Grafana Labs');
  });
});
