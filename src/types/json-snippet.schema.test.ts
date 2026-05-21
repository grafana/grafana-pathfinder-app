import { JsonSnippetSchema } from './json-snippet.schema';
import { JsonGuideSchema } from './json-guide.schema';

describe('JsonSnippetSchema', () => {
  it('accepts a minimal valid snippet (no schemaVersion — defaults applied)', () => {
    const result = JsonSnippetSchema.safeParse({
      id: 'create-prometheus-ds',
      title: 'Create a Prometheus data source',
      description: 'Creates and configures a Prometheus data source.',
      blocks: [{ type: 'markdown', content: 'Hello.' }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.schemaVersion).toBe('1.0.0');
    }
  });

  it('rejects a snippet without a description', () => {
    const result = JsonSnippetSchema.safeParse({
      id: 'no-desc',
      title: 'No description',
      blocks: [{ type: 'markdown', content: 'x' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a snippet whose blocks include a snippet-ref (no nesting)', () => {
    const result = JsonSnippetSchema.safeParse({
      id: 'parent',
      title: 'Parent',
      description: 'Parent snippet.',
      blocks: [{ type: 'snippet-ref', snippetId: 'child' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a snippet whose nested section contains a snippet-ref', () => {
    const result = JsonSnippetSchema.safeParse({
      id: 'parent',
      title: 'Parent',
      description: 'Parent snippet.',
      blocks: [
        {
          type: 'section',
          title: 'Inside',
          blocks: [{ type: 'snippet-ref', snippetId: 'nested' }],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a snippet with no blocks', () => {
    const result = JsonSnippetSchema.safeParse({
      id: 'empty',
      title: 'Empty',
      description: 'Empty snippet.',
      blocks: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-kebab-case id', () => {
    const result = JsonSnippetSchema.safeParse({
      id: 'Not-Kebab',
      title: 'Bad id',
      description: 'Bad id snippet.',
      blocks: [{ type: 'markdown', content: 'x' }],
    });
    expect(result.success).toBe(false);
  });
});

describe('JsonGuideSchema with snippet-ref blocks', () => {
  it('accepts a guide that contains a top-level snippet-ref', () => {
    const result = JsonGuideSchema.safeParse({
      id: 'guide',
      title: 'A guide',
      blocks: [{ type: 'snippet-ref', snippetId: 'open-connections-page' }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts a guide with a snippet-ref inside a section', () => {
    const result = JsonGuideSchema.safeParse({
      id: 'guide',
      title: 'A guide',
      blocks: [
        {
          type: 'section',
          title: 'Setup',
          blocks: [{ type: 'snippet-ref', snippetId: 'open-connections-page' }],
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});
