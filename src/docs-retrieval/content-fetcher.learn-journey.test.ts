/**
 * Fetch-mocked integration: Grafana Learn URLs through `fetchContent`, with
 * `pathfinder.learn-journey-mode` on and off. Index fixtures are trimmed
 * copies of the website's own files (src/docs-retrieval/__fixtures__/learn).
 */
import { fetchContent } from './content-fetcher';
import { resetLearnJourneyCache } from './content-fetcher/learn-journey';
import { createLearnFetch } from '../test-utils/learn-index-fetch';
import { getFeatureFlagValue } from '../utils/openfeature';

jest.mock('../utils/openfeature', () => ({ getFeatureFlagValue: jest.fn() }));

const flag = getFeatureFlagValue as jest.MockedFunction<typeof getFeatureFlagValue>;

const JOURNEY = 'https://grafana.com/docs/learning-hub/intro-to-data-sources';
const TOUR = `${JOURNEY}/01-data-source-tour`;
const STEP = `${TOUR}/07-prometheus`;

const PAGE_TITLES: Record<string, string> = {
  [`${JOURNEY}/`]: 'Introduction to data sources | Grafana Labs\n',
  [`${TOUR}/06-data-source-tour/`]: 'Browse the data sources (page title) | Grafana Labs\n',
  [`${STEP}/`]: 'Prometheus (page title) | Grafana Labs\n',
};

function pageBody(url: string): string | undefined {
  const page = url.replace(/unstyled\.html$/, '');
  const title = PAGE_TITLES[page];
  return title === undefined
    ? undefined
    : `<!doctype html><head><title>${title}</title></head><article><h1>Heading</h1><p>Body of ${page}</p></article>`;
}

let fetchMock: jest.Mock;

function installFetch(options: Parameters<typeof createLearnFetch>[0] = {}) {
  fetchMock = createLearnFetch({ pages: pageBody, ...options });
  global.fetch = fetchMock as unknown as typeof fetch;
}

const requested = () => fetchMock.mock.calls.map(([url]) => String(url));
const indexRequests = () => requested().filter((url) => url.endsWith('/index.json'));

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  resetLearnJourneyCache();
  flag.mockReturnValue(true);
  installFetch();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('fetchContent with Learn journey mode on', () => {
  it('opens a journey URL at the cover with every step in the table of contents', async () => {
    const { content } = await fetchContent(`${JOURNEY}/`);

    expect(content?.type).toBe('learning-journey');
    expect(content?.metadata.title).toBe('Introduction to data sources');
    const journey = content?.metadata.learningJourney;
    expect(journey?.currentMilestone).toBe(0);
    expect(journey?.totalMilestones).toBe(10);
    expect(journey?.baseUrl).toBe(JOURNEY);
    expect(journey?.milestones[0]?.url).toBe(`${JOURNEY}/00-overview/01-course-overview/`);
    expect(journey?.hasUnavailableMilestones).toBeUndefined();
  });

  it('opens a step URL at its milestone, titled from the index rather than the slug or page suffix', async () => {
    const { content } = await fetchContent(`${STEP}/`);

    expect(content?.type).toBe('learning-journey');
    expect(content?.metadata.learningJourney?.currentMilestone).toBe(6);
    expect(content?.metadata.title).toBe('Prometheus');
  });

  it('opens a step URL typed without the trailing slash at the same milestone', async () => {
    const { content } = await fetchContent(STEP);

    expect(content?.metadata.learningJourney?.currentMilestone).toBe(6);
  });

  it('opens a section URL at its first step and fetches that step’s page', async () => {
    const { content } = await fetchContent(`${TOUR}/`);

    expect(content?.metadata.learningJourney?.currentMilestone).toBe(5);
    expect(content?.metadata.title).toBe('Browse the data sources');
    expect(content?.url).toContain(`${TOUR}/06-data-source-tour/`);
    expect(requested().some((url) => url.startsWith(`${TOUR}/07-prometheus`))).toBe(false);
  });

  it('never asks for content.json, which Learn does not publish', async () => {
    await fetchContent(`${STEP}/`);

    expect(requested().some((url) => url.endsWith('content.json'))).toBe(false);
  });

  it('shares the index requests between a cover and the steps opened after it', async () => {
    await fetchContent(`${JOURNEY}/`);
    const afterCover = indexRequests().length;
    await fetchContent(`${STEP}/`);

    expect(afterCover).toBe(4);
    expect(indexRequests()).toHaveLength(4);
  });

  it('falls back to a single document when the journey index fails', async () => {
    installFetch({ failing: [`${JOURNEY}/index.json`] });

    const { content } = await fetchContent(`${STEP}/`);

    expect(content?.type).toBe('single-doc');
    expect(content?.metadata.learningJourney).toBeUndefined();
    expect(content?.metadata.title).toBe('Prometheus (page title) | Grafana Labs');
  });

  it('requests a step missing from the tree as a plain page, with no toolbar', async () => {
    const { content } = await fetchContent(`${TOUR}/99-missing/`);

    expect(content).toBeNull();
    expect(requested()).toContain(`${TOUR}/99-missing/`);
  });

  it('flags a partial tree when a section index fails, so completion is never granted from it', async () => {
    installFetch({ failing: ['02-after-you-connect/index.json'] });

    const { content } = await fetchContent(`${JOURNEY}/`);

    expect(content?.metadata.learningJourney?.hasUnavailableMilestones).toBe(true);
    expect(content?.metadata.learningJourney?.totalMilestones).toBe(7);
  });

  it('leaves the Learn home and search page as single documents', async () => {
    for (const url of ['https://grafana.com/docs/learning-hub/', 'https://grafana.com/docs/learning-hub/search/']) {
      installFetch({ pages: () => '<html><head><title>Home</title></head><body>x</body></html>' });
      const { content } = await fetchContent(url);
      expect(content?.type).toBe('single-doc');
      expect(indexRequests()).toHaveLength(0);
    }
  });

  it('does not change what a legacy learning path does', async () => {
    installFetch({
      pages: (url) =>
        url.endsWith('content.json') ? 'null' : '<html><head><title>Legacy</title></head><body>x</body></html>',
    });

    const { content } = await fetchContent('https://grafana.com/docs/learning-paths/drilldown-logs/');

    expect(content?.type).toBe('learning-journey');
    expect(requested().some((url) => url.includes('/docs/learning-hub/'))).toBe(false);
  });
});

describe('fetchContent with Learn journey mode off', () => {
  beforeEach(() => {
    flag.mockReturnValue(false);
  });

  it.each([
    ['a journey', `${JOURNEY}/`],
    ['a section', `${TOUR}/`],
    ['a step', `${STEP}/`],
  ])('keeps %s a single document and fetches no index', async (_name, url) => {
    installFetch({ pages: () => '<html><head><title>Flat | Grafana Labs</title></head><body>x</body></html>' });

    const { content } = await fetchContent(url);

    expect(content?.type).toBe('single-doc');
    expect(content?.metadata.learningJourney).toBeUndefined();
    expect(content?.metadata.title).toBe('Flat | Grafana Labs');
    expect(indexRequests()).toHaveLength(0);
    expect(requested().some((requestedUrl) => requestedUrl.endsWith('content.json'))).toBe(false);
  });

  it('fetches the same pages in the same order as before the flag existed', async () => {
    installFetch({ pages: () => '<html><head><title>Flat</title></head><body>x</body></html>' });

    await fetchContent(`${STEP}/`);

    expect(requested()).toEqual([`${STEP}/`, `${STEP}/unstyled.html`]);
  });
});
