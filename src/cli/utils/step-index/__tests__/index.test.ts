import type { Procedure } from '../segment';
import { fixtureProcedures } from '../../../../test-utils/step-index-fixtures';
import { buildStepIndex, searchSteps, selectorWords, STRONG_SCORE } from '../index';

const index = buildStepIndex(fixtureProcedures());
const find = (query: string, extra: { pageUrl?: string; excludeIds?: string[] } = {}) =>
  searchSteps(index, { queries: [query], limit: 3, ...extra })[0]!;

describe('searchSteps', () => {
  it('returns the dependent filter procedure first', () => {
    const [top] = find('dependent service filter').hits;
    expect(top?.procedure.crumbs.at(-1)).toBe('Create dependent service filter');
    expect(top?.procedure.steps).toHaveLength(16);
    expect(top?.score).toBeGreaterThan(STRONG_SCORE);
  });

  it('flags the ratio and success metric steps of the SLO procedure', () => {
    const [top] = find('SLO success metric ratio').hits;
    expect(top?.procedure.id).toBe('create-availability-slo-create-availability-slo#0');
    const flagged = top!.procedure.steps.filter((s) => top!.matchedSteps.includes(s.n)).map((s) => s.text);
    expect(flagged).toEqual(
      expect.arrayContaining([expect.stringMatching(/Ratio/), expect.stringMatching(/Success metric/)])
    );
  });

  it('matches on selector words', () => {
    const { hits } = find('data source picker');
    expect(hits.length).toBeGreaterThan(0);
  });

  it('ranks a procedure higher when the caller is already on its start page', () => {
    const dependent = (pageUrl?: string) =>
      find('dependent service filter', { pageUrl }).hits.find(
        (h) => h.procedure.crumbs.at(-1) === 'Create dependent service filter'
      )!;
    expect(dependent().procedure.startsOn).toBe('/dashboard/new');
    expect(dependent('/dashboard/new').score).toBeGreaterThan(dependent().score);
  });

  it('does not flag steps whose only match is in their selector', () => {
    const [top] = find('dashboard settings').hits;
    const flagged = top!.procedure.steps.filter((s) => top!.matchedSteps.includes(s.n));
    expect(flagged.length).toBeGreaterThan(0);
    for (const step of flagged) {
      expect(`${step.text} ${step.value ?? ''}`.toLowerCase()).toMatch(/dashboard|setting/);
    }
    const environment = searchSteps(index, { queries: ['dashboard'], limit: 10 })[0]!.hits.find(
      (h) => h.procedure.id === 'grafana-quickpizza-working-filters#1'
    );
    const selectorOnly = environment?.procedure.steps.filter(
      (s) => /Dashboard/.test(s.selector ?? '') && !/dashboard/i.test(s.text)
    );
    expect(selectorOnly?.length).toBeGreaterThan(0);
    for (const step of selectorOnly ?? []) {
      expect(environment?.matchedSteps).not.toContain(step.n);
    }
  });

  it('searches each query on its own and honours excludeIds', () => {
    const [first, second] = searchSteps(index, { queries: ['dependent service filter', 'traffic panel'], limit: 10 });
    const alone = (query: string) => searchSteps(index, { queries: [query], limit: 10 })[0]!;
    expect(first!.hits.map((h) => h.procedure.id)).toEqual(
      alone('dependent service filter').hits.map((h) => h.procedure.id)
    );
    expect(second!.hits.map((h) => h.procedure.id)).toEqual(alone('traffic panel').hits.map((h) => h.procedure.id));
    const ids = first!.hits.map((h) => h.procedure.id);
    const without = searchSteps(index, { queries: ['dependent service filter'], excludeIds: [ids[0]!], limit: 10 });
    expect(without[0]!.hits.map((h) => h.procedure.id)).not.toContain(ids[0]);
  });

  it('finds nothing for unrelated words and scores weak matches below the strong threshold', () => {
    expect(find('zzzzzz').hits).toEqual([]);
    expect(find('kubernetes cluster monitoring').hits[0]?.score ?? 0).toBeLessThan(STRONG_SCORE);
  });

  it('flags a group weak when a query word is in no procedure, yet still returns results', () => {
    const group = find('configure dependent zzzquux filter');
    expect(group.noStrongMatch).toBe(true);
    expect(group.hits.length).toBeGreaterThan(0);
    expect(find('dependent service filter').noStrongMatch).toBe(false);
  });
});

