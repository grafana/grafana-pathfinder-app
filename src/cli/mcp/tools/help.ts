/**
 * `pathfinder_help` — exposes the same `--help --format json` surface the
 * CLI exposes, as a function call. The CLI's JSON help shape is a stability
 * contract (see AGENT-AUTHORING.md). The MCP forwards it verbatim.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { formatHelpAsJson, renderMachineJson } from '../../utils/output';
import { CLI_COMMANDS } from '../program';
import { readOnly } from './annotations';
import { textResult } from './result';

export function registerHelpTool(server: McpServer): void {
  server.registerTool(
    'pathfinder_help',
    {
      description:
        'Use this tool when you need exact flag names, per-block-type field schemas, or the full CLI command list while authoring a Pathfinder guide. Returns the structured help surface for a CLI command, equivalent to `pathfinder-cli <command> --help --format json`. Pass an empty command for the list of commands.',
      annotations: readOnly('Show Pathfinder help'),
      inputSchema: {
        command: z
          .string()
          .optional()
          .describe('CLI command name (e.g. "create", "add-block"). Omit for the top-level command list.'),
        subcommand: z
          .string()
          .optional()
          .describe(
            'Optional sub-command — used for `add-block <type>` style help where the block type drills into per-type flags.'
          ),
      },
    },
    async ({ command, subcommand }) => {
      if (!command) {
        return textResult(
          renderMachineJson({
            commands: Array.from(CLI_COMMANDS.entries()).map(([name, cmd]) => ({
              name,
              description: cmd.description(),
            })),
          })
        );
      }

      const root = CLI_COMMANDS.get(command);
      if (!root) {
        return textResult(
          renderMachineJson({
            status: 'error',
            code: 'UNKNOWN_COMMAND',
            message: `Unknown command "${command}". Available: ${Array.from(CLI_COMMANDS.keys()).join(', ')}`,
          }),
          true
        );
      }

      let target = root;
      if (subcommand) {
        const sub = root.commands.find((c) => c.name() === subcommand);
        if (sub) {
          target = sub;
        }
      }

      return textResult(renderMachineJson(formatHelpAsJson(target)));
    }
  );
}
