/**
 * Parser coverage for the data-check block.
 */

import { parseJsonGuide } from './json-parser';

jest.mock('@grafana/runtime', () => ({
  config: { bootData: { user: null }, buildInfo: { version: '10.0.0' } },
}));

jest.mock('@grafana/data', () => ({
  renderMarkdown: (md: string) => `<p>${md}</p>`,
}));

const baseBlock = {
  type: 'data-check',
  datasourceType: 'prometheus',
  mode: 'query',
  query: 'up',
};

function parseGuide(block: Record<string, unknown>) {
  const result = parseJsonGuide(JSON.stringify({ id: 'g', title: 'Guide', blocks: [block] }));
  expect(result.isValid).toBe(true);
  return result.data!;
}

function parseBlock(block: Record<string, unknown>) {
  const element = parseGuide(block).elements.find((el) => el.type === 'data-check-step');
  expect(element).toBeDefined();
  return element!;
}

describe('data-check block parsing', () => {
  it('emits the data-check-step element type', () => {
    expect(parseBlock(baseBlock).type).toBe('data-check-step');
  });

  it('forwards the authoring fields', () => {
    const element = parseBlock({
      ...baseBlock,
      mode: 'either',
      aiPrompt: 'has metrics',
      title: 'Check metrics',
      timeFrom: 'now-7d',
      timeTo: 'now',
      failureMessage: 'No data.',
      variableName: 'ds',
    });

    expect(element.props).toMatchObject({
      datasourceType: 'prometheus',
      mode: 'either',
      query: 'up',
      aiPrompt: 'has metrics',
      title: 'Check metrics',
      timeFrom: 'now-7d',
      timeTo: 'now',
      failureMessage: 'No data.',
      variableName: 'ds',
    });
  });

  it('preserves an author-supplied id as the stepId', () => {
    expect(parseBlock({ ...baseBlock, id: 'check-metrics' }).props.stepId).toBe('check-metrics');
  });

  it('flattens requirements and objectives to comma-separated strings', () => {
    const element = parseBlock({
      ...baseBlock,
      requirements: ['has-datasource:prometheus', 'has-role:admin'],
      objectives: ['data-verified'],
    });

    expect(element.props.requirements).toBe('has-datasource:prometheus,has-role:admin');
    expect(element.props.objectives).toBe('data-verified');
  });

  it('defaults skippable to false', () => {
    expect(parseBlock(baseBlock).props.skippable).toBe(false);
  });

  it('parses the markdown description into children', () => {
    const element = parseBlock({ ...baseBlock, content: 'Pick a **data source**.' });

    expect(element.children?.length).toBeGreaterThan(0);
  });

  it('renders without a description', () => {
    expect(parseBlock(baseBlock).children).toEqual([]);
  });

  it('counts as interactive content', () => {
    expect(parseGuide(baseBlock).hasInteractiveElements).toBe(true);
  });

  it('rejects a guide whose data check omits the field its mode requires', () => {
    const result = parseJsonGuide(
      JSON.stringify({
        id: 'g',
        title: 'Guide',
        blocks: [{ type: 'data-check', datasourceType: 'prometheus', mode: 'ai' }],
      })
    );

    expect(result.isValid).toBe(false);
  });
});
