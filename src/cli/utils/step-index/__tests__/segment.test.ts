import type { JsonBlock } from '../../../../types/json-guide.types';
import { segmentGuide } from '../segment';
import { loadFixture } from '../../../../test-utils/step-index-fixtures';

const click = (target: string, page?: string): JsonBlock => ({
  type: 'interactive',
  action: 'highlight',
  reftarget: target,
  content: `Click **${target}**.`,
  ...(page ? { requirements: [`on-page:${page}`] } : {}),
});

describe('segmentGuide', () => {
  const quickpizza = segmentGuide(loadFixture('grafana-quickpizza-working-filters'));
  const byCrumb = (name: string) => quickpizza.find((p) => p.crumbs.at(-1) === name)!;

  it('yields one procedure per quickpizza section, in order', () => {
    expect(quickpizza.map((p) => p.crumbs.at(-1))).toEqual([
      'Install QuickPizza',
      'Create environment filter',
      'Create dependent service filter',
      'Build the traffic panel',
      'Inspect and repair a broken filter',
      'Verify single, multiple, and All',
      'Save and reopen',
    ]);
    expect(quickpizza.map((p) => p.id)).toEqual(quickpizza.map((_, i) => `grafana-quickpizza-working-filters#${i}`));
  });

  it('expands multistep blocks and shares markdown between neighbouring procedures', () => {
    const dependent = byCrumb('Create dependent service filter');
    expect(dependent.steps).toHaveLength(16);
    expect(dependent.leadIn).toBe(
      'Create a service filter that queries only the services in the selected environment.'
    );
    expect(dependent.outro).toMatch(/^The service query references the environment variable/);
    expect(dependent.steps.at(-1)?.group).toMatch(/^Enable Multi-value/);
    expect(dependent.prevId).toBe('grafana-quickpizza-working-filters#1');
    expect(dependent.nextId).toBe('grafana-quickpizza-working-filters#3');
  });

  it('measures navigation and pages for the environment filter', () => {
    const environment = segmentGuide(loadFixture('grafana-quickpizza-working-filters')).find(
      (p) => p.crumbs.at(-1) === 'Create environment filter'
    )!;
    expect(environment.navigation).toBe(1);
    expect(environment.startsOn).toBe('/dashboard/new');
    expect(environment.endsOn).toBe('/dashboard/new');
    expect(byCrumb('Create dependent service filter').startsOn).toBe('/dashboard/new');
  });

  it('measures navigation and pages for the SLO wizard', () => {
    const [slo] = segmentGuide(loadFixture('create-availability-slo-create-availability-slo'));
    expect(slo?.navigation).toBe(2);
    expect(slo?.startsOn).toBe('/a/grafana-slo-app/home/insights');
    expect(slo?.endsOn).toBe('/a/grafana-slo-app/wizard/new');
  });

  it('yields no procedures for a markdown-only guide', () => {
    expect(segmentGuide(loadFixture('adaptive-metrics-value'))).toEqual([]);
  });

  it('splits a 30-step run at its page change', () => {
    const blocks = Array.from({ length: 30 }, (_, i) => click(`#b${i}`, i < 12 ? '/one' : '/two'));
    const parts = segmentGuide({ id: 'long', title: 'Long guide', pathTitles: [], blocks });
    expect(parts.map((p) => p.steps.length)).toEqual([12, 18]);
    expect(parts.map((p) => p.crumbs.at(-1))).toEqual(['Long guide (part 1 of 2)', 'Long guide (part 2 of 2)']);
    expect(parts[1]?.steps[0]?.n).toBe(1);
  });

  it('splits a long run without pages every 25 steps', () => {
    const blocks = Array.from({ length: 30 }, (_, i) => click(`#b${i}`));
    const parts = segmentGuide({ id: 'long', title: 'Long guide', pathTitles: [], blocks });
    expect(parts.map((p) => p.steps.length)).toEqual([25, 5]);
  });

  it('closes a run at a markdown heading and keeps prose between steps', () => {
    const blocks: JsonBlock[] = [
      { type: 'markdown', content: '## Make it\n\nIntro text.' },
      click('#a'),
      { type: 'markdown', content: 'Check the result.' },
      click('#b'),
      { type: 'markdown', content: '## Next\n\nSecond intro.' },
      click('#c'),
    ];
    const [first, second] = segmentGuide({ id: 'g', title: 'G', pathTitles: ['Path'], blocks });
    expect(first?.crumbs).toEqual(['G', 'Make it']);
    expect(first?.leadIn).toBe('Intro text.');
    expect(first?.steps[0]?.text).toBe('Click #a. Check the result.');
    expect(first?.outro).toBe('Second intro.');
    expect(second?.leadIn).toBe('Second intro.');
    expect(second?.pathTitles).toEqual(['Path']);
  });

  it('falls back to the group text, then a button label, when a step has no prose', () => {
    const blocks: JsonBlock[] = [
      {
        type: 'multistep',
        content: 'Add a **panel**.',
        steps: [
          { action: 'highlight', reftarget: '#one' },
          { action: 'button', reftarget: 'New', tooltip: '  ' },
        ],
      },
      { type: 'interactive', action: 'button', reftarget: 'Save', content: '' },
    ];
    const [procedure] = segmentGuide({ id: 'g', title: 'G', pathTitles: [], blocks });
    expect(procedure?.steps.map((s) => s.text)).toEqual(['Add a panel.', 'Click New', 'Click Save']);
  });

  it('drops runs without a selector or navigation', () => {
    const blocks: JsonBlock[] = [{ type: 'interactive', action: 'noop', content: 'Read this.' }];
    expect(segmentGuide({ id: 'g', title: 'G', pathTitles: [], blocks })).toEqual([]);
  });
});

