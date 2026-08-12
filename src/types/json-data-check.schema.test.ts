/**
 * Tests for the data-check block schema, focusing on the mode-driven
 * cross-field requirement that `superRefine` enforces.
 */

import { JsonDataCheckBlockSchema } from './json-guide.schema';

const base = {
  type: 'data-check' as const,
  datasourceType: 'prometheus' as const,
};

function issuePaths(result: ReturnType<typeof JsonDataCheckBlockSchema.safeParse>): string[] {
  return result.success ? [] : result.error.issues.map((i) => i.path.join('.'));
}

describe('JsonDataCheckBlockSchema', () => {
  it('accepts a minimal query check', () => {
    expect(JsonDataCheckBlockSchema.safeParse({ ...base, mode: 'query', query: 'up' }).success).toBe(true);
  });

  it('accepts a minimal ai check', () => {
    expect(JsonDataCheckBlockSchema.safeParse({ ...base, mode: 'ai', aiPrompt: 'has metrics' }).success).toBe(true);
  });

  it('accepts an either check carrying both fields', () => {
    const result = JsonDataCheckBlockSchema.safeParse({
      ...base,
      mode: 'either',
      query: 'up',
      aiPrompt: 'has metrics',
    });

    expect(result.success).toBe(true);
  });

  describe('mode-driven requirements', () => {
    it('requires query in query mode', () => {
      const result = JsonDataCheckBlockSchema.safeParse({ ...base, mode: 'query' });

      expect(issuePaths(result)).toContain('query');
    });

    it('requires aiPrompt in ai mode', () => {
      const result = JsonDataCheckBlockSchema.safeParse({ ...base, mode: 'ai' });

      expect(issuePaths(result)).toContain('aiPrompt');
    });

    it('requires both in either mode', () => {
      const result = JsonDataCheckBlockSchema.safeParse({ ...base, mode: 'either' });

      expect(issuePaths(result)).toEqual(expect.arrayContaining(['query', 'aiPrompt']));
    });

    it('does not demand aiPrompt in query mode', () => {
      const result = JsonDataCheckBlockSchema.safeParse({ ...base, mode: 'query', query: 'up' });

      expect(issuePaths(result)).not.toContain('aiPrompt');
    });

    it('does not demand query in ai mode', () => {
      const result = JsonDataCheckBlockSchema.safeParse({ ...base, mode: 'ai', aiPrompt: 'has metrics' });

      expect(issuePaths(result)).not.toContain('query');
    });

    it('treats a whitespace-only query as missing', () => {
      const result = JsonDataCheckBlockSchema.safeParse({ ...base, mode: 'query', query: '   ' });

      expect(issuePaths(result)).toContain('query');
    });
  });

  describe('field constraints', () => {
    it('rejects a datasource type neither check can evaluate', () => {
      const result = JsonDataCheckBlockSchema.safeParse({
        ...base,
        datasourceType: 'mysql',
        mode: 'query',
        query: 'x',
      });

      expect(result.success).toBe(false);
    });

    it.each(['prometheus', 'loki', 'tempo', 'pyroscope'])('accepts %s', (datasourceType) => {
      const result = JsonDataCheckBlockSchema.safeParse({ ...base, datasourceType, mode: 'query', query: 'x' });

      expect(result.success).toBe(true);
    });

    it('rejects an unknown mode', () => {
      expect(JsonDataCheckBlockSchema.safeParse({ ...base, mode: 'maybe', query: 'up' }).success).toBe(false);
    });

    it('requires a mode', () => {
      expect(JsonDataCheckBlockSchema.safeParse({ ...base, query: 'up' }).success).toBe(false);
    });

    it('requires a datasource type', () => {
      const result = JsonDataCheckBlockSchema.safeParse({ type: 'data-check', mode: 'query', query: 'up' });

      expect(result.success).toBe(false);
    });

    it('carries the optional presentation and behaviour fields', () => {
      const result = JsonDataCheckBlockSchema.safeParse({
        ...base,
        mode: 'query',
        query: 'up',
        id: 'check-1',
        title: 'Check metrics',
        content: 'Pick a data source.',
        timeFrom: 'now-7d',
        timeTo: 'now',
        failureMessage: 'No data.',
        variableName: 'ds',
        requirements: ['has-datasource:prometheus'],
        objectives: ['data-verified'],
        skippable: true,
        hint: 'Configure a data source first',
      });

      expect(result.success).toBe(true);
    });
  });
});
