/**
 * Contract: cli-routed
 *
 * Thin wrap of CLI `schema`. Agents copy `opts` from pathfinder_help. No
 * artifact / sessionToken envelope — the runner is the whole tool.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { runSchema, schemaSpec } from '../../commands/schema';
import { parseCommandInput } from '../../contracts';
import { renderMachineJson } from '../../utils/output';
import { bindCommandInterface, validateCommandArgs } from '../lib/command-interface';
import { readOnly } from './annotations';
import { outcomeResult, textResult } from './result';

export function registerSchemaTools(server: McpServer): void {
  bindCommandInterface('schema');

  server.registerTool(
    'pathfinder_get_schema',
    {
      description:
        'Use this tool when an agent or downstream consumer needs the canonical JSON Schema for a Pathfinder authoring artifact (guide, block, content, manifest, repository, graph). Call pathfinder_help({ command: "schema" }) for the `opts` interface. Returns the Zod-derived JSON Schema with refinement notes — the same schema the CLI validator enforces. Read-only.',
      annotations: readOnly('Get Pathfinder schema'),
      inputSchema: {
        opts: z
          .record(z.string(), z.unknown())
          .describe('Parameters keyed exactly as pathfinder_help({ command: "schema" }) returns them.'),
      },
    },
    async ({ opts }) => {
      const rejected = validateCommandArgs('schema', opts);
      if (rejected) {
        return rejected;
      }

      const parsed = parseCommandInput(schemaSpec, opts);
      if (!parsed.ok) {
        return outcomeResult(parsed.outcome);
      }
      const outcome = runSchema(parsed.value);
      return outcome.status === 'ok' ? textResult(renderMachineJson(outcome.data)) : outcomeResult(outcome);
    }
  );
}
