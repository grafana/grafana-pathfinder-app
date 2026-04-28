/**
 * Pre-extraction contract tests for metadata-extractor extraction (Phase 2).
 *
 * Disposable safety net per .cursor/skills/refactor/SKILL.md and the High-Risk
 * Refactor Guidelines wiki ("tests are safety rails, not refactoring targets").
 * These assertions pin the current behavior in `content-fetcher.ts` so that the
 * extraction to `./metadata-extractor` cannot silently change:
 *   - title regex precedence (<title> → <h1> → og:title → 'Documentation')
 *   - urlsMatch normalization (trailing-slash + lowercase) — asymmetric vs.
 *     Phase 5's strict `m.url === contentUrl` match
 *   - findCurrentMilestoneFromUrl /unstyled.html and /content.json suffix strip
 *   - getLearningJourneyBaseUrl regex precedence
 *     (learning-journeys → learning-paths → tutorials → strip-milestone)
 *   - fetchLearningJourneyMetadataFromJson grafana.skip filter + sequential
 *     index+1 renumbering
 *   - extractJourneySummary / extractDocSummary boundary semantics
 *   - INVESTIGATION §6 invariant 1: index.json fetch over http:// succeeds
 *     (no enforceHttps gate added during extraction)
 *
 * Lifecycle: this file becomes `metadata-extractor.test.ts` (permanent) at the
 * post-test commit; imports flip from `./content-fetcher` to
 * `./metadata-extractor`.
 */
import {
  extractDocSummary,
  extractJourneySummary,
  extractTitleFromHtml,
  fetchLearningJourneyMetadataFromJson,
  findCurrentMilestoneFromUrl,
  getLearningJourneyBaseUrl,
  urlsMatch,
} from './content-fetcher';
import type { Milestone } from '../types/content.types';

