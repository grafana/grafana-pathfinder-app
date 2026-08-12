/**
 * Query tool for data-check steps.
 *
 * Lets the assistant test whether data exists by running queries. Every limit
 * here is enforced in this closure rather than asked of the model: the data
 * source uid is captured at construction and is not a tool input, so the model
 * can only ever query the one the user picked.
 */

import {
  createTool,
  type InlineToolRunnable,
  type ToolInvokeOptions,
  type ToolOutput,
  type JSONSchema,
} from '@grafana/assistant';

import type { SupportedDatasourceType } from '../../../constants/datasource-types';
import { runDataCheckQuery } from '../../../lib/datasource/run-data-check-query';

/** Queries one assistant-driven data check may run. */
export const DATA_CHECK_QUERY_BUDGET = 3;

/** Characters of tool output returned to the model. */
const MAX_OUTPUT_CHARS = 600;

interface ToolInput {
  query?: string;
}

const toolInputSchema: JSONSchema = {
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description: 'The query to run against the data source the user selected.',
    },
  },
  required: ['query'],
  additionalProperties: false,
};

const validateInput = (input: unknown): ToolInput => {
  if (typeof input !== 'object' || input === null) {
    return {};
  }
  const obj = input as Record<string, unknown>;
  return { query: typeof obj.query === 'string' ? obj.query : undefined };
};

export interface DataCheckQueryToolOptions {
  datasourceUid: string;
  datasourceType: SupportedDatasourceType;
  timeFrom?: string;
  timeTo?: string;
  signal?: AbortSignal;
  /** Queries this tool may run before refusing. Defaults to DATA_CHECK_QUERY_BUDGET. */
  budget?: number;
  /** Notified after each attempt so the caller can surface what ran. */
  onQueryRun?: (query: string, hasData: boolean) => void;
}

const QUERY_DESCRIPTIONS: Record<SupportedDatasourceType, string> = {
  prometheus: 'a PromQL expression',
  loki: 'a LogQL expression',
  tempo: 'a TraceQL query',
  pyroscope: 'a query shaped as "<profileTypeId>|<labelSelector>"',
};

/**
 * Build the query tool bound to one data source and one budget.
 *
 * Construct a fresh tool per check — the budget counter lives in the closure.
 */
export const createDataCheckQueryTool = (options: DataCheckQueryToolOptions): InlineToolRunnable => {
  const { datasourceUid, datasourceType, timeFrom, timeTo, signal, onQueryRun } = options;
  const budget = options.budget ?? DATA_CHECK_QUERY_BUDGET;
  let spent = 0;

  return createTool(
    async (input: ToolInput, _options: ToolInvokeOptions): Promise<ToolOutput> => {
      const query = input.query?.trim();
      if (!query) {
        return 'No query provided. Pass the query string to run.';
      }
      if (spent >= budget) {
        return `Query budget exhausted (${budget} of ${budget} used). Decide the verdict from what you already know.`;
      }
      spent += 1;

      const result = await runDataCheckQuery({
        datasourceUid,
        datasourceType,
        query,
        from: timeFrom,
        to: timeTo,
        signal,
      });

      if (!result.ok) {
        onQueryRun?.(query, false);
        return `Query failed (${budget - spent} of ${budget} remaining): ${result.error.slice(0, MAX_OUTPUT_CHARS)}`;
      }

      onQueryRun?.(query, result.hasData);
      const summary = result.hasData
        ? `Returned data: ${result.seriesCount} series, ${result.rowCount} rows.`
        : 'Returned no data.';
      return `${summary} (${budget - spent} of ${budget} queries remaining)`;
    },
    {
      name: 'run_datasource_query',
      description: `Runs a query against the data source the user selected for this check and reports whether it returned any data. Accepts ${QUERY_DESCRIPTIONS[datasourceType]}. You cannot choose the data source — it is fixed to the user's selection. You may run at most ${budget} queries.`,
      inputSchema: toolInputSchema,
      validate: validateInput,
    }
  );
};
