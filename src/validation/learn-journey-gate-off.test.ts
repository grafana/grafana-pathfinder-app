/**
 * Issue #2512: with `pathfinder.learn-journey-mode` at its default (off), every
 * Learn journey, section and step URL keeps today's flat-document behavior.
 * OpenFeature runs unmocked with no provider, so every reader sees the
 * registered default. Expected values are the literal results from before the
 * flag existed.
 */
import { fireEvent, renderHook } from '@testing-library/react';

import { useLinkClickHandler } from '../components/docs-panel/link-handler.hook';
import { isLearningJourneyUrl } from '../components/docs-panel/utils/url-validation';
import { fetchContent } from '../docs-retrieval/content-fetcher';
import { resetLearnJourneyCache } from '../docs-retrieval/content-fetcher/learn-journey';
import { createLearnFetch } from '../test-utils/learn-index-fetch';
import { getLearnUrlPlaceholderTitle } from '../utils/doc-page-title';
import { findDocPage } from '../utils/find-doc-page';

jest.mock('../lib/analytics', () => ({
  ...jest.requireActual('../lib/analytics'),
  reportAppInteraction: jest.fn(),
}));

const JOURNEY = 'https://grafana.com/docs/learning-hub/intro-to-data-sources/';
const SECTION = `${JOURNEY}01-data-source-tour/`;
const STEP = `${SECTION}07-prometheus/`;

const LEARN_URLS = [
  { name: 'journey', url: JOURNEY, docsTitle: 'Intro To Data Sources - Learning Hub Docs' },
  { name: 'section', url: SECTION, docsTitle: '01 Data Source Tour - Learning Hub Docs' },
  { name: 'step', url: STEP, docsTitle: '07 Prometheus - Learning Hub Docs' },
];

let fetchMock: jest.Mock;

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  resetLearnJourneyCache();
  fetchMock = createLearnFetch({
    pages: () => '<html><head><title>Flat | Grafana Labs</title></head><body><p>x</p></body></html>',
  });
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(LEARN_URLS)('a Learn $name URL with the flag at its default', ({ url, docsTitle }) => {
  it('does not route as a learning journey', () => {
    expect(isLearningJourneyUrl(url)).toBe(false);
  });

  it('has no Learn placeholder title', () => {
    expect(getLearnUrlPlaceholderTitle(url)).toBeUndefined();
  });

  it('deep-links as a docs page with the slug-based title', () => {
    expect(findDocPage(url)).toEqual({ type: 'docs-page', url, title: docsTitle });
  });

  it('opens from a content link through openDocsPage', () => {
    const model = {
      loadTab: jest.fn(),
      openLearningJourney: jest.fn(),
      openDocsPage: jest.fn(),
      getActiveTab: jest.fn(),
      navigateToNextMilestone: jest.fn(),
      navigateToPreviousMilestone: jest.fn(),
      canNavigateNext: jest.fn(() => true),
      canNavigatePrevious: jest.fn(() => true),
    };
    const contentDiv = document.createElement('div');
    renderHook(() =>
      useLinkClickHandler({
        contentRef: { current: contentDiv },
        activeTab: null,
        theme: { colors: { background: { primary: '#000000' } } } as any,
        model,
      })
    );
    const link = document.createElement('a');
    link.href = url;
    link.textContent = 'Learn link';
    contentDiv.appendChild(link);

    fireEvent.click(link);

    expect(model.openDocsPage).toHaveBeenCalledWith(url, 'Learn link', { source: 'content_link' });
    expect(model.openLearningJourney).not.toHaveBeenCalled();
  });

  it('fetches a single document without any index', async () => {
    const { content } = await fetchContent(url);

    expect(content?.type).toBe('single-doc');
    expect(content?.metadata.learningJourney).toBeUndefined();
    expect(fetchMock.mock.calls.map(([requested]) => String(requested))).toEqual([url, `${url}unstyled.html`]);
  });
});
