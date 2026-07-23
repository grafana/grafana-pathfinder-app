/**
 * Tests for collapsible block conversion in the JSON parser.
 */

import { parseJsonGuide } from './json-parser';

// Mock Grafana runtime
jest.mock('@grafana/runtime', () => ({
  config: { bootData: { user: null }, buildInfo: { version: '10.0.0' } },
}));

// Mock @grafana/data renderMarkdown
jest.mock('@grafana/data', () => ({
  renderMarkdown: (md: string) => `<p>${md}</p>`,
}));

describe('json-parser collapsible block', () => {
  it('converts a collapsible block to a collapsible ParsedElement with nested children', () => {
    const guide = JSON.stringify({
      id: 'test-collapsible',
      title: 'Collapsible test',
      blocks: [
        {
          type: 'collapsible',
          title: 'Show solution',
          blocks: [{ type: 'markdown', content: 'The answer is 42.' }],
        },
      ],
    });

    const result = parseJsonGuide(guide);

    expect(result.isValid).toBe(true);
    const collapsible = result.data!.elements.find((el) => el.type === 'collapsible');
    expect(collapsible).toBeDefined();
    expect(collapsible!.props.title).toBe('Show solution');
    expect(collapsible!.children.length).toBe(1);
  });

  it('defaults collapsed to true when omitted', () => {
    const guide = JSON.stringify({
      id: 'test-collapsible-default',
      title: 'Collapsible default',
      blocks: [{ type: 'collapsible', blocks: [{ type: 'markdown', content: 'hidden' }] }],
    });

    const result = parseJsonGuide(guide);
    const collapsible = result.data!.elements.find((el) => el.type === 'collapsible');
    expect(collapsible!.props.collapsed).toBe(true);
  });

  it('preserves an explicit collapsed=false', () => {
    const guide = JSON.stringify({
      id: 'test-collapsible-open',
      title: 'Collapsible open',
      blocks: [{ type: 'collapsible', collapsed: false, blocks: [{ type: 'markdown', content: 'shown' }] }],
    });

    const result = parseJsonGuide(guide);
    const collapsible = result.data!.elements.find((el) => el.type === 'collapsible');
    expect(collapsible!.props.collapsed).toBe(false);
  });

  it('does not mark the guide as interactive for a presentational collapsible', () => {
    const guide = JSON.stringify({
      id: 'test-collapsible-presentational',
      title: 'Presentational',
      blocks: [{ type: 'collapsible', blocks: [{ type: 'markdown', content: 'text' }] }],
    });

    const result = parseJsonGuide(guide);
    expect(result.data!.hasInteractiveElements).toBe(false);
  });
});
