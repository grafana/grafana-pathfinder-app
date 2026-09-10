import { parseJsonGuide } from './json-parser';

jest.mock('@grafana/runtime', () => ({
  config: { bootData: { user: null }, buildInfo: { version: '10.0.0' } },
}));

jest.mock('@grafana/data', () => ({
  renderMarkdown: (markdown: string) => `<p>${markdown}</p>`,
}));

describe('json-parser divider block', () => {
  it('converts a divider into a semantic horizontal rule', () => {
    const result = parseJsonGuide({
      id: 'divider-guide',
      title: 'Divider guide',
      blocks: [{ type: 'divider' }],
    });

    expect(result.isValid).toBe(true);
    expect(result.data?.elements).toEqual([
      {
        type: 'hr',
        props: { className: 'guide-divider' },
        children: [],
      },
    ]);
    expect(result.data?.hasInteractiveElements).toBe(false);
  });
});