describe('segmentGuide block coverage', () => {
  const segment = (blocks: JsonBlock[]) => segmentGuide({ id: 'g', title: 'G', pathTitles: [], blocks });

  it('indexes only the whenTrue branch of a conditional, keeping its conditions', () => {
    const [procedure] = segment([
      {
        type: 'conditional',
        conditions: ['has-datasource:loki'],
        whenTrue: [click('[data-testid="taken"]')],
        whenFalse: [click('[data-testid="untaken"]')],
      } as JsonBlock,
    ]);
    expect(procedure!.steps.map((step) => step.selector)).toEqual(['[data-testid="taken"]']);
    expect(procedure!.steps[0]!.requirements).toEqual(['has-datasource:loki']);
  });

  it('inherits section requirements on every step beneath it, whatever the block type', () => {
    const environment = segmentGuide(loadFixture('grafana-quickpizza-working-filters')).find(
      (p) => p.crumbs.at(-1) === 'Create environment filter'
    )!;
    expect(environment.steps.length).toBeGreaterThan(0);
    for (const step of environment.steps) {
      expect(step.requirements).toEqual(expect.arrayContaining(['has-datasource:grafanacloud-play-prom']));
    }
    const [procedure] = segment([
      {
        type: 'section',
        title: 'S',
        requirements: ['has-datasource:loki'],
        blocks: [
          {
            type: 'multistep',
            content: 'Run these.',
            requirements: ['is-admin'],
            steps: [{ action: 'button', reftarget: 'Go', requirements: ['on-page:/explore'] }],
          },
        ],
      } as JsonBlock,
    ]);
    expect(procedure!.steps[0]!.requirements).toEqual(['has-datasource:loki', 'is-admin', 'on-page:/explore']);
  });

  it('records a navigate step under an inherited on-page requirement as its destination', () => {
    const [procedure] = segment([
      {
        type: 'section',
        title: 'Create a silence',
        requirements: ['on-page:/alerting/silences'],
        blocks: [
          click('[data-testid="silences-filter"]'),
          { type: 'interactive', action: 'navigate', reftarget: '/alerting/silence/new', content: 'Open the form.' },
        ],
      } as JsonBlock,
    ]);
    expect(procedure!.steps.map((step) => step.page)).toEqual(['/alerting/silences', '/alerting/silence/new']);
    expect(procedure!.endsOn).toBe('/alerting/silence/new');
  });

  it('turns a code-block into a step on its reftarget without indexing the code', () => {
    const [procedure] = segment([
      {
        type: 'code-block',
        reftarget: '.monaco-editor',
        code: 'sum(rate(secret_metric[5m]))',
        content: 'Enter the query.',
        requirements: ['exists-reftarget'],
      } as JsonBlock,
      { type: 'code-block', reftarget: '.other-editor', code: 'up' } as JsonBlock,
    ]);
    expect(procedure!.steps).toEqual([
      expect.objectContaining({
        action: 'code-block',
        selector: '.monaco-editor',
        text: 'Enter the query.',
        requirements: ['exists-reftarget'],
      }),
      expect.objectContaining({ action: 'code-block', selector: '.other-editor', text: 'Enter code in the editor' }),
    ]);
    expect(JSON.stringify(procedure)).not.toContain('secret_metric');
  });
});
