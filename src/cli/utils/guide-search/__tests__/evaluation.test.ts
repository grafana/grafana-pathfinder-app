/**
 * @jest-environment node
 *
 * Every ranking rule, exercised over `fixtures/catalog-fixture.json`: a
 * hand-built catalog in the real `repository.json` shape with invented ids, so
 * these assertions never go stale when the published catalog changes. Quality
 * against the real catalog is the on-demand live check
 * (`npm run eval:guide-search`), not part of this suite.
 */

import fixture from './fixtures/catalog-fixture.json';
import {
  buildGuideSearchIndex,
  searchGuides,
  type CatalogEntry,
  type GuideSearchRequest,
  type GuideSearchResult,
} from '../search';

const catalog: CatalogEntry[] = Object.entries(fixture as Record<string, Omit<CatalogEntry, 'id'>>).map(
  ([id, entry]) => ({ ...entry, id })
);
const index = buildGuideSearchIndex(catalog);

function search(request: Partial<GuideSearchRequest>) {
  const outcome = searchGuides(index, { limit: 15, ...request });
  if (!outcome.ok) {
    throw new Error(outcome.code);
  }
  return outcome;
}

const ids = (request: Partial<GuideSearchRequest>) => search(request).results.map((r) => r.entry.id);
const find = (results: GuideSearchResult[], id: string) => results.find((r) => r.entry.id === id);

