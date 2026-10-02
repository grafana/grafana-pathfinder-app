/**
 * @jest-environment node
 */

import { buildGuideSearchIndex, searchGuides, type CatalogEntry, type GuideSearchRequest } from '../search';

const catalog: CatalogEntry[] = [
  {
    id: 'kubernetes-lp',
    type: 'path',
    path: 'kubernetes-lp/',
    title: 'Monitor Kubernetes clusters',
    description: 'A learning path.',
    category: 'learning-path',
    startingLocation: '/a/grafana-k8s-app',
    milestones: ['kubernetes-lp-alerts', 'kubernetes-lp-deploy', 'missing-step'],
  },
  {
    id: 'kubernetes-lp-alerts',
    type: 'guide',
    path: 'kubernetes-lp-alerts/',
    title: 'Install Kubernetes alerting rules',
    category: 'take-action',
  },
  {
    id: 'kubernetes-lp-deploy',
    type: 'guide',
    path: 'kubernetes-lp-deploy/',
    title: 'Deploy the Kubernetes Helm chart',
    category: 'data-availability',
  },
  {
    id: 'alerting-101',
    type: 'guide',
    path: 'alerting-101/',
    title: 'Alerting 101',
    description: 'Learn the basics.',
    category: 'general',
    targeting: { match: { urlPrefixIn: ['/alerting', '/alerts-and-incidents'] } },
  },
  {
    id: 'cloud-alerting',
    type: 'guide',
    path: 'cloud-alerting/',
    title: 'Alerting in the cloud',
    category: 'general',
    targeting: { match: { and: [{ urlPrefix: '/alerting/list' }, { targetPlatform: 'cloud' }] } },
  },
  {
    id: 'oss-home',
    type: 'guide',
    path: 'oss-home/',
    title: 'Self-hosted assistant',
    category: 'general',
    targeting: { match: { and: [{ urlRegex: '^/?$' }, { targetPlatform: 'oss' }] } },
  },
  {
    id: 'cardinality',
    type: 'guide',
    path: 'cardinality/',
    title: 'Reduce cardinality',
    description: 'Fewer series, mentions alerting once.',
    category: 'general',
  },
  {
    id: 'tour-journey',
    type: 'journey',
    path: 'tour-journey/',
    title: 'Tour',
    category: 'onboarding',
    milestones: ['kubernetes-lp-deploy'],
  },
];

const index = buildGuideSearchIndex(catalog);

function search(request: Partial<GuideSearchRequest>) {
  const outcome = searchGuides(index, { limit: 15, ...request });
  if (!outcome.ok) {
    throw new Error(outcome.code);
  }
  return outcome;
}

const ids = (request: Partial<GuideSearchRequest>) => search(request).results.map((r) => r.entry.id);

