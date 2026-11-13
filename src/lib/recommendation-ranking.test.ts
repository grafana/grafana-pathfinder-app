import type { Recommendation } from '../types/context.types';
import {
  GENERAL_RELEVANCE,
  legacyRelevance,
  localRelevance,
  mergeRankedRecommendations,
  rankRecommendations,
  sanitizeRelevance,
} from './recommendation-ranking';
import fixture from './testdata/relevance.v1.json';

const rec = (url: string, overrides: Partial<Recommendation> = {}): Recommendation => ({
  title: url,
  url,
  type: 'interactive',
  matchAccuracy: 1,
  ...overrides,
});

it('agrees with the server ranking golden', () => {
  const candidates = fixture.order.map((name) => {
    const entry = fixture.cases.find((c) => c.name === name)!;
    return rec(name, { relevance: sanitizeRelevance(entry.relevance) });
  });
  expect(rankRecommendations([...candidates].reverse()).map((r) => r.url)).toEqual(fixture.order);
});

it.each(fixture.prerequisites)('agrees with the server prerequisite golden: $name', ({ path, candidates, order }) => {
  const recs = candidates.map(({ id, ...manifest }) =>
    rec(id, {
      type: 'package',
      repository: 'tutorials',
      relevance: { ...GENERAL_RELEVANCE, tier: 2, urlSpecificity: 11 },
      manifest: { id, type: 'guide', ...manifest },
    })
  );
  for (const input of [recs, [...recs].reverse()]) {
    expect(rankRecommendations(input, path).map((r) => r.manifest?.id)).toEqual(order);
  }
});

it.each(fixture.cases.filter((c) => c.local))(
  'evaluates local route evidence: $name',
  ({ match, context, relevance }) => {
    expect(localRelevance(match, context.path, context.platform)).toEqual(relevance);
  }
);

it('does not extend offline eligibility or trust malformed evidence', () => {
  expect(
    localRelevance({ and: [{ urlPrefix: '/explore' }, { tag: 'selected-datasource:loki' }] }, '/explore', 'cloud')
  ).toBeUndefined();
  expect(
    localRelevance({ or: [{ urlPrefix: '/explore' }, { tag: 'selected-datasource:loki' }] }, '/explore', 'cloud')
  ).toBeUndefined();
  expect(
    localRelevance({ and: [{ urlPrefix: '/explore' }, { targetPlatform: 'cloud' }] }, '/explore', 'oss')
  ).toBeUndefined();
  for (const value of [
    null,
    {},
    { ...GENERAL_RELEVANCE, tier: 99 },
    { ...GENERAL_RELEVANCE, version: 2 },
    { ...GENERAL_RELEVANCE, taskSignals: NaN },
  ]) {
    expect(sanitizeRelevance(value)).toBeUndefined();
  }
});

it('only infers conservative route relevance from old response criteria', () => {
  expect(
    legacyRelevance(
      rec('a', { matchedCriteria: ['urlPrefixIn:/,/explore,/explore/long', 'tag:selected-datasource:loki'] }),
      '/explore'
    )
  ).toEqual({
    ...GENERAL_RELEVANCE,
    tier: 2,
    urlSpecificity: 8,
  });
  expect(
    legacyRelevance(
      rec('a', { matchedCriteria: ['urlPrefix:/explore'], missingCriteria: ['targetPlatform:cloud'] }),
      '/explore'
    )
  ).toEqual(GENERAL_RELEVANCE);
});

it('keeps relevance ahead of completion and format, but demotes completed peers', () => {
  const task = { ...GENERAL_RELEVANCE, tier: 3, taskSignals: 1, urlSpecificity: 8 };
  const area = { ...GENERAL_RELEVANCE, tier: 2, urlSpecificity: 8 };
  const candidates = [
    rec('area-guide', { relevance: area }),
    rec('completed-task', { relevance: task, completionPercentage: 100 }),
    rec('task-docs', { relevance: task, type: 'docs-page' }),
  ];
  expect(rankRecommendations(candidates).map((r) => r.url)).toEqual(['task-docs', 'completed-task', 'area-guide']);
  expect(candidates[0]?.url).toBe('area-guide');
});

it('preserves explicit overrides, merges duplicates and does not prepend editorial items', () => {
  const strong = rec('task', { relevance: { ...GENERAL_RELEVANCE, tier: 3 } });
  const weak = rec('editorial', { editorialFeatured: true });
  const suggestion = rec('suggested', { placement: 'suggestion' });
  const experiment = rec('experiment', { placement: 'experiment' });
  expect(mergeRankedRecommendations([strong, weak], [weak, experiment, suggestion]).map((r) => r.url)).toEqual([
    'suggested',
    'experiment',
    'task',
    'editorial',
  ]);
  expect(mergeRankedRecommendations([strong], [{ ...strong, placement: 'experiment' }])).toHaveLength(1);
  expect(
    mergeRankedRecommendations(
      [{ ...strong, relevance: GENERAL_RELEVANCE, placement: 'suggestion' }],
      [{ ...strong, placement: 'experiment', editorialFeatured: true }]
    )[0]
  ).toMatchObject({ relevance: strong.relevance, placement: 'suggestion', editorialFeatured: true });
});

