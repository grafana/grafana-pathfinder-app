import { JsonInputBlockSchema } from './json-guide.schema';

const basePicker = {
  type: 'input' as const,
  inputType: 'datasource' as const,
  variableName: 'metricsDatasource',
  prompt: 'Pick the data source holding your container metrics.',
};

const issuePaths = (result: ReturnType<typeof JsonInputBlockSchema.safeParse>) =>
  result.success ? [] : result.error.issues.map((i) => i.path.join('.'));

describe('input block data-check fields', () => {
  it('accepts a datasource picker with no check at all', () => {
    expect(JsonInputBlockSchema.safeParse(basePicker).success).toBe(true);
  });

  it('accepts a query alone — its presence is what enables the check', () => {
    const result = JsonInputBlockSchema.safeParse({ ...basePicker, dataCheckQuery: 'up' });
    expect(result.success).toBe(true);
  });

  it('accepts the full check surface', () => {
    const result = JsonInputBlockSchema.safeParse({
      ...basePicker,
      datasourceFilter: 'prometheus',
      dataCheckQuery: 'container_cpu_usage_seconds_total',
      dataCheckFailureMessage: 'No container CPU metrics here.',
      dataCheckTimeFrom: 'now-6h',
      dataCheckTimeTo: 'now',
      dataCheckBlocking: true,
      skippable: true,
    });
    expect(result.success).toBe(true);
  });

  it.each(['dataCheckFailureMessage', 'dataCheckTimeFrom', 'dataCheckTimeTo', 'dataCheckBlocking'])(
    'rejects %s without a query, which would configure a check that never runs',
    (field) => {
      const value = field === 'dataCheckBlocking' ? true : 'now-6h';
      const result = JsonInputBlockSchema.safeParse({ ...basePicker, [field]: value });
      expect(result.success).toBe(false);
      expect(issuePaths(result)).toContain(field);
    }
  );

  it('treats a whitespace-only query as no query', () => {
    const result = JsonInputBlockSchema.safeParse({
      ...basePicker,
      dataCheckQuery: '   ',
      dataCheckBlocking: true,
    });
    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain('dataCheckBlocking');
  });

  it.each(['text', 'boolean'])('rejects a check on a %s input, which has no data source to query', (inputType) => {
    const result = JsonInputBlockSchema.safeParse({
      ...basePicker,
      inputType,
      dataCheckQuery: 'up',
    });
    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain('dataCheckQuery');
  });

  it('reports every misplaced check field, not just the first', () => {
    const result = JsonInputBlockSchema.safeParse({
      ...basePicker,
      inputType: 'text',
      dataCheckQuery: 'up',
      dataCheckBlocking: true,
      dataCheckTimeFrom: 'now-1h',
    });
    expect(issuePaths(result)).toEqual(
      expect.arrayContaining(['dataCheckQuery', 'dataCheckBlocking', 'dataCheckTimeFrom'])
    );
  });

  it('leaves a plain text input untouched', () => {
    const result = JsonInputBlockSchema.safeParse({
      type: 'input',
      inputType: 'text',
      variableName: 'teamName',
      prompt: 'What is your team called?',
      pattern: '^[a-z]+$',
    });
    expect(result.success).toBe(true);
  });
});
