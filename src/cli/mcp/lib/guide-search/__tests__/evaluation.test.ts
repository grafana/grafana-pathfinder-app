/**
 * @jest-environment node
 *
 * Guide-search quality gate over a trimmed copy of the live `repository.json`
 * (fetched 2026-10-02, ETag W/"85e42f8dd29ca29ef02010fba8cdd1c3"; only the
 * fields search reads). Refresh the snapshot and revisit the cases when the
 * catalog changes a lot.
 *
 * Each case in `fixtures/evaluation-cases.json` pairs what a user said with the
 * queries an agent would plausibly send. A case with `expect` passes when any
 * listed id, or the path containing it, is in the top three results; a case
 * without `expect` has no right answer and must report `noStrongMatch`.
 */

import snapshot from './fixtures/catalog-snapshot.json';
import cases from './fixtures/evaluation-cases.json';
import {
  buildGuideSearchIndex,
  searchGuides,
  type CatalogEntry,
  type GuideSearchRequest,
  type GuideSearchResult,
} from '../search';

interface EvaluationCase {
  group: string;
  name: string;
  user: string;
  request: Omit<GuideSearchRequest, 'limit'>;
  expect?: string[];
}

const EVALUATION_CASES = cases as EvaluationCase[];

const MIN_TOP_THREE_RECALL = 0.9;

const catalog: CatalogEntry[] = Object.entries(snapshot as Record<string, Omit<CatalogEntry, 'id'>>).map(
  ([id, entry]) => ({ ...entry, id })
);
const index = buildGuideSearchIndex(catalog);

function run(testCase: EvaluationCase, limit = 5): GuideSearchResult[] {
  const outcome = searchGuides(index, { ...testCase.request, limit });
  if (!outcome.ok) {
    throw new Error(`${testCase.name}: ${outcome.code}`);
  }
  return outcome.results;
}

function idsCovered(result: GuideSearchResult): string[] {
  return [result.entry.id, ...(result.matchedSteps ?? []).map((s) => s.id)];
}

function hitsTopThree(testCase: EvaluationCase): boolean {
  const covered = run(testCase).slice(0, 3).flatMap(idsCovered);
  return (testCase.expect ?? []).some((id) => covered.includes(id) || pathOf(id).some((p) => covered.includes(p)));
}

function pathOf(id: string): string[] {
  return catalog.filter((e) => e.milestones?.includes(id)).map((e) => e.id);
}

const positive = EVALUATION_CASES.filter((c) => c.expect);
const noAnswer = EVALUATION_CASES.filter((c) => !c.expect);

describe('guide search evaluation', () => {
  it('has 30-50 cases, with no-answer cases among them', () => {
    expect(EVALUATION_CASES.length).toBeGreaterThanOrEqual(30);
    expect(EVALUATION_CASES.length).toBeLessThanOrEqual(50);
    expect(noAnswer.length).toBeGreaterThan(0);
  });

  it('names only ids that exist in the snapshot', () => {
    const known = new Set(catalog.map((e) => e.id));
    const unknown = positive.flatMap((c) => c.expect!).filter((id) => !known.has(id));
    expect(unknown).toEqual([]);
  });

  it(`finds an expected guide in the top three for at least ${MIN_TOP_THREE_RECALL * 100}% of cases`, () => {
    const misses = positive.filter((c) => !hitsTopThree(c)).map((c) => c.name);
    const allowed = Math.floor(positive.length * (1 - MIN_TOP_THREE_RECALL));
    expect(misses.length <= allowed ? [] : misses).toEqual([]);
  });

  it('labels the top result strong for every case with a right answer', () => {
    const weak = positive.filter((c) => run(c)[0]?.relevance !== 'strong').map((c) => c.name);
    expect(weak).toEqual([]);
  });

  it('reports noStrongMatch for every case with no right answer', () => {
    const wrong = noAnswer.filter((c) => {
      const outcome = searchGuides(index, { ...c.request, limit: 5 });
      return !outcome.ok || !outcome.noStrongMatch;
    });
    expect(wrong.map((c) => c.name)).toEqual([]);
  });

  it('never lists a path step beside its own path', () => {
    for (const testCase of EVALUATION_CASES) {
      const results = run(testCase, 15);
      const topLevel = new Set(results.map((r) => r.entry.id));
      const crowded = results
        .flatMap((r) => (r.type === 'path' ? [] : pathOf(r.entry.id)))
        .filter((p) => topLevel.has(p));
      expect({ name: testCase.name, crowded }).toEqual({ name: testCase.name, crowded: [] });
    }
  });

  it('returns the same results for the same inputs regardless of catalog order', () => {
    const reversed = buildGuideSearchIndex([...catalog].reverse());
    for (const testCase of EVALUATION_CASES) {
      const request = { ...testCase.request, limit: 15 };
      expect(searchGuides(reversed, request)).toEqual(searchGuides(index, request));
    }
  });
});
