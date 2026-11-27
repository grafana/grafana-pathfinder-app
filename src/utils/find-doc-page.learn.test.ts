import { findDocPage } from './find-doc-page';
import { getFeatureFlagValue } from './openfeature';

jest.mock('./openfeature', () => ({ getFeatureFlagValue: jest.fn(() => false) }));

const STEP = 'https://grafana.com/docs/learning-hub/intro-to-data-sources/01-data-source-tour/07-prometheus/';

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.mocked(getFeatureFlagValue).mockReturnValue(false);
  jest.restoreAllMocks();
});

describe('findDocPage for Grafana Learn', () => {
  describe('with Learn journey mode on', () => {
    beforeEach(() => {
      jest.mocked(getFeatureFlagValue).mockReturnValue(true);
    });

    it.each([
      ['a journey', 'https://grafana.com/docs/learning-hub/intro-to-data-sources/', 'Intro To Data Sources'],
      [
        'a section',
        'https://grafana.com/docs/learning-hub/intro-to-data-sources/01-data-source-tour/',
        '01 Data Source Tour',
      ],
      ['a step', STEP, '07 Prometheus'],
    ])('types %s as a learning journey with a placeholder title', (_name, url, title) => {
      expect(findDocPage(url)).toEqual({ type: 'learning-journey', url, title });
    });

    it('resolves a relative path the same way', () => {
      expect(findDocPage('/docs/learning-hub/intro-to-data-sources/')).toEqual({
        type: 'learning-journey',
        url: 'https://grafana.com/docs/learning-hub/intro-to-data-sources/',
        title: 'Intro To Data Sources',
      });
    });

    it('leaves the Learn home a docs page', () => {
      expect(findDocPage('https://grafana.com/docs/learning-hub/')).toEqual(
        expect.objectContaining({ type: 'docs-page' })
      );
    });

    it('rejects a look-alike host', () => {
      expect(findDocPage('https://grafana.com.evil.example/docs/learning-hub/intro-to-data-sources/')).toBeNull();
    });
  });

  it('keeps a Learn step a docs page with the slug-based title while the flag is off', () => {
    expect(findDocPage(STEP)).toEqual({
      type: 'docs-page',
      url: STEP,
      title: '07 Prometheus - Learning Hub Docs',
    });
  });

  it.each([
    ['/docs/learning-journeys/drilldown/', 'https://grafana.com/docs/learning-journeys/drilldown/'],
    ['/docs/learning-paths/drilldown/', 'https://grafana.com/docs/learning-paths/drilldown/'],
    ['/tutorials/first-dashboard/', 'https://grafana.com/tutorials/first-dashboard/'],
    ['/docs/grafana/latest/', 'https://grafana.com/docs/grafana/latest/'],
  ])('still resolves the relative path %s to a docs page', (param, url) => {
    expect(findDocPage(param)).toEqual(expect.objectContaining({ type: 'docs-page', url }));
  });

  it.each(['/tutorials', '/about/tutorials/x/', '/blog/'])('still rejects the relative path %s', (param) => {
    expect(findDocPage(param)).toBeNull();
  });
});