describe('metadata-extractor (pre-extraction contract)', () => {
  describe('extractTitleFromHtml — regex precedence', () => {
    it('prefers <title> over <h1>', () => {
      expect(extractTitleFromHtml('<title>From title</title><h1>From h1</h1>')).toBe('From title');
    });

    it('falls back to <h1> when <title> is missing', () => {
      expect(extractTitleFromHtml('<body><h1>From h1</h1></body>')).toBe('From h1');
    });

    it('falls back to og:title when both <title> and <h1> are missing', () => {
      expect(extractTitleFromHtml('<head><meta property="og:title" content="From og:title"></head>')).toBe(
        'From og:title'
      );
    });

    it('returns "Documentation" when no source matches', () => {
      expect(extractTitleFromHtml('<body><p>no title at all</p></body>')).toBe('Documentation');
    });

    it('trims surrounding whitespace from the matched title', () => {
      expect(extractTitleFromHtml('<title>   Padded   </title>')).toBe('Padded');
    });
  });

  describe('urlsMatch — normalization (trailing slash + lowercase)', () => {
    type Case = { name: string; a: string; b: string; expected: boolean };
    const cases: Case[] = [
      {
        name: 'trailing slash on a but not b → match',
        a: 'https://grafana.com/docs/foo/',
        b: 'https://grafana.com/docs/foo',
        expected: true,
      },
      {
        name: 'trailing slash on b but not a → match',
        a: 'https://grafana.com/docs/foo',
        b: 'https://grafana.com/docs/foo/',
        expected: true,
      },
      {
        name: 'case difference on host → match (lowercase normalization)',
        a: 'https://Grafana.COM/docs/foo',
        b: 'https://grafana.com/docs/foo',
        expected: true,
      },
      {
        name: 'case difference on path → match (lowercase normalization)',
        a: 'https://grafana.com/docs/Foo',
        b: 'https://grafana.com/docs/foo',
        expected: true,
      },
      {
        name: 'query string difference → does NOT match (no query normalization)',
        a: 'https://grafana.com/docs/foo?x=1',
        b: 'https://grafana.com/docs/foo',
        expected: false,
      },
    ];

    it.each(cases)('$name', ({ a, b, expected }) => {
      expect(urlsMatch(a, b)).toBe(expected);
    });
  });

  describe('findCurrentMilestoneFromUrl — suffix strip', () => {
    const milestones: Milestone[] = [
      {
        number: 1,
        title: 'M1',
        duration: '5-10 min',
        url: 'https://grafana.com/docs/learning-paths/foo/milestone-1',
        isActive: false,
      },
      {
        number: 2,
        title: 'M2',
        duration: '5-10 min',
        url: 'https://grafana.com/docs/learning-paths/foo/milestone-2',
        isActive: false,
      },
    ];

    it('strips /unstyled.html and matches the milestone exactly', () => {
      const url = 'https://grafana.com/docs/learning-paths/foo/milestone-2/unstyled.html';
      expect(findCurrentMilestoneFromUrl(url, milestones)).toBe(2);
    });

    it('strips /content.json and matches the same milestone', () => {
      const url = 'https://grafana.com/docs/learning-paths/foo/milestone-2/content.json';
      expect(findCurrentMilestoneFromUrl(url, milestones)).toBe(2);
    });

    it('returns the legacy /milestone-N number even when no entry matches', () => {
      // Legacy regex fallback fires before the cover-page check
      const url = 'https://grafana.com/docs/learning-paths/foo/milestone-3';
      expect(findCurrentMilestoneFromUrl(url, milestones)).toBe(3);
    });

    it('returns 0 (cover page) when the URL is the journey base URL', () => {
      const url = 'https://grafana.com/docs/learning-paths/foo/';
      expect(findCurrentMilestoneFromUrl(url, milestones)).toBe(0);
    });
  });

  describe('getLearningJourneyBaseUrl — regex precedence', () => {
    type Case = { name: string; input: string; expected: string };
    const cases: Case[] = [
      {
        name: 'learning-journeys takes precedence (legacy)',
        input: 'https://grafana.com/docs/learning-journeys/drilldown-logs/milestone-1/',
        expected: 'https://grafana.com/docs/learning-journeys/drilldown-logs',
      },
      {
        name: 'learning-paths matches when learning-journeys does not',
        input: 'https://grafana.com/docs/learning-paths/drilldown-logs/milestone-2/',
        expected: 'https://grafana.com/docs/learning-paths/drilldown-logs',
      },
      {
        name: 'tutorials matches when neither learning-journeys nor learning-paths does',
        input: 'https://grafana.com/tutorials/alerting-get-started/milestone-1/',
        expected: 'https://grafana.com/tutorials/alerting-get-started',
      },
      {
        name: 'strip-milestone fallback when no top-level prefix matches',
        input: 'https://example.com/some/random/path/milestone-3/extra/',
        expected: 'https://example.com/some/random/path',
      },
    ];

    it.each(cases)('$name', ({ input, expected }) => {
      expect(getLearningJourneyBaseUrl(input)).toBe(expected);
    });
  });

  describe('fetchLearningJourneyMetadataFromJson — filter + renumber', () => {
    let originalFetch: typeof fetch;

    beforeEach(() => {
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    function mockJsonResponse(data: unknown, status = 200) {
      global.fetch = jest.fn().mockResolvedValue({
        ok: status >= 200 && status < 300,
        status,
        json: async () => data,
      }) as unknown as typeof fetch;
    }

    it('filters grafana.skip:true entries and renumbers the remaining sequentially with origin-prefixed permalinks and default duration', async () => {
      mockJsonResponse([
        { params: { title: 'A', grafana: { skip: true } }, permalink: '/a/' },
        { params: { title: 'B' }, permalink: '/b/' },
        { params: { title: 'C', grafana: { skip: true } }, permalink: '/c/' },
        { params: { title: 'D' }, permalink: '/d/' },
      ]);

      const result = await fetchLearningJourneyMetadataFromJson('https://grafana.com/docs/learning-paths/foo');

      expect(result).toEqual([
        {
          number: 1,
          title: 'B',
          duration: '5-10 min',
          url: 'https://grafana.com/b/',
          isActive: false,
        },
        {
          number: 2,
          title: 'D',
          duration: '5-10 min',
          url: 'https://grafana.com/d/',
          isActive: false,
        },
      ]);
    });

    it('returns [] on non-200 response (no throw)', async () => {
      mockJsonResponse({}, 404);
      const result = await fetchLearningJourneyMetadataFromJson('https://grafana.com/docs/learning-paths/foo');
      expect(result).toEqual([]);
    });

    // Critical extra assertion (closes INVESTIGATION §6 invariant 1 gap):
    // index.json fetch over http:// succeeds — proves NO enforceHttps gate is
    // added during extraction (asymmetric hardening must survive verbatim).
    it('does NOT enforce HTTPS — http:// baseUrl reaches the fetch and returns milestones', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [{ params: { title: 'X' }, permalink: '/x/' }],
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await fetchLearningJourneyMetadataFromJson('http://insecure.example.com/docs/foo');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith('http://insecure.example.com/docs/foo/index.json');
      expect(result).toHaveLength(1);
      expect(result[0]!.url).toBe('http://insecure.example.com/x/');
    });
  });

  describe('summary boundaries', () => {
    it('extractJourneySummary uses only the first 3 paragraphs joined by single spaces, with ellipsis only when ≥300 chars', () => {
      const fourPara = '<p>One.</p><p>Two.</p><p>Three.</p><p>Four.</p>';
      // first three paragraphs joined with " "
      // text = "One. Two. Three." (length 16, <300, no ellipsis)
      expect(extractJourneySummary(fourPara)).toBe('One. Two. Three.');

      // Now construct >300 chars across the first 3 paragraphs
      const longBody = 'x'.repeat(150);
      const longHtml = `<p>${longBody}</p><p>${longBody}</p><p>${longBody}</p><p>excluded</p>`;
      const out = extractJourneySummary(longHtml);
      expect(out.endsWith('...')).toBe(true);
      expect(out).not.toContain('excluded');
    });

    it('extractDocSummary returns the meta description when both meta and <p> are present', () => {
      const html = '<head><meta name="description" content="From meta"></head><body><p>From paragraph</p></body>';
      expect(extractDocSummary(html)).toBe('From meta');
    });

    it('extractDocSummary falls back to first <p> when no meta description is present', () => {
      const html = '<body><p>From paragraph only</p></body>';
      expect(extractDocSummary(html)).toBe('From paragraph only');
    });
  });
});