const procedure = (id: string, title: string, steps: string[]): Procedure => ({
  id,
  guideId: id,
  guideTitle: title,
  pathTitles: [],
  crumbs: [title],
  leadIn: '',
  outro: '',
  navigation: 0,
  labels: [],
  steps: steps.map((text, i) => ({ n: i + 1, action: 'button', selector: 'button', text })),
});

const corpus = [
  procedure('elastic#0', 'Query logs in Explore', ['Select Elasticsearch', 'Run the query']),
  procedure('broad#0', 'Accomplish a goal', [
    'Open the picker',
    'Select Loki',
    'Open Loki labels',
    'Run the Loki query',
  ]),
  ...Array.from({ length: 12 }, (_, i) => procedure(`filler#${i}`, `Logs query explore ${i}`, ['Click', 'Save'])),
];
const synthetic = buildStepIndex(corpus);
const ids = (query: string) =>
  searchSteps(synthetic, { queries: [query], limit: 5 })[0]!.hits.map((h) => h.procedure.id);

describe('distinctive-term gate', () => {
  it('ranks the procedure holding the rare term in a step above wrong-product title matches', () => {
    expect(ids('query loki logs explore')[0]).toBe('broad#0');
  });

  it('skips the gate when every query term is common', () => {
    const only = (query: string) => searchSteps(synthetic, { queries: [query], limit: 20 })[0]!;
    const score = (query: string) => only(query).hits.find((h) => h.procedure.id === 'elastic#0')!.score;
    expect(score('logs query')).toBeGreaterThan(score('query'));
    expect(score('logs query')).toBeGreaterThan(0);
  });

  it('boosts procedures with more steps about the anchor', () => {
    const dense = buildStepIndex([
      procedure('a-sparse#0', 'Tempo traces', ['Open tempo', 'Click', 'Save']),
      procedure('b-dense#0', 'Tempo traces', ['Open tempo', 'Tempo search', 'Tempo filter', 'Tempo save']),
      ...Array.from({ length: 12 }, (_, i) => procedure(`filler#${i}`, `Traces ${i}`, ['Click'])),
    ]);
    const [group] = searchSteps(dense, { queries: ['tempo traces'], limit: 2 });
    expect(group!.hits.map((h) => h.procedure.id)).toEqual(['b-dense#0', 'a-sparse#0']);
  });

  it('flags a group weak when the anchor matches nothing or only a penalized hit', () => {
    expect(searchSteps(synthetic, { queries: ['zzzzzz'], limit: 2 })[0]!.noStrongMatch).toBe(true);
    const wrong = buildStepIndex([
      procedure('only#0', 'Query logs explore', ['Query logs explore']),
      procedure('rare#0', 'Other', ['Loki']),
      ...Array.from({ length: 12 }, (_, i) => procedure(`filler#${i}`, `Logs query explore ${i}`, ['Click'])),
    ]);
    const [group] = searchSteps(wrong, { queries: ['loki logs query explore'], excludeIds: ['rare#0'], limit: 2 });
    expect(group!.noStrongMatch).toBe(true);
  });
});

describe('selectorWords', () => {
  it('splits Grafana selector tokens and attribute values', () => {
    expect(selectorWords('{grafana:components.DataSourcePicker.inputV2}')).toBe('components data source picker input');
    expect(selectorWords('button[data-testid="run-queries-btn"][aria-label="Run it"]:text("Save")')).toBe(
      'run queries btn run save'
    );
  });
});

describe('document frequency', () => {
  const stemmed = buildStepIndex([
    procedure('mappings#0', 'Configure value mappings', ['Open the panel', 'Add a mapping']),
    procedure('settings#0', 'Configure the data source', ['Open data source settings', 'Save']),
    ...Array.from({ length: 12 }, (_, i) => procedure(`filler#${i}`, `Unrelated topic ${i}`, ['Click', 'Save'])),
  ]);
  const top = (query: string) => searchSteps(stemmed, { queries: [query], limit: 3 })[0]!;

  it.each([
    ['value mappings', 'mappings#0'],
    ['data source settings', 'settings#0'],
  ])('ranks %s first without flagging a stemmed word as absent', (query, id) => {
    const group = top(query);
    expect(group.hits[0]?.procedure.id).toBe(id);
    expect(group.absentWords).toEqual([]);
    expect(group.noStrongMatch).toBe(false);
  });
});
