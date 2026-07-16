import {
  generateUrlId,
  isJsonContentUrl,
  generateInteractiveLearningVariations,
  getContentUrls,
  getLearningJourneyBaseUrl,
  isEndJourneyUrl,
  urlsMatch,
} from './url-utils';

// interactive-learning.grafana.net is an allowlisted interactive-learning host,
// so the real isInteractiveLearningUrl accepts it without dev mode or mocking.
const IL = 'https://interactive-learning.grafana.net/guide/intro';

describe('url-utils', () => {
  describe('isJsonContentUrl', () => {
    it('detects .json and /content.json paths', () => {
      expect(isJsonContentUrl('https://grafana.com/docs/x/content.json')).toBe(true);
      expect(isJsonContentUrl('https://grafana.com/docs/x/index.json')).toBe(true);
    });

    it('rejects non-json paths', () => {
      expect(isJsonContentUrl('https://grafana.com/docs/x/unstyled.html')).toBe(false);
      expect(isJsonContentUrl('https://grafana.com/docs/x/')).toBe(false);
    });

    it('ignores query params and fragments', () => {
      expect(isJsonContentUrl('https://grafana.com/x/content.json?v=2#top')).toBe(true);
      expect(isJsonContentUrl('https://grafana.com/x/page?file=content.json')).toBe(false);
    });
  });

  describe('generateInteractiveLearningVariations (fallback-order contract)', () => {
    it('returns content.json BEFORE unstyled.html for interactive URLs', () => {
      expect(generateInteractiveLearningVariations(IL)).toEqual([
        'https://interactive-learning.grafana.net/guide/intro/content.json',
        'https://interactive-learning.grafana.net/guide/intro/unstyled.html',
      ]);
    });

    it('strips a trailing slash before appending variations', () => {
      expect(generateInteractiveLearningVariations(`${IL}/`)).toEqual([
        'https://interactive-learning.grafana.net/guide/intro/content.json',
        'https://interactive-learning.grafana.net/guide/intro/unstyled.html',
      ]);
    });

    it('returns the URL as-is when it already points at content.json or unstyled.html', () => {
      expect(generateInteractiveLearningVariations(`${IL}/content.json`)).toEqual([`${IL}/content.json`]);
      expect(generateInteractiveLearningVariations(`${IL}/unstyled.html`)).toEqual([`${IL}/unstyled.html`]);
    });

    it('returns no variations for non-interactive URLs', () => {
      expect(generateInteractiveLearningVariations('https://grafana.com/docs/grafana/latest/')).toEqual([]);
    });
  });

  describe('getContentUrls (fallback-order contract)', () => {
    it('derives content.json as jsonUrl and unstyled.html as htmlUrl', () => {
      expect(getContentUrls('https://grafana.com/docs/x/')).toEqual({
        jsonUrl: 'https://grafana.com/docs/x/content.json',
        htmlUrl: 'https://grafana.com/docs/x/unstyled.html',
      });
    });

    it('preserves an explicit content.json URL and derives its html sibling', () => {
      expect(getContentUrls('https://grafana.com/docs/x/content.json')).toEqual({
        jsonUrl: 'https://grafana.com/docs/x/content.json',
        htmlUrl: 'https://grafana.com/docs/x/unstyled.html',
      });
    });

    it('preserves an explicit unstyled.html URL and derives its json sibling', () => {
      expect(getContentUrls('https://grafana.com/docs/x/unstyled.html')).toEqual({
        jsonUrl: 'https://grafana.com/docs/x/content.json',
        htmlUrl: 'https://grafana.com/docs/x/unstyled.html',
      });
    });
  });

  describe('getLearningJourneyBaseUrl', () => {
    it('extracts the base for learning-journeys and strips milestones', () => {
      expect(getLearningJourneyBaseUrl('https://grafana.com/docs/learning-journeys/drilldown-logs/')).toBe(
        'https://grafana.com/docs/learning-journeys/drilldown-logs'
      );
      expect(getLearningJourneyBaseUrl('https://grafana.com/docs/learning-journeys/drilldown-logs/milestone-2/')).toBe(
        'https://grafana.com/docs/learning-journeys/drilldown-logs'
      );
    });

    it('handles learning-paths and tutorials', () => {
      expect(getLearningJourneyBaseUrl('https://grafana.com/docs/learning-paths/intro/')).toBe(
        'https://grafana.com/docs/learning-paths/intro'
      );
      expect(getLearningJourneyBaseUrl('https://grafana.com/tutorials/alerting-get-started/')).toBe(
        'https://grafana.com/tutorials/alerting-get-started'
      );
    });
  });

  describe('urlsMatch', () => {
    it('ignores trailing slashes and case', () => {
      expect(urlsMatch('https://grafana.com/docs/X/', 'https://grafana.com/docs/x')).toBe(true);
      expect(urlsMatch('https://grafana.com/a', 'https://grafana.com/b')).toBe(false);
    });
  });

  describe('isEndJourneyUrl', () => {
    it('matches end-journey pages regardless of content suffix', () => {
      expect(isEndJourneyUrl('https://cdn.example.com/packages/x-lj/end-journey/content.json')).toBe(true);
      expect(isEndJourneyUrl('https://cdn.example.com/packages/x-lj/end-journey/')).toBe(true);
      expect(isEndJourneyUrl('https://cdn.example.com/packages/x-lj/end-journey')).toBe(true);
    });

    it('requires a path-segment boundary — package ids merely ending in end-journey do not match', () => {
      expect(isEndJourneyUrl('https://cdn.example.com/packages/adaptive-logs-end-journey/content.json')).toBe(false);
      expect(isEndJourneyUrl('https://cdn.example.com/packages/x-lj/content.json')).toBe(false);
    });
  });

  describe('generateUrlId', () => {
    it('strips the protocol, replaces non-alphanumerics, and caps length at 50', () => {
      expect(generateUrlId('https://grafana.com/docs/x')).toBe('grafana-com-docs-x');
      expect(generateUrlId(`https://grafana.com/${'a'.repeat(100)}`).length).toBe(50);
    });
  });
});
