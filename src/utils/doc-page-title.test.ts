import { getInteractiveLearningUrlTitle, getLearnUrlPlaceholderTitle } from './doc-page-title';
import { getFeatureFlagValue } from './openfeature';

jest.mock('./openfeature', () => ({ getFeatureFlagValue: jest.fn(() => false) }));

describe('getInteractiveLearningUrlTitle', () => {
  it.each(['content.json', 'unstyled.html', '', 'content.json?source=website#start'])(
    'derives a placeholder from the package slug (%s)',
    (suffix) => {
      expect(
        getInteractiveLearningUrlTitle(`https://interactive-learning.grafana.net/packages/alerting-intro-lj/${suffix}`)
      ).toBe('Alerting Intro Lj');
    }
  );

  it.each([
    'not a URL',
    'bundled:alerting-intro-lj',
    'https://example.com/packages/alerting-intro-lj/content.json',
    'https://interactive-learning.grafana.net.example.com/packages/alerting-intro-lj/content.json',
    'javascript:alert(1)',
  ])('does not derive a placeholder for an untrusted URL (%s)', (url) => {
    expect(getInteractiveLearningUrlTitle(url)).toBeUndefined();
  });
});

it('derives the same placeholder from a localized content file', () => {
  expect(
    getInteractiveLearningUrlTitle(
      'https://interactive-learning.grafana.net/packages/alerting-intro-lj/content.ja.json'
    )
  ).toBe('Alerting Intro Lj');
});

describe('getLearnUrlPlaceholderTitle', () => {
  const step = 'https://grafana.com/docs/learning-hub/intro-to-data-sources/01-data-source-tour/07-prometheus/';

  afterEach(() => {
    jest.mocked(getFeatureFlagValue).mockReturnValue(false);
  });

  it.each([
    ['https://grafana.com/docs/learning-hub/intro-to-data-sources/', 'Intro To Data Sources'],
    ['https://grafana.com/docs/learning-hub/intro-to-data-sources/01-data-source-tour', '01 Data Source Tour'],
    [step, '07 Prometheus'],
    [`${step}unstyled.html`, '07 Prometheus'],
  ])('derives a placeholder from the last segment of %s while the flag is on', (url, title) => {
    jest.mocked(getFeatureFlagValue).mockReturnValue(true);

    expect(getLearnUrlPlaceholderTitle(url)).toBe(title);
  });

  it('derives nothing while the flag is off', () => {
    expect(getLearnUrlPlaceholderTitle(step)).toBeUndefined();
  });

  it.each([
    'https://grafana.com/docs/learning-hub/',
    'https://grafana.com/docs/grafana/latest/',
    'https://grafana.com/docs/learning-paths/drilldown-logs/',
    'not a URL',
  ])('derives nothing for %s', (url) => {
    jest.mocked(getFeatureFlagValue).mockReturnValue(true);

    expect(getLearnUrlPlaceholderTitle(url)).toBeUndefined();
  });
});
