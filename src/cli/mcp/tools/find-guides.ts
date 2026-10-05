/**
 * Contract: cli-routed
 *
 * Thin wrap of CLI `find-guides`: the command's schema and runner are the whole
 * tool. Agents copy `opts` from pathfinder_help; unknown or invalid keys are
 * rejected by `validateCommandArgs` before the runner sees them.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { findGuidesSpec, runFindGuides } from '../../commands/find-guides';
import { parseCommandInput } from '../../contracts';
import { renderMachineJson } from '../../utils/output';
import { bindCommandInterface, validateCommandArgs } from '../lib/command-interface';
import { readOnly } from './annotations';
import { outcomeResult, textResult, type ToolResult } from './result';

const DESCRIPTION =
  'Use this tool to find interactive Grafana guides and learning paths that walk the user through a task inside their Grafana instance. ' +
  'Call this whenever the user asks how to set up, configure, learn, or do something in Grafana, or asks whether help or a ' +
  'tutorial exists for a topic, even if they did not ask for a guide. Call pathfinder_help({ command: "find-guides" }) for the ' +
  "`opts` interface: pass several `queries` that mix the user's words with the Grafana product names they imply, and " +
  '`pageUrl` when you know the current page. Offer at most 1-3 results as Markdown links using `launchPath` (or ' +
  '`launchUrl`). If `noStrongMatch` is true, say no guide covers this rather than listing weak matches.';

const FindGuidesOptsSchema = z
  .record(z.string(), z.unknown())
  .optional()
  .default({})
  .describe('Search parameters keyed exactly as pathfinder_help({ command: "find-guides" }) returns them.');

export function registerFindGuides(server: McpServer): void {
  bindCommandInterface('find-guides');

  server.registerTool(
    'pathfinder_find_guides',
    {
      description: DESCRIPTION,
      annotations: readOnly('Find Pathfinder guides', /* openWorld */ true),
      inputSchema: { opts: FindGuidesOptsSchema },
    },
    async ({ opts }) => handleFindGuides(opts ?? {})
  );
}

async function handleFindGuides(args: Record<string, unknown>): Promise<ToolResult> {
  const rejected = validateCommandArgs('find-guides', args);
  if (rejected) {
    return rejected;
  }
  const parsed = parseCommandInput(findGuidesSpec, args);
  if (!parsed.ok) {
    return outcomeResult(parsed.outcome);
  }
  const outcome = await runFindGuides(parsed.value);
  if (outcome.status === 'ok') {
    return textResult(renderMachineJson(outcome.data));
  }
  return textResult(
    renderMachineJson({ status: 'error', code: outcome.code, message: outcome.message, ...outcome.data }),
    true
  );
}
