/**
 * Tests for challenge block conversion in the JSON parser.
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

describe('json-parser challenge block', () => {
  it('converts a challenge block to a challenge-block ParsedElement', () => {
    const guide = JSON.stringify({
      id: 'test-challenge',
      title: 'Challenge test',
      blocks: [
        {
          type: 'challenge',
          mode: 'standard',
          title: 'Fix the broken scrape',
          brief: 'Alloy is misconfigured. Restore metric collection.',
          successCriteria: 'has-dashboard-named:My Dashboard',
        },
      ],
    });

    const result = parseJsonGuide(guide);

    expect(result.isValid).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data!.hasInteractiveElements).toBe(true);

    const elements = result.data!.elements;
    const challengeEl = elements.find((el) => el.type === 'challenge-block');
    expect(challengeEl).toBeDefined();
    expect(challengeEl!.props.title).toBe('Fix the broken scrape');
    expect(challengeEl!.props.successCriteria).toBe('has-dashboard-named:My Dashboard');
    expect(challengeEl!.props.skippable).toBe(false);
  });

  it('plumbs requirements, objectives, and skippable through to the converted props', () => {
    const guide = JSON.stringify({
      id: 'test-challenge-gating',
      title: 'Challenge with gating',
      blocks: [
        {
          type: 'challenge',
          mode: 'standard',
          title: 'Fix the broken scrape',
          brief: 'Alloy is misconfigured. Restore metric collection.',
          successCriteria: 'has-dashboard-named:My Dashboard',
          requirements: ['is-terminal-active', 'is-logged-in'],
          objectives: ['is-terminal-active', 'is-logged-in'],
          skippable: true,
        },
      ],
    });

    const result = parseJsonGuide(guide);
    expect(result.isValid).toBe(true);

    const challengeEl = result.data!.elements.find((el) => el.type === 'challenge-block');
    expect(challengeEl).toBeDefined();
    expect(challengeEl!.props.requirements).toEqual(['is-terminal-active', 'is-logged-in']);
    expect(challengeEl!.props.objectives).toEqual(['is-terminal-active', 'is-logged-in']);
    expect(challengeEl!.props.skippable).toBe(true);
  });

  it('drops prose objectives while preserving valid condition vocabulary', () => {
    const guide = JSON.stringify({
      id: 'test-challenge-prose-objectives',
      title: 'Challenge with prose objectives',
      blocks: [
        {
          type: 'challenge',
          mode: 'standard',
          title: 'Fix the broken scrape',
          brief: 'Alloy is misconfigured.',
          successCriteria: 'has-dashboard-named:My Dashboard',
          objectives: ['Understand Alloy scraping', 'is-logged-in'],
        },
      ],
    });

    const result = parseJsonGuide(guide);
    expect(result.isValid).toBe(true);

    const challengeEl = result.data!.elements.find((el) => el.type === 'challenge-block');
    expect(challengeEl).toBeDefined();
    expect(challengeEl!.props.objectives).toEqual(['is-logged-in']);
  });

  it('drops all prose objectives yielding undefined', () => {
    const guide = JSON.stringify({
      id: 'test-challenge-all-prose-objectives',
      title: 'Challenge with all prose objectives',
      blocks: [
        {
          type: 'challenge',
          mode: 'standard',
          title: 'Fix the broken scrape',
          brief: 'Alloy is misconfigured.',
          successCriteria: 'has-dashboard-named:My Dashboard',
          objectives: ['Understand Alloy scraping', 'Read collector dashboards'],
        },
      ],
    });

    const result = parseJsonGuide(guide);
    expect(result.isValid).toBe(true);

    const challengeEl = result.data!.elements.find((el) => el.type === 'challenge-block');
    expect(challengeEl).toBeDefined();
    expect(challengeEl!.props.objectives).toBeUndefined();
  });
});
