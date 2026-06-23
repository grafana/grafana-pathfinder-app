import {
  extractTitleFromJson,
  extractTitleFromHtml,
  extractSingleDocMetadata,
  extractJourneySummary,
  extractDocSummary,
  findCurrentMilestoneFromUrl,
  fetchLearningJourneyMetadataFromJson,
} from './metadata-extract';
import type { Milestone } from '../../types/content.types';

const JOURNEY_BASE = 'https://grafana.com/docs/learning-journeys/drilldown-logs';

describe('metadata-extract', () => {
  describe('extractTitleFromJson', () => {
    it('returns the title field when present', () => {
      expect(extractTitleFromJson('{"title":"Explore logs"}')).toBe('Explore logs');
    });

    it('falls back to "Documentation" for empty, missing, or non-string titles', () => {
      expect(extractTitleFromJson('{"title":""}')).toBe('Documentation');
      expect(extractTitleFromJson('{"other":"x"}')).toBe('Documentation');
      expect(extractTitleFromJson('{"title":42}')).toBe('Documentation');
      expect(extractTitleFromJson('null')).toBe('Documentation');
    });
  });

  describe('extractTitleFromHtml (fallback chain)', () => {
    it('prefers <title> over <h1> and og:title', () => {
      const html = `<title>From title</title><h1>From h1</h1><meta property="og:title" content="From og">`;
      expect(extractTitleFromHtml(html)).toBe('From title');
    });

    it('falls back to <h1> when <title> is absent', () => {
      const html = `<h1>From h1</h1><meta property="og:title" content="From og">`;
      expect(extractTitleFromHtml(html)).toBe('From h1');
    });

    it('falls back to og:title when <title> and <h1> are absent', () => {
      const html = `<meta property="og:title" content="From og">`;
      expect(extractTitleFromHtml(html)).toBe('From og');
    });

    it('trims surrounding whitespace and defaults to "Documentation"', () => {
      expect(extractTitleFromHtml('<title>  Spaced  </title>')).toBe('Spaced');
      expect(extractTitleFromHtml('<div>no title here</div>')).toBe('Documentation');
    });
  });

  describe('extractJourneySummary (300-char truncation)', () => {
    it('joins the first three paragraphs and strips inline tags', () => {
      const html = '<p>One <b>bold</b></p><p>Two</p><p>Three</p><p>Four</p>';
      expect(extractJourneySummary(html)).toBe('One bold Two Three');
    });

    it('truncates to 300 chars and appends an ellipsis at the boundary', () => {
      const html = `<p>${'x'.repeat(500)}</p>`;
      const summary = extractJourneySummary(html);
      expect(summary).toBe('x'.repeat(300) + '...');
      expect(summary.length).toBe(303);
    });

    it('does not append an ellipsis when under 300 chars', () => {
      const summary = extractJourneySummary('<p>short</p>');
      expect(summary).toBe('short');
    });

    it('returns an empty string when there are no paragraphs', () => {
      expect(extractJourneySummary('<div>no paragraphs</div>')).toBe('');
    });
  });

  describe('extractDocSummary', () => {
    it('prefers the meta description over the first paragraph', () => {
      const html = '<meta name="description" content="Meta summary"><p>Paragraph</p>';
      expect(extractDocSummary(html)).toBe('Meta summary');
    });

    it('falls back to the first paragraph (capped at 200 chars) when no meta description', () => {
      const html = `<p>${'y'.repeat(250)}</p>`;
      expect(extractDocSummary(html)).toBe('y'.repeat(200));
    });

    it('returns an empty string when neither source is present', () => {
      expect(extractDocSummary('<div>nothing</div>')).toBe('');
    });
  });

  describe('extractSingleDocMetadata', () => {
    it('wraps the doc summary in a SingleDocMetadata object', () => {
      const html = '<meta name="description" content="Wrapped">';
      expect(extractSingleDocMetadata(html)).toEqual({ summary: 'Wrapped' });
    });
  });

  describe('findCurrentMilestoneFromUrl (branches)', () => {
    const milestones: Milestone[] = [
      { number: 1, title: 'A', duration: '5 min', url: `${JOURNEY_BASE}/first`, isActive: false },
      { number: 2, title: 'B', duration: '5 min', url: `${JOURNEY_BASE}/second`, isActive: false },
    ];

    it('returns the milestone number on an exact URL match', () => {
      expect(findCurrentMilestoneFromUrl(`${JOURNEY_BASE}/second`, milestones)).toBe(2);
    });

    it('strips /content.json and /unstyled.html suffixes before matching', () => {
      expect(findCurrentMilestoneFromUrl(`${JOURNEY_BASE}/first/content.json`, milestones)).toBe(1);
      expect(findCurrentMilestoneFromUrl(`${JOURNEY_BASE}/second/unstyled.html`, milestones)).toBe(2);
    });

    it('matches the legacy /milestone-N pattern when no milestone matches', () => {
      expect(findCurrentMilestoneFromUrl(`${JOURNEY_BASE}/milestone-7`, milestones)).toBe(7);
    });

    it('returns 0 (cover page) for the journey base URL', () => {
      expect(findCurrentMilestoneFromUrl(JOURNEY_BASE, milestones)).toBe(0);
      expect(findCurrentMilestoneFromUrl(`${JOURNEY_BASE}/`, milestones)).toBe(0);
    });

    it('defaults to 0 when nothing matches', () => {
      expect(findCurrentMilestoneFromUrl('https://grafana.com/docs/unrelated/page', milestones)).toBe(0);
    });
  });

  describe('fetchLearningJourneyMetadataFromJson (milestone renumbering)', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
      jest.restoreAllMocks();
    });

    function mockIndexJson(data: unknown, ok = true, status = 200) {
      global.fetch = jest.fn().mockResolvedValue({
        ok,
        status,
        json: async () => data,
      }) as unknown as typeof fetch;
    }

    it('renumbers sequentially after filtering grafana.skip items (no gaps)', async () => {
      mockIndexJson([
        { params: { title: 'Intro' }, permalink: '/intro/' },
        { params: { title: 'Skipped', grafana: { skip: true } }, permalink: '/skipped/' },
        { params: { title: 'Wrap up' }, permalink: '/wrap/' },
      ]);

      const milestones = await fetchLearningJourneyMetadataFromJson(JOURNEY_BASE);

      expect(milestones.map((m) => ({ number: m.number, title: m.title }))).toEqual([
        { number: 1, title: 'Intro' },
        { number: 2, title: 'Wrap up' },
      ]);
      expect(milestones[0]!.url).toBe('https://grafana.com/intro/');
    });

    it('falls back through title -> menutitle -> "Step N" and applies a default duration', async () => {
      mockIndexJson([
        { params: { menutitle: 'Menu only' }, permalink: '/a/' },
        { params: {}, permalink: '/b/' },
      ]);

      const milestones = await fetchLearningJourneyMetadataFromJson(JOURNEY_BASE);

      expect(milestones[0]!.title).toBe('Menu only');
      expect(milestones[1]!.title).toBe('Step 2');
      expect(milestones[0]!.duration).toBe('5-10 min');
    });

    it('returns an empty array on a non-ok response', async () => {
      mockIndexJson(null, false, 404);
      await expect(fetchLearningJourneyMetadataFromJson(JOURNEY_BASE)).resolves.toEqual([]);
    });

    it('returns an empty array when fetch rejects', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;
      await expect(fetchLearningJourneyMetadataFromJson(JOURNEY_BASE)).resolves.toEqual([]);
    });
  });
});
