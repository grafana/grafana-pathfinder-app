import { getInteractiveLearningUrlTitle } from './doc-page-title';

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
