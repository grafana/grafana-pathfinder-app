/**
 * @jest-environment node
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { COMMANDER_COMMANDS } from '../cli-commands';
import { buildContext, buildOutline, FindStepsCommand, runFindSteps } from '../commands/find-steps';
import { mockStepIndexFetch } from '../../test-utils/step-index-fixtures';
import { __resetRepositoryClientForTests } from '../utils/repository-client';
import { __resetStepIndexForTests, getStepIndex, type StepIndexSnapshot } from '../utils/step-index/cache';
import type { Procedure } from '../utils/step-index/segment';

let cacheRoot: string;

beforeEach(() => {
  cacheRoot = mkdtempSync(join(tmpdir(), 'find-steps-'));
  process.env.XDG_CACHE_HOME = cacheRoot;
  __resetRepositoryClientForTests();
  __resetStepIndexForTests();
  global.fetch = mockStepIndexFetch() as unknown as typeof fetch;
});

afterEach(() => {
  delete process.env.XDG_CACHE_HOME;
  rmSync(cacheRoot, { recursive: true, force: true });
});

const run = (args: Record<string, unknown>) => runFindSteps(FindStepsCommand.parse(args));

describe('find-steps command', () => {
  it('is registered on the command line', () => {
    expect(COMMANDER_COMMANDS.has('find-steps')).toBe(true);
  });

  it('requires exactly one of queries or procedureId and bounds the rest', () => {
    expect(FindStepsCommand.safeParse({}).success).toBe(false);
    expect(FindStepsCommand.safeParse({ queries: ['a'], procedureId: 'x#0' }).success).toBe(false);
    expect(FindStepsCommand.safeParse({ queries: [] }).success).toBe(false);
    expect(FindStepsCommand.safeParse({ queries: Array(8).fill('a') }).success).toBe(true);
    expect(FindStepsCommand.safeParse({ queries: Array(9).fill('a') }).success).toBe(false);
    expect(FindStepsCommand.safeParse({ queries: ['a'], limit: 6 }).success).toBe(false);
    expect(FindStepsCommand.safeParse({ queries: ['a'] }).data?.limit).toBe(2);
  });

  it('returns the procedure with its steps, neighbours and build stats', async () => {
    const outcome = await run({ queries: ['dependent service filter classic'], limit: 1 });
    expect(outcome.status).toBe('ok');
    const data = (outcome as { data: any }).data;
    expect(data.groups).toHaveLength(1);
    expect(data.groups[0].query).toBe('dependent service filter classic');
    expect(data.groups[0].noStrongMatch).toBe(false);
    expect(data.stats).toEqual(expect.objectContaining({ eligibleGuides: 3, healthRevision: 1 }));
    const results = data.groups[0].results;
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual(
      expect.objectContaining({
        procedureId: 'grafana-quickpizza-working-filters#2',
        navigation: 0,
      })
    );
    expect(results[0].context.previousProcedure.procedureId).toBe('grafana-quickpizza-working-filters#1');
    expect(results[0].context.nextProcedure.procedureId).toBe('grafana-quickpizza-working-filters#3');
    expect(results[0].stepCount).toBe(16);
    expect(results[0].steps.length).toBeLessThan(16);
  });

  it('returns full steps for the first result of a group only, with no launchPath, score or guideId', async () => {
    const outcome = await run({ queries: ['dashboard'], limit: 3 });
    const results = (outcome as any).data.groups[0].results;
    expect(results.length).toBeGreaterThan(1);
    expect(results[0].steps.length).toBeGreaterThan(0);
    for (const later of results.slice(1)) {
      expect(Object.keys(later).sort()).toEqual(
        ['crumbs', 'endsOn', 'matchedSteps', 'procedureId', 'startsOn', 'stepCount'].filter((k) => k in later)
      );
      expect(later.stepCount).toBeGreaterThan(0);
    }
    const text = JSON.stringify(outcome.status === 'ok' ? outcome.data : {});
    for (const key of ['"launchPath"', '"score"', '"guideId"']) {
      expect(text).not.toContain(key);
    }
  });

  it('emits a step group once per run and never when it equals the step text', async () => {
    const outcome = await run({ procedureId: 'grafana-quickpizza-working-filters#2' });
    const steps = (outcome as any).data.results[0].steps as Array<{ text: string; group?: string }>;
    const grouped = steps.filter((s) => s.group);
    expect(grouped.length).toBeGreaterThan(0);
    for (const step of grouped) {
      expect(step.group).not.toBe(step.text);
    }
    const run1 = steps.findIndex((s) => s.group === grouped[0]!.group);
    expect(steps.slice(run1 + 1).filter((s) => s.group === grouped[0]!.group)).toEqual([]);
  });

  it('returns a separate group per query, in request order, with a per-query limit', async () => {
    const outcome = await run({ queries: ['dependent service filter', 'traffic panel'] });
    const groups = (outcome as any).data.groups;
    expect(groups.map((g: any) => g.query)).toEqual(['dependent service filter', 'traffic panel']);
    for (const group of groups) {
      expect(group.results.length).toBeLessThanOrEqual(2);
      expect(group.results[0].steps.length).toBeGreaterThan(0);
    }
    expect((outcome as any).summary).toMatch(/^Found \d+ procedures for 2 queries/);
  });

  it('renders a procedure already shown in full as a summary pointing at that group', async () => {
    const outcome = await run({ queries: ['dependent service filter', 'dependent service filter'] });
    const [first, second] = (outcome as any).data.groups;
    expect(first.results[0].steps.length).toBeGreaterThan(0);
    expect(second.results[0].procedureId).toBe(first.results[0].procedureId);
    expect(second.results[0]).toEqual(expect.objectContaining({ fullIn: 0, stepCount: expect.any(Number) }));
    expect(second.results[0].steps).toBeUndefined();
  });

  it('headers each group in the text output', async () => {
    const outcome = await run({ queries: ['dependent service filter classic', 'kubernetes cluster monitoring'] });
    const text = (outcome as any).text as string;
    expect(text).toMatch(/"dependent service filter classic"\n1\./);
    expect(text).toContain('"kubernetes cluster monitoring" (no strong match)');
  });

  it('looks a procedure up by id and reports unknown ids', async () => {
    const found = await run({ procedureId: 'create-availability-slo-create-availability-slo#0' });
    expect(found.status === 'ok' && (found.data as any).results[0].navigation).toBe(2);
    expect((found as any).data.results[0].steps.length).toBeGreaterThan(0);
    const missing = await run({ procedureId: 'nope#9' });
    expect(missing).toEqual(expect.objectContaining({ status: 'error', code: 'NOT_FOUND' }));
  });

  it('skips excluded procedure ids', async () => {
    const outcome = await run({
      queries: ['dependent service filter'],
      excludeIds: ['grafana-quickpizza-working-filters#2'],
    });
    const ids = (outcome as any).data.groups[0].results.map((r: any) => r.procedureId);
    expect(ids).not.toContain('grafana-quickpizza-working-filters#2');
  });

  it('flags weak matches and surfaces an unavailable index as an error', async () => {
    const weak = await run({ queries: ['kubernetes cluster monitoring'] });
    expect((weak as any).data.groups[0].noStrongMatch).toBe(true);
    expect((weak as any).summary).toContain('(1 weak)');

    __resetStepIndexForTests();
    __resetRepositoryClientForTests();
    global.fetch = mockStepIndexFetch({ healthStatus: 503 }) as unknown as typeof fetch;
    expect(await run({ queries: ['dashboard'] })).toEqual(
      expect.objectContaining({ status: 'error', code: 'HTTP_ERROR' })
    );
  });
});

describe('next-action hints', () => {
  it('carries no next-action instruction in search results', async () => {
    const found = (await run({ queries: ['dependent service filter'] })) as any;
    expect(found.data.next).toBeUndefined();
    expect(found.text).not.toMatch(/Continues in|Follow context/);
    const all = [...((await getStepIndex()) as any).snapshot.procedures.keys()];
    const none = (await run({ queries: ['dependent service filter'], excludeIds: all })) as any;
    expect(none.data.next).toBeUndefined();
    expect(none.text).toBeUndefined();
  });

  it('hints only weak groups, leaving the continuation to context.nextProcedure', async () => {
    const outcome = (await run({
      queries: ['dependent service filter classic', 'kubernetes cluster monitoring'],
    })) as any;
    const [continuing, weak] = outcome.data.groups;
    expect(continuing.results[0].context.nextProcedure).toBeDefined();
    expect(continuing.hint).toBeUndefined();
    expect(weak.hint).toContain('No verified steps mention "kubernetes", "cluster".');
  });

  it('gives a common-words hint when no query term is distinctive', async () => {
    const outcome = (await run({ queries: ['dependent service filter'] })) as any;
    const [group] = outcome.data.groups;
    expect(group.noStrongMatch).toBe(true);
    expect(group.hint).toMatch(/^Every word here is common to many procedures\. These results show shared steps/);
  });

  it('rewords a weak group around the words found in no procedure, in their original order and casing', async () => {
    const outcome = (await run({ queries: ['Dependent slack service filter', 'slack'] })) as any;
    const [mixed, onlyAbsent] = outcome.data.groups;
    expect(mixed.hint).toBe(
      'No verified steps mention "slack". Search the Grafana process in generic terms: { "opts": { "queries": ["Dependent service filter"] } }. Use placeholders only for the product-specific fields.'
    );
    expect(onlyAbsent.hint).toMatch(/^No strong match\. Reword once/);
  });

  it('does not suggest stopwords or empty words when rewording', async () => {
    const outcome = (await run({ queries: ['the slack', ' slack', 'the  slack service filter', 'a slack'] })) as any;
    const [stopOnly, leadingSpace, mixed, article] = outcome.data.groups;
    expect(stopOnly.hint).toMatch(/^No strong match\. Reword once/);
    expect(leadingSpace.hint).toMatch(/^No strong match\. Reword once/);
    expect(article.hint).toMatch(/^No strong match\. Reword once/);
    expect(mixed.hint).toContain('"queries": ["service filter"]');
    for (const group of outcome.data.groups) {
      expect(group.hint).not.toContain('"the"');
      expect(group.hint).not.toContain('[""');
    }
  });

  it('gives no group hint when the next neighbour is unverified', async () => {
    const outcome = (await run({ queries: ['save and reopen'], limit: 1 })) as any;
    const group = outcome.data.groups[0];
    expect(group.noStrongMatch).toBe(false);
    expect(group.results[0].context.nextProcedure).toEqual({ guide: 'unhealthy-guide', unverified: true });
    expect(group.hint).toBeUndefined();
  });

  it('hints the next part on a procedureId fetch and not at the end of the path', async () => {
    const fetched = (await run({ procedureId: 'grafana-quickpizza-working-filters#2' })) as any;
    expect(fetched.data.hint).toMatch(
      /^Adjacent parts: \{ "opts": \{ "procedureId": \["grafana-quickpizza-working-filters#3"/
    );
    expect(fetched.text).toContain(fetched.data.hint);
    const { snapshot } = (await import('../utils/step-index/cache').then((m) => m.getStepIndex())) as any;
    const procedures = [...(snapshot as StepIndexSnapshot).procedures.values()].filter(
      (p) => p.guideId === 'grafana-quickpizza-working-filters'
    );
    const tail = (await run({ procedureId: procedures.at(-1)!.id })) as any;
    expect(tail.data.hint ?? '').not.toContain('grafana-quickpizza-working-filters#');
  });
});

describe('find-steps adjacent parts across paths', () => {
  it('lists the next parts of every outlined path in a multi-path fetch', async () => {
    global.fetch = mockStepIndexFetch({
      extraCatalog: {
        'quickpizza-path': {
          path: 'quickpizza-path/',
          title: 'QuickPizza path',
          type: 'path',
          milestones: ['grafana-quickpizza-working-filters'],
        },
      },
    }) as unknown as typeof fetch;
    const both = (await run({
      procedureId: ['create-availability-slo-create-availability-slo#0', 'grafana-quickpizza-working-filters#2'],
    })) as any;
    const ids = JSON.parse(/"procedureId": (\[.*?\])/.exec(both.data.hint)![1]!) as string[];
    expect(ids).toEqual(
      expect.arrayContaining([
        'create-availability-slo-create-availability-slo#1',
        'grafana-quickpizza-working-filters#3',
      ])
    );
    expect(ids).not.toContain('grafana-quickpizza-working-filters#2');
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeLessThanOrEqual(8);
  });
});

describe('step windows', () => {
  it('gives search results a context window with neighbours and no outline', async () => {
    const outcome = await run({ queries: ['dependent service filter'], limit: 1 });
    const result = (outcome as any).data.groups[0].results[0];
    expect(result.outline).toBeUndefined();
    expect(result.context).toEqual({
      path: 'Dashboards learning path',
      position: 3,
      total: expect.any(Number),
      previousProcedure: expect.objectContaining({
        procedureId: expect.stringMatching(/^grafana-quickpizza-working-filters#/),
        title: expect.any(String),
      }),
      nextProcedure: expect.objectContaining({
        procedureId: expect.stringMatching(/^grafana-quickpizza-working-filters#/),
        title: expect.any(String),
      }),
    });
    expect((outcome as any).text).toMatch(
      /   part \d+ of \d+ in "Dashboards learning path"\n   previous: .+ \(.+#\d+\)\n   next: /
    );
  });

  it('names an unverified neighbour', async () => {
    const { snapshot } = (await import('../utils/step-index/cache').then((m) => m.getStepIndex())) as any;
    const procedures = [...(snapshot as StepIndexSnapshot).procedures.values()];
    const beforeUnverified = procedures.filter((p) => p.guideId === 'grafana-quickpizza-working-filters').at(-1)!;
    expect(buildContext(snapshot, beforeUnverified)?.nextProcedure).toEqual({
      guide: 'unhealthy-guide',
      unverified: true,
    });
  });

  it('keeps the full outline and every step on a procedureId fetch', async () => {
    const outcome = await run({ procedureId: 'grafana-quickpizza-working-filters#2' });
    const result = (outcome as any).data.results[0];
    expect(result.outline.parts.length).toBeGreaterThan(1);
    expect(result.context).toBeUndefined();
    expect(result.steps).toHaveLength(16);
    expect(result.omitted).toBeUndefined();
  });

  it('windows a long procedure around the matches, keeping navigation and original step numbers', async () => {
    const outcome = await run({ queries: ['dependent service filter'], limit: 1 });
    const result = (outcome as any).data.groups[0].results[0];
    const shown = result.steps.map((s: any) => s.n) as number[];
    expect(result.stepCount).toBe(16);
    expect(result.omitted.length).toBeGreaterThan(0);
    const all = Array.from({ length: 16 }, (_, i) => i + 1);
    const hidden = result.omitted.flatMap(([from, to]: [number, number]) =>
      Array.from({ length: to - from + 1 }, (_, i) => from + i)
    );
    expect([...shown, ...hidden].sort((a, b) => a - b)).toEqual(all);
    for (const matched of result.matchedSteps) {
      expect(shown).toContain(matched);
    }
    const [from, to] = result.omitted[0];
    expect((outcome as any).text).toContain(`   ... steps ${from}-${to} omitted (fetch procedureId for all)`);
  });

  it('leaves a short procedure whole', async () => {
    const outcome = await run({ queries: ['create availability slo'], limit: 1 });
    const result = (outcome as any).data.groups[0].results[0];
    expect(result.steps.length).toBeLessThanOrEqual(15);
    expect(result.omitted).toBeUndefined();
    expect(result.stepCount).toBeUndefined();
  });
});

describe('journey outline', () => {
  it('lists the parts of the catalog path in order, marking the current and the unverified milestone', async () => {
    const outcome = await run({ procedureId: 'grafana-quickpizza-working-filters#1' });
    const { outline } = (outcome as any).data.results[0];
    const parts = outline.parts as any[];
    expect(outline.title).toBe('Dashboards learning path');
    expect(parts.filter((p) => p.current)).toEqual([
      expect.objectContaining({ procedureId: 'grafana-quickpizza-working-filters#1' }),
    ]);
    expect(parts.findIndex((p) => p.current) + 1).toBe(outline.position);
    const unverified = parts.findIndex((p) => p.unverified);
    expect(parts[unverified]).toEqual({ guide: 'unhealthy-guide', unverified: true });
    expect(parts[unverified - 1].procedureId).toMatch(/^grafana-quickpizza-working-filters#/);
    expect(parts[unverified + 1].procedureId).toMatch(/^create-availability-slo-create-availability-slo#/);
    expect((outcome as any).text).toMatch(
      /part 2 of \d+ in "Dashboards learning path":\n.*\n   > grafana-quickpizza-working-filters#1:/
    );
    expect((outcome as any).text).toContain('   ? unhealthy-guide (unverified)');
  });

  it('outlines a guide outside any path from its own procedures, and omits it for a single procedure', async () => {
    const snapshot = (await import('../utils/step-index/cache').then((m) => m.getStepIndex())) as unknown as {
      snapshot: StepIndexSnapshot;
    };
    const lone = (id: string) => snapshot.snapshot.procedures.get(id)!;
    const withoutPaths = { ...snapshot.snapshot, paths: [] };
    const multi = buildOutline(withoutPaths, lone('grafana-quickpizza-working-filters#1'));
    expect(multi?.title).toBe(lone('grafana-quickpizza-working-filters#1').guideTitle);
    expect(multi?.parts.length).toBeGreaterThan(1);
    expect(multi?.parts.every((p) => 'procedureId' in p)).toBe(true);

    const only = { id: 'solo#0', guideId: 'solo', guideTitle: 'Solo', crumbs: ['Solo'] } as Procedure;
    const single = { procedures: new Map([[only.id, only]]), paths: [] } as unknown as StepIndexSnapshot;
    expect(buildOutline(single, only)).toBeUndefined();
  });

  it('caps the outline at 30 parts centred on the current one and reports how many are left out', () => {
    const procedures = Array.from({ length: 50 }, (_, i) => ({
      id: `g#${i}`,
      guideId: 'g',
      guideTitle: 'Big guide',
      crumbs: [`Part ${i}`],
    })) as Procedure[];
    const snapshot = {
      procedures: new Map(procedures.map((p) => [p.id, p])),
      paths: [],
    } as unknown as StepIndexSnapshot;
    const outline = buildOutline(snapshot, procedures[25]!)!;
    expect(outline.total).toBe(50);
    expect(outline.parts).toHaveLength(31);
    expect(outline.parts.at(-1)).toEqual({ more: 20 });
    expect(outline.parts.some((p) => 'current' in p)).toBe(true);
    expect(buildOutline(snapshot, procedures[0]!)!.parts[0]).toEqual(expect.objectContaining({ procedureId: 'g#0' }));
    expect(buildOutline(snapshot, procedures[49]!)!.parts.at(-2)).toEqual(
      expect.objectContaining({ procedureId: 'g#49' })
    );
  });
});

describe('step pages', () => {
  it('returns no margin steps in search results', async () => {
    const outcome = await run({ queries: ['dependent service filter'], limit: 1 });
    const result = (outcome as any).data.groups[0].results[0];
    expect(result).not.toHaveProperty('marginBefore');
    expect(result).not.toHaveProperty('marginAfter');
    expect((outcome as any).text).not.toMatch(/ before \(/);
  });

  it('repeats a step page only where it changes within a result', async () => {
    const outcome = await run({ procedureId: 'grafana-quickpizza-working-filters#2' });
    const steps = (outcome as any).data.results[0].steps as Array<{ page?: string }>;
    expect(steps[0]!.page).toBeDefined();
    expect(steps.slice(1).filter((s) => s.page !== undefined).length).toBeLessThan(steps.length - 1);
  });

  it('rejects the removed expand spellings and requires exactly one of queries or procedureId', () => {
    expect(FindStepsCommand.safeParse({ queries: ['a'] }).success).toBe(true);
    expect(FindStepsCommand.safeParse({ procedureId: 'a#0' }).success).toBe(true);
    expect(FindStepsCommand.safeParse({ queries: ['a'], procedureId: 'a#0' }).success).toBe(false);
    expect(FindStepsCommand.safeParse({ expand: { procedureId: 'a#0' } }).success).toBe(false);
  });
});

describe('lean search results', () => {
  const search = async (query: string, limit = 3) =>
    (await run({ queries: [query], limit })) as unknown as { data: { groups: Array<{ results: any[] }> } };

  it('drops the fields the agent does not act on from full results and summaries', async () => {
    const [first, ...later] = (await search('dashboard')).data.groups[0]!.results;
    for (const key of ['guideTitle', 'leadIn', 'outro', 'startsOn', 'prevId', 'nextId']) {
      expect(first).not.toHaveProperty(key);
      for (const summary of later) {
        expect(summary).not.toHaveProperty(key);
      }
    }
    expect(Object.keys(first).sort()).toEqual(
      expect.arrayContaining(['procedureId', 'crumbs', 'endsOn', 'navigation', 'steps'])
    );
    for (const summary of later) {
      expect(summary).toEqual(
        expect.objectContaining({ matchedSteps: expect.any(Array), stepCount: expect.any(Number) })
      );
    }
  });

  it('keeps only requirements beyond on-page of the step page and exists-reftarget', async () => {
    const { snapshot } = (await getStepIndex()) as unknown as { snapshot: StepIndexSnapshot };
    const target = [...snapshot.procedures.values()].find((p) => p.steps.some((s) => s.requirements?.length))!;
    const fetched = ((await run({ procedureId: target.id })) as any).data.results[0].steps as any[];
    expect(fetched.flatMap((s) => s.requirements ?? []).length).toBeGreaterThan(0);
    const lean = (await search(target.crumbs.join(' '), 1)).data.groups[0]!.results[0].steps as any[];
    for (const step of lean) {
      const original = target.steps.find((candidate) => candidate.n === step.n)!;
      const expected = (original.requirements ?? []).filter(
        (entry) => entry !== 'exists-reftarget' && entry !== `on-page:${original.page}`
      );
      expect(step.requirements).toEqual(expected.length > 0 ? expected : undefined);
    }
  });

  it('shows the first window when a long procedure matches only on its title', async () => {
    const steps = Array.from({ length: 20 }, (_, i) => ({
      type: 'interactive',
      action: 'highlight',
      reftarget: `[data-testid="row-${i + 1}"]`,
      content: `Press item ${i + 1}.`,
    }));
    global.fetch = mockStepIndexFetch({
      content: (id) =>
        id === 'adaptive-metrics-value'
          ? {
              id,
              title: 'Frobnicate widgets',
              blocks: [
                { type: 'markdown', content: '## Frobnicate widgets' },
                { type: 'interactive', action: 'navigate', reftarget: '/page', content: 'Open the page.' },
                ...steps,
              ],
            }
          : undefined,
    }) as unknown as typeof fetch;
    __resetRepositoryClientForTests();
    __resetStepIndexForTests();
    const outcome = (await run({ queries: ['frobnicate widgets'], limit: 1 })) as any;
    const result = outcome.data.groups[0].results[0];
    expect(result.procedureId).toBe('adaptive-metrics-value#0');
    expect(result.matchedSteps).toEqual([]);
    expect(result.navigation).toBe(1);
    expect(result.steps.map((step: any) => step.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(result.omitted).toEqual([[9, 21]]);
    expect(result.stepCount).toBe(21);
  });

  describe('window size', () => {
    const searchProcedure = async (total: number, matched: number) => {
      const steps = Array.from({ length: total - 1 }, (_, i) => ({
        type: 'interactive',
        action: 'highlight',
        reftarget: `[data-testid="row-${i + 2}"]`,
        content: i + 2 === matched ? 'Press the quibblefrop control.' : `Press item ${i + 2}.`,
      }));
      global.fetch = mockStepIndexFetch({
        content: (id) =>
          id === 'adaptive-metrics-value'
            ? {
                id,
                title: 'Gadget tour',
                blocks: [
                  { type: 'markdown', content: '## Gadget tour' },
                  { type: 'interactive', action: 'navigate', reftarget: '/page', content: 'Open the page.' },
                  ...steps,
                ],
              }
            : undefined,
      }) as unknown as typeof fetch;
      rmSync(cacheRoot, { recursive: true, force: true });
      __resetRepositoryClientForTests();
      __resetStepIndexForTests();
      const outcome = (await run({ queries: ['quibblefrop'], limit: 1 })) as any;
      return outcome.data.groups[0].results[0];
    };

    it('shows the navigation steps and three steps either side of the match, with the gaps omitted', async () => {
      const result = await searchProcedure(20, 11);
      expect(result.procedureId).toBe('adaptive-metrics-value#0');
      expect(result.steps.map((step: any) => step.n)).toEqual([1, 8, 9, 10, 11, 12, 13, 14]);
      expect(result.omitted).toEqual([
        [2, 7],
        [15, 20],
      ]);
      expect(result.stepCount).toBe(20);
    });

    it('leaves a 15-step procedure whole and windows a 16-step one', async () => {
      const fifteen = await searchProcedure(15, 8);
      expect(fifteen.steps).toHaveLength(15);
      expect(fifteen.omitted).toBeUndefined();
      const sixteen = await searchProcedure(16, 8);
      expect(sixteen.steps.map((step: any) => step.n)).toEqual([1, 5, 6, 7, 8, 9, 10, 11]);
      expect(sixteen.omitted).toEqual([
        [2, 4],
        [12, 16],
      ]);
    });
  });

  it('sends matchedSteps only when it is not every returned step', async () => {
    const windowed = (await search('dependent service filter', 1)).data.groups[0]!.results[0];
    expect(windowed.omitted).toBeDefined();
    expect(windowed.matchedSteps).toEqual(expect.any(Array));
    const whole = (await run({ queries: ['dashboard'], limit: 1 })) as any;
    const result = whole.data.groups[0].results[0];
    const every = result.steps.every((step: any) => (result.matchedSteps ?? []).includes(step.n));
    expect('matchedSteps' in result).toBe(!every);
  });

  it('leaves fetch results as they were', async () => {
    const fetched = ((await run({ procedureId: 'grafana-quickpizza-working-filters#2' })) as any).data.results[0];
    expect(fetched).toEqual(
      expect.objectContaining({
        guideTitle: expect.any(String),
        leadIn: expect.any(String),
        startsOn: '/dashboard/new',
      })
    );
    expect(fetched.prevId).toBe('grafana-quickpizza-working-filters#1');
    expect(fetched.outline).toBeDefined();
  });
});

describe('multi-part fetch', () => {
  const ids = [
    'grafana-quickpizza-working-filters#3',
    'grafana-quickpizza-working-filters#2',
    'grafana-quickpizza-working-filters#1',
  ];

  it('returns results in request order with the outline once per path', async () => {
    const outcome = (await run({ procedureId: ids })) as any;
    expect(outcome.data.results.map((r: any) => r.procedureId)).toEqual(ids);
    expect(outcome.data.results[0].outline).toBeDefined();
    expect(outcome.data.results[1].outline).toBeUndefined();
    expect(outcome.data.results[2].outline).toBeUndefined();
    expect(outcome.data.results[1].steps.length).toBeGreaterThan(0);
    expect(outcome.data.notFound).toBeUndefined();
  });

  it('reports unknown ids, succeeds while one is found, and errors when none is', async () => {
    const outcome = (await run({ procedureId: ['nope#9', ids[1]!] })) as any;
    expect(outcome.status).toBe('ok');
    expect(outcome.data.notFound).toEqual(['nope#9']);
    expect(outcome.data.results.map((r: any) => r.procedureId)).toEqual([ids[1]]);
    expect(await run({ procedureId: ['nope#9', 'nope#8'] })).toEqual(
      expect.objectContaining({ status: 'error', code: 'NOT_FOUND' })
    );
  });

  it('hints the parts after the fetched ones and omits those already fetched', async () => {
    const one = (await run({ procedureId: ids[2]! })) as any;
    expect(one.data.hint).toContain('"procedureId": ["grafana-quickpizza-working-filters#2"');
    const many = (await run({ procedureId: [ids[2]!, ids[1]!] })) as any;
    const listed = JSON.parse(/"procedureId": (\[.*?\])/.exec(many.data.hint)![1]!) as string[];
    expect(listed[0]).toBe('grafana-quickpizza-working-filters#3');
    expect(listed).not.toContain(ids[1]);
    expect(listed.length).toBeLessThanOrEqual(8);
  });

  it('accepts one to eight ids and a repeated command-line flag', () => {
    expect(FindStepsCommand.safeParse({ procedureId: [] }).success).toBe(false);
    expect(FindStepsCommand.safeParse({ procedureId: Array(9).fill('a#0') }).success).toBe(false);
    expect(FindStepsCommand.safeParse({ procedureId: ['a#0', 'b#0'] }).success).toBe(true);
    const flags = COMMANDER_COMMANDS.get('find-steps')!.options.find((o) => o.long === '--procedure-id')!;
    expect(flags.parseArg!('b', ['a'] as any)).toEqual(['a', 'b']);
  });
});
