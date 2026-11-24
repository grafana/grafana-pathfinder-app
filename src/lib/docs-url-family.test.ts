import {
  classifyDocsUrl,
  isJourneyContent,
  isLegacyJourneyFamily,
  type DocsUrlClassification,
  type DocsUrlFamily,
} from './docs-url-family';

const HUB = 'https://grafana.com/docs/learning-hub';

function familyOf(url: string): DocsUrlFamily {
  return classifyDocsUrl(url).family;
}

describe('classifyDocsUrl', () => {
  describe('existing families', () => {
    it.each<[string, string, DocsUrlFamily]>([
      ['a learning path', 'https://grafana.com/docs/learning-paths/linux-server-integration/', 'learning-path'],
      ['a learning path milestone', 'https://grafana.com/docs/learning-paths/intro/set-up/', 'learning-path'],
      [
        'a learning path without the docs prefix',
        'https://grafana.com/learning-paths/grafana-basics/',
        'learning-path',
      ],
      [
        'a legacy learning journey',
        'https://grafana.com/docs/learning-journeys/drilldown-logs/',
        'legacy-learning-journey',
      ],
      ['a root tutorial', 'https://grafana.com/tutorials/alerting-get-started/', 'tutorial'],
      ['a docs tutorial', 'https://grafana.com/docs/tutorials/alerting-get-started/', 'tutorial'],
      ['standard docs', 'https://grafana.com/docs/grafana/latest/panels/', 'docs'],
      ['standard docs on the docs host', 'https://docs.grafana.com/docs/grafana/latest/', 'docs'],
      [
        'an interactive-learning guide',
        'https://interactive-learning.grafana.net/guides/intro/content.json',
        'interactive-learning',
      ],
      [
        'a dev interactive-learning guide',
        'https://interactive-learning.grafana-dev.net/packages/x/content.json',
        'interactive-learning',
      ],
      ['the grafana.com home', 'https://grafana.com/', 'other'],
      ['a non-docs grafana.com page', 'https://grafana.com/blog/post/', 'other'],
      ['a foreign host', 'https://example.com/page/', 'other'],
    ])('classifies %s', (_label, url, expected) => {
      expect(familyOf(url)).toBe(expected);
    });

    it('does not widen the bare index without its trailing slash', () => {
      expect(familyOf('https://grafana.com/docs/learning-paths')).toBe('docs');
      expect(familyOf('https://grafana.com/docs/learning-paths/')).toBe('learning-path');
    });

    it('keeps a milestone page in its journey family', () => {
      expect(familyOf('https://grafana.com/docs/learning-journeys/foo/milestone-2/')).toBe('legacy-learning-journey');
      expect(familyOf('https://grafana.com/docs/learning-paths/foo/milestone-2/')).toBe('learning-path');
    });

    it('anchors a legacy family at the root of the path, with or without /docs', () => {
      expect(familyOf('https://grafana.com/docs/learning-paths/x/')).toBe('learning-path');
      expect(familyOf('https://grafana.com/learning-paths/x/')).toBe('learning-path');
      expect(familyOf('https://grafana.com/docs/learning-journeys/x/')).toBe('legacy-learning-journey');
      expect(familyOf('https://grafana.com/learning-journeys/x/')).toBe('legacy-learning-journey');
      expect(familyOf('https://grafana.com/tutorials/x/')).toBe('tutorial');
      expect(familyOf('https://grafana.com/docs/tutorials/x/')).toBe('tutorial');
    });

    it.each([
      'https://grafana.com/docs/alloy/latest/tutorials/send-logs-to-loki/',
      'https://grafana.com/docs/grafana-cloud/send-data/alloy/tutorials/',
      'https://grafana.com/docs/k6/latest/examples/tutorials/',
      'https://grafana.com/docs/grafana/latest/alerting/examples/tutorials/',
      'https://grafana.com/docs/agent/latest/flow/tutorials/flow-by-example/get-started/',
      'https://grafana.com/docs/grafana/latest/learning-paths/',
      'https://grafana.com/docs/foo/learning-journeys/x/',
      'https://grafana.com/docs/learning-paths-guide/x/',
      'https://grafana.com/docs/grafana/latest/milestone-3/',
    ])('treats a segment deeper in the path as an ordinary docs page: %s', (url) => {
      expect(familyOf(url)).toBe('docs');
    });
  });

  describe('Grafana Learn', () => {
    it.each<[string, string, string]>([
      ['the home', `${HUB}/`, 'home'],
      ['the home without a trailing slash', HUB, 'home'],
      ['a journey', `${HUB}/get-started-grafana-cloud/`, 'journey'],
      ['a section', `${HUB}/get-started-grafana-cloud/01-intro/`, 'section'],
      ['a module', `${HUB}/intro-to-grafana-assistant/01-modules/`, 'section'],
      ['a step', `${HUB}/get-started-grafana-cloud/01-intro/01-journey-overview/`, 'step'],
      ['a step without a trailing slash', `${HUB}/get-started-grafana-cloud/01-intro/01-journey-overview`, 'step'],
    ])('classifies %s as depth-based kind %s', (_label, url, kind) => {
      expect(classifyDocsUrl(url)).toMatchObject({ family: 'learn', learn: { kind } });
    });

    it('reports the journey and section URLs without a trailing slash', () => {
      expect(classifyDocsUrl(`${HUB}/j/s/step/`).learn).toEqual({
        kind: 'step',
        journeyBaseUrl: `${HUB}/j`,
        sectionUrl: `${HUB}/j/s`,
      });
      expect(classifyDocsUrl(`${HUB}/j/s/`).learn).toEqual({
        kind: 'section',
        journeyBaseUrl: `${HUB}/j`,
        sectionUrl: `${HUB}/j/s`,
      });
      expect(classifyDocsUrl(`${HUB}/j/`).learn).toEqual({ kind: 'journey', journeyBaseUrl: `${HUB}/j` });
      expect(classifyDocsUrl(`${HUB}/`).learn).toEqual({ kind: 'home' });
    });

    it.each([
      `${HUB}/j/s/step/unstyled.html`,
      `${HUB}/j/s/step/content.json`,
      `${HUB}/j/s/step/content.ja.json`,
      `${HUB}/j/s/step/?utm=1#top`,
    ])('normalizes the file suffix, query and fragment of %s', (url) => {
      expect(classifyDocsUrl(url).learn).toMatchObject({ kind: 'step' });
    });

    it('classifies the unstyled.html of every depth like the page it belongs to', () => {
      expect(classifyDocsUrl(`${HUB}/unstyled.html`).learn).toEqual({ kind: 'home' });
      expect(classifyDocsUrl(`${HUB}/j/unstyled.html`).learn).toMatchObject({ kind: 'journey' });
      expect(classifyDocsUrl(`${HUB}/j/s/unstyled.html`).learn).toMatchObject({ kind: 'section' });
    });

    it('rejects /search/ and everything below it', () => {
      expect(familyOf(`${HUB}/search/`)).toBe('other');
      expect(familyOf(`${HUB}/search`)).toBe('other');
      expect(familyOf(`${HUB}/search/unstyled.html`)).toBe('other');
      expect(familyOf(`${HUB}/search/anything/`)).toBe('other');
    });

    it('treats a path deeper than a step as standard docs', () => {
      expect(classifyDocsUrl(`${HUB}/j/s/step/extra/`)).toEqual({ family: 'docs' });
    });

    it('keeps Learn out of the legacy families, whatever its slugs say', () => {
      const result = classifyDocsUrl(`${HUB}/intro/tutorials/learning-paths/`);
      expect(result.family).toBe('learn');
      expect(isLegacyJourneyFamily(result)).toBe(false);
      expect(isJourneyContent(result)).toBe(false);
    });

    it('does not mistake a longer segment for the Learn root', () => {
      expect(familyOf('https://grafana.com/docs/learning-hubs/j/')).toBe('docs');
      expect(familyOf('https://grafana.com/docs/learning-hub-extra/j/')).toBe('docs');
    });
  });

  describe('query strings and fragments', () => {
    it.each([
      'https://grafana.com/docs/foo/?ref=/docs/learning-paths/x/',
      'https://grafana.com/docs/foo/?ref=/tutorials/x/',
      'https://grafana.com/docs/foo/?ref=/docs/learning-hub/j/',
      'https://grafana.com/docs/foo/#/learning-journeys/x/',
    ])('ignores a journey-looking path echoed in %s', (url) => {
      expect(classifyDocsUrl(url)).toEqual({ family: 'docs' });
    });
  });

  describe('hosts', () => {
    it.each([
      'https://grafana.com.evil.com/docs/learning-hub/j/s/step/',
      'https://a-grafana.com/docs/learning-hub/j/',
      'https://evil.com/docs/learning-hub/',
      'http://grafana.com/docs/learning-hub/j/',
      'https://interactive-learning.grafana.net.evil.com/docs/learning-hub/j/',
    ])('never classifies %s as Learn', (url) => {
      expect(familyOf(url)).toBe('other');
    });

    it('keeps matching the legacy families on the path alone, as the predicates it replaced did', () => {
      expect(familyOf('https://example.com/docs/learning-paths/x/')).toBe('learning-path');
      expect(familyOf('https://example.com/tutorials/x/')).toBe('tutorial');
    });

    it('requires an exact interactive-learning host over https', () => {
      expect(familyOf('https://interactive-learning.grafana.net.evil.com/guides/x/')).toBe('other');
      expect(familyOf('http://interactive-learning.grafana.net/guides/x/')).toBe('other');
    });

    it('does not call a non-https docs URL standard docs', () => {
      expect(familyOf('http://grafana.com/docs/grafana/latest/')).toBe('other');
    });
  });

  describe('unparseable input', () => {
    it.each(['', 'not a url', '/docs/learning-paths/x/', 'docs/learning-paths/x'])(
      'classifies %p as other',
      (input) => {
        expect(classifyDocsUrl(input)).toEqual({ family: 'other' });
      }
    );
  });

  describe('URL input', () => {
    it('accepts a parsed URL and classifies it like its string', () => {
      const href = 'https://grafana.com/docs/learning-paths/intro/set-up/';
      expect(classifyDocsUrl(new URL(href))).toEqual(classifyDocsUrl(href));
    });
  });

  describe('journeyBaseUrl', () => {
    it.each<[string, string | undefined]>([
      [
        'https://grafana.com/docs/learning-journeys/drilldown-logs/',
        'https://grafana.com/docs/learning-journeys/drilldown-logs',
      ],
      [
        'https://grafana.com/docs/learning-journeys/drilldown-logs/milestone-2/',
        'https://grafana.com/docs/learning-journeys/drilldown-logs',
      ],
      ['https://grafana.com/docs/learning-paths/intro/', 'https://grafana.com/docs/learning-paths/intro'],
      [
        'https://grafana.com/docs/learning-paths/intro/set-up/content.json',
        'https://grafana.com/docs/learning-paths/intro',
      ],
      [
        'https://grafana.com/docs/learning-paths/intro/set-up/unstyled.html',
        'https://grafana.com/docs/learning-paths/intro',
      ],
      ['https://grafana.com/tutorials/alerting-get-started/', 'https://grafana.com/tutorials/alerting-get-started'],
      ['https://grafana.com/docs/other/milestone-4/?x=1', undefined],
      ['https://grafana.com/docs/learning-paths/intro?utm=1', 'https://grafana.com/docs/learning-paths/intro'],
      ['https://grafana.com/docs/grafana/latest/', undefined],
      ['https://grafana.com/docs/learning-paths/', undefined],
      ['https://grafana.com/docs/learning-hub/j/s/', undefined],
      ['bundled:first-dashboard', undefined],
      ['ftp://grafana.com/docs/learning-paths/intro/', undefined],
    ])('derives the base of %s', (url, expected) => {
      expect(classifyDocsUrl(url).journeyBaseUrl).toBe(expected);
    });
  });
});

describe('family predicates', () => {
  const classify = (url: string): DocsUrlClassification => classifyDocsUrl(url);

  it.each<[string, boolean, boolean]>([
    ['https://grafana.com/docs/learning-paths/x/', true, true],
    ['https://grafana.com/docs/learning-journeys/x/', true, true],
    ['https://grafana.com/tutorials/x/', false, true],
    ['https://grafana.com/docs/foo/milestone-1/', false, false],
    ['https://grafana.com/docs/learning-journeys/foo/milestone-1/', true, true],
    ['https://grafana.com/docs/grafana/latest/', false, false],
    [`${HUB}/j/s/step/`, false, false],
    ['https://interactive-learning.grafana.net/guides/x/content.json', false, false],
    ['https://example.com/', false, false],
  ])('%s: legacy journey family %s, journey content %s', (url, legacy, content) => {
    expect(isLegacyJourneyFamily(classify(url))).toBe(legacy);
    expect(isJourneyContent(classify(url))).toBe(content);
  });
});
