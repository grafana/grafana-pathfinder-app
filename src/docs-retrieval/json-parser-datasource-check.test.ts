/**
 * An `input` block emits two element types: the passive `input-block`, or the
 * tracked `datasource-check-step` when its author asked a failing check to block.
 */

import { parseJsonGuide } from './json-parser';
import type { ParsedElement } from '../types/content.types';

jest.mock('@grafana/runtime', () => ({
  config: { bootData: { user: null }, buildInfo: { version: '10.0.0' } },
}));

jest.mock('@grafana/data', () => ({
  renderMarkdown: (md: string) => `<p>${md}</p>`,
}));

const picker = (overrides: Record<string, unknown> = {}) => ({
  type: 'input',
  id: 'metrics-check',
  inputType: 'datasource',
  variableName: 'metricsDatasource',
  prompt: 'Pick the data source holding your metrics.',
  ...overrides,
});

function parseBlocks(blocks: unknown[]): { elements: ParsedElement[]; hasInteractive: boolean } {
  const result = parseJsonGuide(JSON.stringify({ id: 'test', title: 'Test guide', blocks }));
  expect(result.isValid).toBe(true);
  return { elements: result.data!.elements, hasInteractive: result.data!.hasInteractiveElements };
}

const firstOf = (blocks: unknown[]) => parseBlocks(blocks).elements[0]!;

function rejectionFor(blocks: unknown[]): string {
  const result = parseJsonGuide(JSON.stringify({ id: 'test', title: 'Test guide', blocks }));
  expect(result.isValid).toBe(false);
  return result.errors?.map((e) => e.message).join(' | ') ?? '';
}

describe('input block → parsed element type', () => {
  it('stays a passive input-block with no check', () => {
    expect(firstOf([picker()]).type).toBe('input-block');
  });

  it('stays a passive input-block for an advisory check', () => {
    const element = firstOf([picker({ dataCheckQuery: 'up' })]);
    expect(element.type).toBe('input-block');
    expect(element.props.dataCheckQuery).toBe('up');
  });

  it('becomes a tracked datasource-check-step when the author asked it to block', () => {
    const element = firstOf([picker({ dataCheckQuery: 'up', dataCheckBlocking: true })]);
    expect(element.type).toBe('datasource-check-step');
    expect(element.props.query).toBe('up');
  });

  it('rejects blocking without a query rather than building a step that can never pass', () => {
    expect(rejectionFor([picker({ dataCheckBlocking: true })])).toContain(
      '`dataCheckBlocking` has no effect without `dataCheckQuery`'
    );
  });

  it('rejects a check on a text input, which has no data source to query', () => {
    expect(
      rejectionFor([
        { type: 'input', inputType: 'text', variableName: 'teamName', prompt: 'Team?', dataCheckQuery: 'up' },
      ])
    ).toContain('only applies when inputType is "datasource"');
  });

  it('omits the check props from a passive picker that has no check', () => {
    expect(firstOf([picker()]).props.dataCheckQuery).toBeUndefined();
  });

  it('forwards the authoring fields onto the step', () => {
    const element = firstOf([
      picker({
        datasourceFilter: 'prometheus',
        placeholder: 'Choose one',
        dataCheckQuery: 'container_cpu_usage_seconds_total',
        dataCheckFailureMessage: 'No container metrics here.',
        dataCheckTimeFrom: 'now-6h',
        dataCheckTimeTo: 'now',
        dataCheckBlocking: true,
        skippable: true,
      }),
    ]);
    expect(element.props).toMatchObject({
      variableName: 'metricsDatasource',
      datasourceFilter: 'prometheus',
      placeholder: 'Choose one',
      query: 'container_cpu_usage_seconds_total',
      failureMessage: 'No container metrics here.',
      timeFrom: 'now-6h',
      timeTo: 'now',
      skippable: true,
    });
  });

  it('flattens requirements to the comma-separated form the checker takes', () => {
    const element = firstOf([
      picker({
        dataCheckQuery: 'up',
        dataCheckBlocking: true,
        requirements: ['is-admin', 'has-datasource:prometheus'],
      }),
    ]);
    expect(element.props.requirements).toBe('is-admin,has-datasource:prometheus');
  });

  it('defaults skippable to false, so a blocking check really blocks', () => {
    expect(firstOf([picker({ dataCheckQuery: 'up', dataCheckBlocking: true })]).props.skippable).toBe(false);
  });

  it("uses the author's id as the stepId so completion survives a guide edit", () => {
    const element = firstOf([picker({ id: 'check-metrics', dataCheckQuery: 'up', dataCheckBlocking: true })]);
    expect(element.props.stepId).toBe('check-metrics');
  });

  it('keeps the authored id as the stepId inside a section', () => {
    const { elements } = parseBlocks([
      {
        type: 'section',
        id: 'setup',
        title: 'Setup',
        blocks: [picker({ dataCheckQuery: 'up', dataCheckBlocking: true })],
      },
    ]);
    const step = elements[0]!.children!.find(
      (c): c is ParsedElement => typeof c !== 'string' && c.type === 'datasource-check-step'
    );
    expect(step).toBeDefined();
    expect(step!.props.stepId).toBe('metrics-check');
  });

  it('rejects a blocking check with no id, whose completion records would orphan on the next edit', () => {
    const { id: _dropped, ...noId } = picker({ dataCheckQuery: 'up', dataCheckBlocking: true });
    expect(rejectionFor([noId])).toContain('A blocking data check needs an explicit `id`');
  });

  it('renders the prompt as markdown children', () => {
    const element = firstOf([picker({ prompt: 'Pick **carefully**.', dataCheckQuery: 'up', dataCheckBlocking: true })]);
    expect(element.children?.length).toBeGreaterThan(0);
  });

  it('counts as interactive either way', () => {
    expect(parseBlocks([picker({ dataCheckQuery: 'up', dataCheckBlocking: true })]).hasInteractive).toBe(true);
    expect(parseBlocks([picker()]).hasInteractive).toBe(true);
  });
});
