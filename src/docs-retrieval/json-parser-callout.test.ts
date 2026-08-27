/**
 * Tests for callout block conversion in the JSON parser.
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

describe('json-parser callout block', () => {
  it('converts a callout block to a callout ParsedElement with title and markdown children', () => {
    const guide = JSON.stringify({
      id: 'test-callout',
      title: 'Callout test',
      blocks: [{ type: 'callout', title: 'Objective', content: 'Learn the thing.' }],
    });

    const result = parseJsonGuide(guide);

    expect(result.isValid).toBe(true);
    const callout = result.data!.elements.find((el) => el.type === 'callout');
    expect(callout).toBeDefined();
    expect(callout!.props.title).toBe('Objective');
    expect(callout!.children.length).toBeGreaterThan(0);
  });

  it('does not mark the guide as interactive for a presentational callout', () => {
    const guide = JSON.stringify({
      id: 'test-callout-presentational',
      title: 'Presentational',
      blocks: [{ type: 'callout', title: 'Objective', content: 'text' }],
    });

    const result = parseJsonGuide(guide);
    expect(result.data!.hasInteractiveElements).toBe(false);
  });
});
