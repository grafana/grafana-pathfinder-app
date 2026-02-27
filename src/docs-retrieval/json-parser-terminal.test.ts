/**
 * Tests for terminal block conversion in the JSON parser.
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

describe('json-parser terminal block', () => {
  it('converts a terminal block to a terminal-step ParsedElement', () => {
    const guide = JSON.stringify({
      id: 'test-terminal',
      title: 'Terminal test',
      blocks: [
        {
          type: 'terminal',
          command: 'echo hello',
          content: 'Run this command',
        },
      ],
    });

    const result = parseJsonGuide(guide);

    expect(result.isValid).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data!.hasInteractiveElements).toBe(true);

    const elements = result.data!.elements;
    const terminalEl = elements.find((el) => el.type === 'terminal-step');
    expect(terminalEl).toBeDefined();
    expect(terminalEl!.props.command).toBe('echo hello');
    expect(terminalEl!.props.skippable).toBe(false);
  });

  it('preserves requirements and skippable on terminal blocks', () => {
    const guide = JSON.stringify({
      id: 'test-terminal-req',
      title: 'Terminal with requirements',
      blocks: [
        {
          type: 'terminal',
          command: 'ls -la',
          content: 'List files',
          requirements: ['is-terminal-active'],
          skippable: true,
          hint: 'Connect first',
        },
      ],
    });

    const result = parseJsonGuide(guide);
    expect(result.isValid).toBe(true);

    const terminalEl = result.data!.elements.find((el) => el.type === 'terminal-step');
    expect(terminalEl).toBeDefined();
    expect(terminalEl!.props.requirements).toBe('is-terminal-active');
    expect(terminalEl!.props.skippable).toBe(true);
    expect(terminalEl!.props.hints).toBe('Connect first');
  });

  it('works inside a section block', () => {
    const guide = JSON.stringify({
      id: 'test-terminal-section',
      title: 'Terminal in section',
      blocks: [
        {
          type: 'section',
          id: 'my-section',
          title: 'My section',
          blocks: [
            {
              type: 'terminal',
              command: 'whoami',
              content: 'Check user',
            },
          ],
        },
      ],
    });

    const result = parseJsonGuide(guide);
    expect(result.isValid).toBe(true);
    expect(result.data!.hasInteractiveElements).toBe(true);

    // The section should contain the terminal step as a child
    const sectionEl = result.data!.elements.find((el) => el.type === 'interactive-section');
    expect(sectionEl).toBeDefined();

    const terminalChild = sectionEl!.children.find(
      (child) => typeof child !== 'string' && child.type === 'terminal-step'
    );
    expect(terminalChild).toBeDefined();
  });
});
