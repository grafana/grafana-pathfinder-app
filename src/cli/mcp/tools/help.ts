/**
 * Contract: mcp-native
 *
 * `pathfinder_help` — the agent's view of any CLI command interface.
 *
 * Descriptions, types, and requiredness stay CLI-owned; parameter names are the
 * Commander `opts()` keys imported runners receive, minus parameters an MCP
 * tool already owns. See `lib/command-interface.ts`.
 *
 * This is the *inbound* half of the agent contract, and the only half we
 * author: a convenience projection published so the agent never has to reason
 * about argv. The outbound half is the CLI's own `CommandOutcome`, forwarded
 * verbatim by `tools/result.ts`. Both halves are stated for agents in one
 * place — `authoring_start`'s `interfaceContract` — so this description
 * carries the translation mechanics and no other tool restates them.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { renderMachineJson } from '../../utils/output';
import { boundCommandNames, formatCommandInterface, isCommandInterfaceError } from '../lib/command-interface';
import { commandSummary } from '../../commands/manifest';
import { readOnly } from './annotations';
import { textResult } from './result';

export function registerHelpTool(server: McpServer): void {
  // command/subcommand select a CLI interface; they are not runner opts.
  server.registerTool(
    'pathfinder_help',
    {
      description:
        'Use this tool when you need the exact parameter interface for a Pathfinder CLI-backed tool while authoring a guide. What comes back is a convenience projection of the CLI option surface into the JSON shape the tool accepts — not CLI syntax, so you never build a command line. Each parameter arrives under the camelCase name the tool accepts, with CLI-owned descriptions, types, and requiredness. Copy those names and JSON value types into `opts`: boolean CLI flags become camelCase booleans (`--list` → `list: true`, `--include-version` → `includeVersion: true`); never send `--flag` names. Positional CLI arguments are republished as ordinary named parameters. When the response lists `subcommands`, pass your chosen value in `opts` and call this tool again with that value as `subcommand` for the full per-subcommand surface. Parameters a Pathfinder tool already takes as its own argument are omitted and rejected if sent. For pathfinder_manage_block and pathfinder_manage_guide, `command` is the same value as `operation`. Omit command for the command list.',
      annotations: readOnly('Show Pathfinder help'),
      inputSchema: {
        command: z
          .string()
          .optional()
          .describe(
            'CLI command name (e.g. "create", "add-block", "add-step", "edit-block", "inspect", "schema"). Omit for the command list. For pathfinder_manage_block and pathfinder_manage_guide, pass the same string as that tool\'s `operation`. Do not pass MCP tool names like "pathfinder_manage_block".'
          ),
        subcommand: z
          .string()
          .optional()
          .describe(
            'Optional sub-command — used for `add-block <type>` style help where the block type drills into per-type parameters.'
          ),
      },
    },
    async ({ command, subcommand }) => {
      if (!command) {
        // The manifest's summary, not a surface's rendering of it: the Commander
        // group root appends a table of `--flag` names to its description, and an
        // agent cannot send those.
        return textResult(
          renderMachineJson({
            commands: boundCommandNames().map((name) => ({ name, description: commandSummary(name) })),
          })
        );
      }

      const result = formatCommandInterface(command, subcommand);
      return textResult(renderMachineJson(result), isCommandInterfaceError(result));
    }
  );
}