it('keeps route evidence for a featured guide on the page it targets', () => {
  const area = { ...GENERAL_RELEVANCE, tier: 2, urlSpecificity: 11 };
  const docs = ['d1', 'd2', 'd3', 'd4', 'd5'].map((url) => rec(url, { type: 'docs-page', relevance: area }));
  const featured = rec('featured', { relevance: area, editorialFeatured: true });
  expect(mergeRankedRecommendations(docs, [featured], '/dashboards')[0]?.url).toBe('featured');
});

it('breaks score ties by stable identity', () => {
  expect(rankRecommendations([rec('z'), rec('a')]).map((r) => r.url)).toEqual(['a', 'z']);
  expect(rankRecommendations([rec('a'), rec('z')]).map((r) => r.url)).toEqual(['a', 'z']);
});

const guide = (id: string, startingLocation: string, recommends: string[] = [], extra: Partial<Recommendation> = {}) =>
  rec(`https://guides.test/${id}/content.json`, {
    type: 'package',
    repository: 'tutorials',
    relevance: { ...GENERAL_RELEVANCE, tier: 2, urlSpecificity: 11 },
    manifest: { id, type: 'guide', startingLocation, recommends },
    ...extra,
  });

it('puts first-dashboard before its follow-on guides without changing the matched set', () => {
  const matched = [
    guide('dashboard-playlists-guide', '/playlists', ['first-dashboard']),
    guide('dashboard-snapshot-guide', '/dashboards', ['first-dashboard']),
    guide('first-dashboard', '/dashboards'),
    guide('grafana-quickpizza-working-filters', '/a/grafana-demodashboards-app'),
  ];
  const expected = [
    'first-dashboard',
    'dashboard-snapshot-guide',
    'dashboard-playlists-guide',
    'grafana-quickpizza-working-filters',
  ];
  for (const candidates of [matched, [...matched].reverse()]) {
    expect(rankRecommendations(candidates, '/dashboards').map((r) => r.manifest?.id)).toEqual(expected);
  }
});

it('does not move weak or completed prerequisites ahead of relevant unfinished content', () => {
  const followOn = guide('a-follow-on', '/dashboards', ['z-foundation']);
  const foundation = guide('z-foundation', '/dashboards');
  expect(rankRecommendations([followOn, { ...foundation, completionPercentage: 100 }], '/dashboards')[0]).toBe(
    followOn
  );
  expect(rankRecommendations([followOn, { ...foundation, relevance: GENERAL_RELEVANCE }], '/dashboards')[0]).toBe(
    followOn
  );
});

it('treats prerequisites as peers only when match accuracy is equal too', () => {
  const followOn = guide('a-follow-on', '/dashboards', ['z-foundation'], { matchAccuracy: 0.9 });
  const foundation = guide('z-foundation', '/dashboards', [], { matchAccuracy: 0.8 });
  for (const input of [
    [followOn, foundation],
    [foundation, followOn],
  ]) {
    expect(rankRecommendations(input, '/dashboards').map((r) => r.manifest?.id)).toEqual([
      'a-follow-on',
      'z-foundation',
    ]);
    expect(
      rankRecommendations(
        input.map((r) => ({ ...r, matchAccuracy: 0.8 })),
        '/dashboards'
      ).map((r) => r.manifest?.id)
    ).toEqual(['z-foundation', 'a-follow-on']);
  }
});

it('keeps cycles, missing prerequisites and related suggestions available with stable order', () => {
  const a = guide('a', '/dashboards', ['b', 'missing']);
  const b = guide('b', '/dashboards', ['a']);
  expect(rankRecommendations([b, a], '/dashboards').map((r) => r.manifest?.id)).toEqual(['a', 'b']);
  expect(rankRecommendations([a], '/dashboards')).toEqual([a]);
  const suggested = guide('z', '/dashboards');
  expect(
    rankRecommendations([{ ...a, manifest: { id: 'a', type: 'guide', suggests: ['z'] } }, suggested]).map(
      (r) => r.manifest?.id
    )
  ).toEqual(['a', 'z']);
});

it('uses hard prerequisites too and does not assume an OR alternative is mandatory', () => {
  const foundation = guide('z-foundation', '/dashboards');
  const child = guide('a-follow-on', '/dashboards', [], {
    manifest: { id: 'a-follow-on', type: 'guide', startingLocation: '/dashboards', depends: ['z-foundation'] },
  });
  expect(rankRecommendations([child, foundation], '/dashboards')[0]).toBe(foundation);
  const alternative = { ...child, manifest: { ...child.manifest, depends: [['z-foundation', 'missing']] } };
  expect(rankRecommendations([alternative, foundation], '/dashboards')[0]).toBe(alternative);
});
