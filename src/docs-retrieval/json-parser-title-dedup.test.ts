/**
 * Tests for the leading-heading/title dedup guard in the JSON parser.
 */

import { parseJsonGuide } from './json-parser';

jest.mock('@grafana/runtime', () => ({
  config: { bootData: { user: null }, buildInfo: { version: '10.0.0' } },
}));

jest.mock('@grafana/data', () => ({
  renderMarkdown: (md: string) =>
    md
      .split('\n\n')
      .map((block) => {
        const m = block.match(/^(#{1,6})\s+(.+)$/);
        return m ? `<h${m[1]!.length}>${m[2]}</h${m[1]!.length}>` : `<p>${block}</p>`;
      })
      .join(''),
}));

function collectTypes(elements: any[]): string[] {
  const types: string[] = [];
  for (const el of elements) {
    if (typeof el === 'string') {
      continue;
    }
    types.push(el.type);
    if (Array.isArray(el.children)) {
      types.push(...collectTypes(el.children));
    }
  }
  return types;
}

describe('json-parser leading heading/title dedup', () => {
  it('drops an exact-match leading h1 that duplicates the title', () => {
    const guide = JSON.stringify({
      id: 'test',
      title: 'Create your first dashboard',
      blocks: [{ type: 'markdown', content: '# Create your first dashboard\n\nWelcome!' }],
    });
    const result = parseJsonGuide(guide);
    expect(result.isValid).toBe(true);
    expect(collectTypes(result.data!.elements)).not.toContain('h1');
    expect(JSON.stringify(result.data!.elements)).toContain('Welcome!');
  });

  it('drops the heading when the title has a trailing suffix the heading lacks', () => {
    const guide = JSON.stringify({
      id: 'test',
      title: 'Create your first dashboard in Grafana Cloud',
      blocks: [{ type: 'markdown', content: '# Create your first dashboard\n\nWelcome!' }],
    });
    const result = parseJsonGuide(guide);
    expect(collectTypes(result.data!.elements)).not.toContain('h1');
  });

  it('drops the heading when it has trailing punctuation the title lacks', () => {
    const guide = JSON.stringify({
      id: 'test',
      title: 'Welcome to Grafana',
      blocks: [{ type: 'markdown', content: '# Welcome to Grafana!\n\nTour time.' }],
    });
    const result = parseJsonGuide(guide);
    expect(collectTypes(result.data!.elements)).not.toContain('h1');
  });

  it('keeps an unrelated leading heading', () => {
    const guide = JSON.stringify({
      id: 'test',
      title: 'Guide editor tutorial',
      blocks: [{ type: 'markdown', content: "# Welcome to the guide editor\n\nLet's get started." }],
    });
    const result = parseJsonGuide(guide);
    expect(collectTypes(result.data!.elements)).toContain('h1');
  });

  it('keeps a leading h2, regardless of text', () => {
    const guide = JSON.stringify({
      id: 'test',
      title: 'Prometheus & Grafana 101',
      blocks: [{ type: 'markdown', content: '## Prerequisites\n\nYou will need a running Grafana instance.' }],
    });
    const result = parseJsonGuide(guide);
    expect(collectTypes(result.data!.elements)).toContain('h2');
  });

  it('removes the block entirely when it is only the duplicate heading', () => {
    const guide = JSON.stringify({
      id: 'test',
      title: 'Create your first dashboard',
      blocks: [{ type: 'markdown', content: '# Create your first dashboard' }],
    });
    const result = parseJsonGuide(guide);
    expect(result.data!.elements).toHaveLength(0);
  });

  it('keeps the heading on partial word overlap that diverges', () => {
    const guide = JSON.stringify({
      id: 'test',
      title: 'Grafana dashboards guide',
      blocks: [{ type: 'markdown', content: '# Grafana loki setup\n\nBody text.' }],
    });
    const result = parseJsonGuide(guide);
    expect(collectTypes(result.data!.elements)).toContain('h1');
  });
});