describe('guide search ranking rules', () => {
  it('stems and tokenizes, so "configuring alerts" finds "Configure alert rules"', () => {
    expect(search({ queries: ['configuring alerts'] }).results[0]).toMatchObject({
      entry: { id: 'alert-rules-basics' },
      relevance: 'strong',
    });
  });

  it('weights a title match above a description-only match', () => {
    const ranked = ids({ queries: ['telemetry'], type: 'guide' });
    const inTitle = catalog.filter((e) => /telemetry/i.test(e.title ?? '')).map((e) => e.id);
    const lastTitleHit = Math.max(...inTitle.map((id) => ranked.indexOf(id)));
    const firstDescriptionHit = Math.min(
      ...ranked.filter((id) => !inTitle.includes(id)).map((id) => ranked.indexOf(id))
    );
    expect(lastTitleHit).toBeLessThan(firstDescriptionHit);
  });

  it('weights a rare term above a common one', () => {
    expect(ids({ queries: ['cardinality telemetry'] })[0]).toBe('cardinality-reduce');
  });

  it('combines queries so one strong phrasing outweighs a weak one', () => {
    const outcome = search({ queries: ['make spend lower', 'reduce series cardinality'] });
    expect(outcome.results[0]).toMatchObject({ entry: { id: 'cardinality-reduce' }, relevance: 'strong' });
    expect(outcome.noStrongMatch).toBe(false);
  });

  it('counts an exact term toward strong but not a prefix expansion', () => {
    expect(search({ queries: ['postgresql'] }).results[0]).toMatchObject({
      entry: { id: 'postgresql-connect' },
      relevance: 'strong',
    });
    const prefixOnly = search({ queries: ['postgres'] });
    expect(prefixOnly.results.map((r) => [r.entry.id, r.relevance])).toEqual([['postgresql-connect', 'partial']]);
    expect(prefixOnly.noStrongMatch).toBe(true);
  });

  it('reports noStrongMatch for description-only and empty results', () => {
    const descriptionOnly = search({ queries: ['maintenance windows'] });
    expect(descriptionOnly.results.map((r) => [r.entry.id, r.relevance])).toEqual([['alert-silences', 'partial']]);
    expect(descriptionOnly.noStrongMatch).toBe(true);
    expect(search({ queries: ['quantum'] })).toEqual({ ok: true, results: [], totalMatches: 0, noStrongMatch: true });
  });

  it('groups steps under every parent path and never lists a step beside them', () => {
    const results = search({ queries: ['verify incoming data'] }).results;
    expect(find(results, 'ingest-logs-lj')?.matchedSteps?.[0]).toEqual({
      id: 'shared-verify-data',
      title: 'Verify incoming data',
      step: 3,
    });
    expect(find(results, 'ingest-metrics-lj')?.matchedSteps?.[0]).toMatchObject({ id: 'shared-verify-data', step: 2 });
    expect(find(results, 'shared-verify-data')).toBeUndefined();
  });

  it('returns a guide that belongs to no path at the top level', () => {
    expect(ids({ queries: ['arrange widgets'] })).toEqual(['widgets-path', 'widgets-b']);
  });

  it('names an eligible parent in partOf under type "guide"', () => {
    const step = (request: Partial<GuideSearchRequest>) =>
      find(search({ queries: ['verify incoming data'], type: 'guide', ...request }).results, 'shared-verify-data');
    expect(step({})?.partOf).toEqual({ id: 'ingest-logs-lj', title: 'Ship logs with the collector', step: 3, of: 3 });
    expect(step({ excludeIds: ['ingest-logs-lj'] })?.partOf).toMatchObject({ id: 'ingest-metrics-lj', step: 2, of: 2 });
    expect(step({ excludeIds: ['ingest-logs-lj', 'ingest-metrics-lj'] })).toBeUndefined();
  });

  it('matches pages by urlPrefix and urlPrefixIn, most specific first, as strong', () => {
    expect(search({ pageUrl: '/alerting/history/rule-1' }).results.map((r) => [r.entry.id, r.relevance])).toEqual([
      ['alert-history-tour', 'strong'],
      ['alert-rules-basics', 'strong'],
    ]);
    expect(ids({ pageUrl: '/alerts-and-incidents' })).toEqual(['alert-rules-basics']);
  });

  it('matches pages by urlRegex', () => {
    expect(ids({ pageUrl: '/connections' })).toEqual(['connection-picker']);
    expect(ids({ pageUrl: '/connections/new' })).toEqual([]);
  });

  it('matches pages by startingLocation prefix, as partial', () => {
    expect(search({ pageUrl: '/a/example-collector-app/pipelines/edit' }).results).toEqual([
      expect.objectContaining({
        entry: expect.objectContaining({ id: 'ingest-logs-lj' }),
        relevance: 'partial',
        matchedOn: ['page'],
      }),
    ]);
  });

  it('boosts a page match among query matches', () => {
    expect(ids({ queries: ['alert'], pageUrl: '/alerting/history', type: 'guide' })[0]).toBe('alert-history-tour');
    expect(ids({ queries: ['alert'], pageUrl: '/alerting/new', type: 'guide' })[0]).toBe('alert-rules-basics');
  });

  it('hides oss-only guides on cloud and cloud-only guides on oss', () => {
    expect(ids({ pageUrl: '/', platform: 'oss' })).toEqual(['self-managed-welcome']);
    expect(ids({ pageUrl: '/', platform: 'cloud' })).toEqual([]);
    expect(ids({ queries: ['usage optimizer'], platform: 'cloud' })).toEqual(['usage-optimizer-lj']);
    expect(ids({ queries: ['usage optimizer'], platform: 'oss' })).toEqual([]);
  });

  it('keeps a local-tier guide on cloud', () => {
    expect(ids({ queries: ['sample dashboard tour'], platform: 'cloud' })[0]).toBe('sample-dashboard-tour');
  });

  it('skips an over-long urlRegex and one that fails to compile', () => {
    expect(ids({ pageUrl: `/${'x'.repeat(220)}` })).toEqual([]);
    expect(ids({ pageUrl: '/broken-fallback/page' })).toEqual(['regex-broken']);
  });

  it('returns promptly from a catastrophic-backtracking urlRegex', () => {
    const started = Date.now();
    expect(ids({ pageUrl: `/${'a'.repeat(40)}!` })).toEqual([]);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('honours excludeIds and limit, reporting totalMatches before the limit', () => {
    const all = search({ queries: ['telemetry'] });
    const limited = search({ queries: ['telemetry'], limit: 3 });
    expect(limited.results.map((r) => r.entry.id)).toEqual(all.results.slice(0, 3).map((r) => r.entry.id));
    expect(limited.totalMatches).toBe(all.totalMatches);
    const first = all.results[0]!.entry.id;
    expect(ids({ queries: ['telemetry'], excludeIds: [first] })).not.toContain(first);
  });

  it('breaks ties with paths first, then by id', () => {
    expect(ids({ queries: ['arrange widgets'], type: 'guide' })).toEqual(['widgets-a', 'widgets-b']);
    expect(ids({ queries: ['arrange widgets'] })[0]).toBe('widgets-path');
  });

  it('returns the same results regardless of catalog order', () => {
    const reversed = buildGuideSearchIndex([...catalog].reverse());
    const requests: Array<Partial<GuideSearchRequest>> = [
      { queries: ['telemetry'] },
      { queries: ['verify incoming data'], type: 'guide' },
      { pageUrl: '/alerting/history' },
      { queries: ['arrange widgets'] },
    ];
    for (const request of requests) {
      const full = { limit: 15, ...request };
      expect(searchGuides(reversed, full)).toEqual(searchGuides(index, full));
    }
  });
});
