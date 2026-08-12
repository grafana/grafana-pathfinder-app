/**
 * Hardening tests for the assistant-facing query tool.
 *
 * These are security tests, not unit tests: they pin the guarantees that stop a
 * model from querying a data source the user did not select, or from running
 * queries without bound.
 */

import { createDataCheckQueryTool, DATA_CHECK_QUERY_BUDGET } from './datasource-query.tool';

const mockRunQuery = jest.fn();

jest.mock('../../../lib/datasource/run-data-check-query', () => ({
  runDataCheckQuery: (...args: unknown[]) => mockRunQuery(...args),
}));

// createTool is the SDK's wrapper; the hardening lives in the handler we pass
// it, so capture the handler and invoke it directly.
let capturedHandler: (input: unknown, options: unknown) => Promise<unknown>;
let capturedConfig: { name: string; description: string; inputSchema: any };

jest.mock('@grafana/assistant', () => ({
  createTool: (handler: any, config: any) => {
    capturedHandler = handler;
    capturedConfig = config;
    return { handler, config };
  },
}));

function buildTool(overrides: Partial<Parameters<typeof createDataCheckQueryTool>[0]> = {}) {
  createDataCheckQueryTool({
    datasourceUid: 'chosen-uid',
    datasourceType: 'prometheus',
    ...overrides,
  });
  return { invoke: (input: unknown) => capturedHandler(input, {}), config: capturedConfig };
}

beforeEach(() => {
  mockRunQuery.mockReset();
  mockRunQuery.mockResolvedValue({ ok: true, hasData: true, seriesCount: 1, rowCount: 1 });
});

describe('createDataCheckQueryTool', () => {
  describe('data source binding', () => {
    it('queries the bound uid', async () => {
      const { invoke } = buildTool();

      await invoke({ query: 'up' });

      expect(mockRunQuery).toHaveBeenCalledWith(expect.objectContaining({ datasourceUid: 'chosen-uid' }));
    });

    it('ignores a datasource the model tries to name', async () => {
      const { invoke } = buildTool();

      await invoke({ query: 'up', datasourceUid: 'someone-elses-uid', datasourceType: 'loki' });

      expect(mockRunQuery).toHaveBeenCalledWith(
        expect.objectContaining({ datasourceUid: 'chosen-uid', datasourceType: 'prometheus' })
      );
    });

    it('does not advertise a datasource input', () => {
      const { config } = buildTool();

      expect(Object.keys(config.inputSchema.properties)).toEqual(['query']);
      expect(config.inputSchema.additionalProperties).toBe(false);
    });
  });

  describe('query budget', () => {
    it('refuses the call past the budget without querying', async () => {
      const { invoke } = buildTool({ budget: 2 });

      await invoke({ query: 'a' });
      await invoke({ query: 'b' });
      const third = await invoke({ query: 'c' });

      expect(mockRunQuery).toHaveBeenCalledTimes(2);
      expect(third).toContain('budget exhausted');
    });

    it('counts a failed query against the budget', async () => {
      mockRunQuery.mockResolvedValue({ ok: false, error: 'boom' });
      const { invoke } = buildTool({ budget: 1 });

      await invoke({ query: 'a' });
      const second = await invoke({ query: 'b' });

      expect(mockRunQuery).toHaveBeenCalledTimes(1);
      expect(second).toContain('budget exhausted');
    });

    it('gives each tool its own budget', async () => {
      const first = buildTool({ budget: 1 });
      await first.invoke({ query: 'a' });
      const second = buildTool({ budget: 1 });

      await second.invoke({ query: 'b' });

      expect(mockRunQuery).toHaveBeenCalledTimes(2);
    });

    it('defaults to the documented budget', () => {
      const { config } = buildTool();

      expect(config.description).toContain(String(DATA_CHECK_QUERY_BUDGET));
    });
  });

  describe('output', () => {
    it('reports data without leaking the rows themselves', async () => {
      mockRunQuery.mockResolvedValue({ ok: true, hasData: true, seriesCount: 2, rowCount: 40 });
      const { invoke } = buildTool();

      const output = await invoke({ query: 'up' });

      expect(output).toContain('2 series');
      expect(output).toContain('40 rows');
    });

    it('reports an empty result plainly', async () => {
      mockRunQuery.mockResolvedValue({ ok: true, hasData: false, seriesCount: 0, rowCount: 0 });
      const { invoke } = buildTool();

      expect(await invoke({ query: 'up' })).toContain('no data');
    });

    it('truncates a long error rather than pasting it into the prompt', async () => {
      mockRunQuery.mockResolvedValue({ ok: false, error: 'x'.repeat(5000) });
      const { invoke } = buildTool();

      const output = (await invoke({ query: 'up' })) as string;

      expect(output.length).toBeLessThan(1000);
    });

    it('asks for a query rather than running an empty one', async () => {
      const { invoke } = buildTool();

      const output = await invoke({ query: '  ' });

      expect(mockRunQuery).not.toHaveBeenCalled();
      expect(output).toContain('No query provided');
    });
  });
});
