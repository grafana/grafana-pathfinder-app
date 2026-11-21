/**
 * Contract: cli-routed
 *
 * Thin wrap of CLI `find-steps`: the command's schema and runner are the whole
 * tool. Agents copy `opts` from pathfinder_help; unknown or invalid keys are
 * rejected by `validateCommandArgs` before the runner sees them.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { findStepsSpec, runFindSteps } from '../../commands/find-steps';
import { parseCommandInput } from '../../contracts';
import { renderMachineJson } from '../../utils/output';
import { bindCommandInterface, validateCommandArgs } from '../lib/command-interface';
import { readOnly } from './annotations';
import { outcomeResult, textResult, type ToolResult } from './result';

const DESCRIPTION =
  "Use this tool to find verified Grafana procedures (steps with selectors that pass live tests) when authoring a guide. Each result's `nextProcedure`/`previousProcedure` lets you fetch an adjacent part by `procedureId` when a step you searched for isn't in the procedure you found. " +
  'Each result is an ordered list of steps with the exact selector, action, and value that worked. ' +
  'Send every sub-task of the guide in one call: `{ "opts": { "queries": ["configure loki data source", "create dashboard"] } }`, up to 8 phrases of 2-5 words, one per sub-task, using the words on Grafana\'s UI. ' +
  'Each phrase comes back as its own group whose first result has the steps and later results are summaries (fetch one with procedureId when it fits better); `limit` (per phrase, default 2) is optional. ' +
  'The first `navigation` steps only reach `startsOn`; drop them when the guide is already there. ' +
  'To continue from where a result leaves the user, query the next sub-task with pageUrl set to its endsOn. ' +
  "A result's `context` names where it sits (`position` of `total` in its path); each neighbour is `{ procedureId, title }`. " +
  '`procedureId` takes one id or a list of up to 8 and returns every step plus the path `outline`; use it when `omitted` hides steps you need or the task spans more than the hit. ' +
  'For third-party platforms (Slack, PagerDuty, AWS) query the Grafana process in generic terms ("configure contact point"), not the product. ' +
  'On an error, retry once; if it still fails, use placeholders and tell the user the verified index was unavailable.';

const FindStepsOptsSchema = z
  .record(z.string(), z.unknown())
  .optional()
  .default({})
  .describe('Search parameters keyed exactly as pathfinder_help({ command: "find-steps" }) returns them.');

export function registerFindSteps(server: McpServer): void {
  bindCommandInterface('find-steps');

  server.registerTool(
    'pathfinder_find_steps',
    {
      description: DESCRIPTION,
      annotations: readOnly('Find verified guide steps', /* openWorld */ true),
      inputSchema: { opts: FindStepsOptsSchema },
    },
    async ({ opts }) => handleFindSteps(opts ?? {})
  );
}

async function handleFindSteps(args: Record<string, unknown>): Promise<ToolResult> {
  const rejected = validateCommandArgs('find-steps', args);
  if (rejected) {
    return rejected;
  }
  const parsed = parseCommandInput(findStepsSpec, args);
  if (!parsed.ok) {
    return outcomeResult(parsed.outcome);
  }
  const outcome = await runFindSteps(parsed.value);
  if (outcome.status === 'ok') {
    return textResult(renderMachineJson(outcome.data));
  }
  return textResult(
    renderMachineJson({ status: 'error', code: outcome.code, message: outcome.message, ...outcome.data }),
    true
  );
}
