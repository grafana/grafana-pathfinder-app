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
  'Use this tool to find verified Grafana procedures (ordered steps with the exact selector, action and value that passed live tests) when authoring a guide. Send every sub-task in one call: `{ "opts": { "queries": ["configure loki data source", "create dashboard"] } }`, up to 8 phrases of 2-5 words in Grafana\'s UI words; `limit` (per phrase, default 2) is optional. Each phrase returns its own group: the first result has the steps, later ones are summaries (fetch by procedureId). The first `navigation` steps only reach `startsOn`; drop them if the guide is already there. To continue where a result leaves the user, query the next sub-task with pageUrl set to its endsOn. `context` gives `position` of `total` and neighbours `{ procedureId, title }`; `procedureId` (one id or up to 8) returns every step plus the path `outline`, for when `omitted` hides steps you need. For third-party platforms (Slack, PagerDuty, AWS) query the Grafana process ("configure contact point"), not the product. On an error, use placeholders and tell the user the verified index was unavailable; retrying returns the same error until the time it names.';

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