describe('searchGuides', () => {
  it('groups matching steps under their path, best step first, with step ordinals', () => {
    const results = search({ queries: ['kubernetes alerting'] }).results;
    expect(results[0]).toMatchObject({ type: 'path', relevance: 'strong', stepCount: 2 });
    expect(results[0]!.entry.id).toBe('kubernetes-lp');
    expect(results[0]!.matchedSteps).toEqual([
      { id: 'kubernetes-lp-alerts', step: 1, title: 'Install Kubernetes alerting rules' },
      { id: 'kubernetes-lp-deploy', step: 2, title: 'Deploy the Kubernetes Helm chart' },
    ]);
    expect(results.map((r) => r.entry.id)).not.toContain('kubernetes-lp-alerts');
  });

  it('lists a step under every path that includes it', () => {
    const results = search({ queries: ['helm chart'] }).results;
    expect(results.map((r) => [r.entry.id, r.matchedSteps?.map((s) => s.step)])).toEqual([
      ['kubernetes-lp', [2]],
      ['tour-journey', [1]],
    ]);
  });

  it('returns steps individually with partOf when type is guide', () => {
    const results = search({ queries: ['helm chart'], type: 'guide' }).results;
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      type: 'guide',
      partOf: { id: 'kubernetes-lp', title: 'Monitor Kubernetes clusters', step: 2, of: 2 },
    });
  });

  it('returns only paths when type is path', () => {
    expect(ids({ queries: ['alerting'], type: 'path' })).toEqual(['kubernetes-lp']);
  });

  it('ranks rare terms and title matches above common terms and description matches', () => {
    const guides = ids({ queries: ['alerting'], type: 'guide' });
    expect(guides.slice(0, 2)).toEqual(['alerting-101', 'cloud-alerting']);
    expect(guides.at(-1)).toBe('cardinality');
  });

  it('labels strong only when every term appears in the title or id', () => {
    const results = search({ queries: ['alerting basics'] }).results;
    expect(results.find((r) => r.entry.id === 'alerting-101')).toMatchObject({
      relevance: 'partial',
      matchedOn: ['title', 'id', 'description'],
    });
  });

  it('combines several queries so one strong phrasing wins', () => {
    const outcome = search({ queries: ['make fewer series', 'reduce cardinality'] });
    expect(outcome.results[0]).toMatchObject({ relevance: 'strong' });
    expect(outcome.results[0]!.entry.id).toBe('cardinality');
    expect(outcome.noStrongMatch).toBe(false);
  });

  it('reports noStrongMatch when nothing is strong', () => {
    const outcome = search({ queries: ['series'] });
    expect(outcome.results.map((r) => r.relevance)).toEqual(['partial']);
    expect(outcome.noStrongMatch).toBe(true);
  });

  it('returns page-targeted guides with no query, most specific first, as strong', () => {
    const outcome = search({ pageUrl: '/alerting/list' });
    expect(outcome.results.map((r) => [r.entry.id, r.relevance, r.matchedOn])).toEqual([
      ['cloud-alerting', 'strong', ['page']],
      ['alerting-101', 'strong', ['page']],
    ]);
  });

  it('counts a startingLocation match as a page match without making it strong', () => {
    expect(search({ pageUrl: '/a/grafana-k8s-app/home' }).results).toEqual([
      expect.objectContaining({ type: 'path', relevance: 'partial', matchedOn: ['page'] }),
    ]);
  });

  it('boosts page matches among query matches but does not add unrelated page matches', () => {
    expect(ids({ queries: ['alerting'], pageUrl: '/alerting/list', type: 'guide' }).slice(0, 2)).toEqual([
      'cloud-alerting',
      'alerting-101',
    ]);
    expect(ids({ queries: ['cardinality'], pageUrl: '/alerting/list' })).toEqual(['cardinality']);
  });

  it('filters by platform from the targeting tree', () => {
    expect(ids({ queries: ['alerting'], platform: 'oss' })).not.toContain('cloud-alerting');
    expect(ids({ queries: ['self hosted assistant'], platform: 'cloud' })).toEqual([]);
    expect(ids({ queries: ['self hosted assistant'], platform: 'oss' })).toEqual(['oss-home']);
  });

  it('excludes ids, and hides the steps of an excluded path', () => {
    expect(ids({ queries: ['alerting'], excludeIds: ['alerting-101', 'kubernetes-lp'] })).toEqual([
      'cloud-alerting',
      'cardinality',
    ]);
  });

  it('filters categories and keeps a path whose matching step is in the category', () => {
    expect(ids({ queries: ['kubernetes'], categories: ['take-action'] })).toEqual(['kubernetes-lp']);
    const [path] = search({ queries: ['kubernetes'], categories: ['take-action'] }).results;
    expect(path!.matchedSteps?.map((s) => s.id)).toEqual(['kubernetes-lp-alerts']);
  });

  it('rejects unknown categories and lists the valid ones', () => {
    expect(searchGuides(index, { queries: ['x'], categories: ['general', 'nope'], limit: 5 })).toEqual({
      ok: false,
      code: 'UNKNOWN_CATEGORY',
      unknown: ['nope'],
      categories: ['data-availability', 'general', 'learning-path', 'onboarding', 'take-action'],
    });
  });

  it('applies the limit after ranking and reports totalMatches', () => {
    const outcome = search({ queries: ['alerting'], limit: 2 });
    expect(outcome.results).toHaveLength(2);
    expect(outcome.totalMatches).toBe(4);
  });

  it('breaks ties with paths first, then by id', () => {
    const tied = buildGuideSearchIndex([
      { id: 'b-guide', type: 'guide', path: 'b/', title: 'Widgets' },
      { id: 'a-guide', type: 'guide', path: 'a/', title: 'Widgets' },
      { id: 'z-path', type: 'path', path: 'z/', title: 'Widgets' },
    ]);
    const outcome = searchGuides(tied, { queries: ['widgets'], limit: 5 });
    expect(outcome.ok && outcome.results.map((r) => r.entry.id)).toEqual(['z-path', 'a-guide', 'b-guide']);
  });

  it('matches data-source variants by prefix', () => {
    const variants = buildGuideSearchIndex([
      { id: 'postgresql-data-source-lj', type: 'path', path: 'p/', title: 'Connect to a PostgreSQL data source' },
    ]);
    const outcome = searchGuides(variants, { queries: ['connect postgres'], limit: 5 });
    expect(outcome.ok && outcome.results.map((r) => [r.entry.id, r.relevance])).toEqual([
      ['postgresql-data-source-lj', 'strong'],
    ]);
  });

  it('returns nothing for stopword-only queries without a page', () => {
    expect(search({ queries: ['how do I'] })).toEqual({ ok: true, results: [], totalMatches: 0, noStrongMatch: true });
  });

  it('tolerates malformed catalog entries', () => {
    const messy = buildGuideSearchIndex([
      { id: 'ok', type: 'guide', path: 'ok/', title: 'Alerting' },
      { id: 'bad', type: 7, path: 'bad/', title: { no: 1 }, milestones: 'x', targeting: { match: 'nope' } } as never,
    ]);
    const outcome = searchGuides(messy, { queries: ['alerting'], pageUrl: '/x', limit: 5 });
    expect(outcome.ok && outcome.results.map((r) => r.entry.id)).toEqual(['ok']);
  });
});
