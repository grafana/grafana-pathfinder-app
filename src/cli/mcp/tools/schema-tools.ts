/**
 * Contract: cli-routed
 *
 * Thin wrap of CLI `schema`. Agents copy `opts` from pathfinder_help. No
 * artifact / sessionToken envelope — the runner is the whole tool.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { exportAllSchemas, exportSchema, listSchemas, SCHEMA_REGISTRY } from '../../commands/schema';
import { renderMachineJson } from '../../utils/output';
import { registerCommandInterfaceConfig, validateCommandArgs } from '../lib/command-interface';
import { readOnly } from './annotations';
import { outcomeResult, textResult } from './result';

const SCHEMA_NAMES = Object.keys(SCHEMA_REGISTRY);

export function registerSchemaTools(server: McpServer): void {
  registerCommandInterfaceConfig('schema', {});

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
      const includeVersion = opts.includeVersion === true;

      if (opts.list === true) {
        return textResult(renderMachineJson({ schemas: listSchemas() }));
      }
      if (opts.all === true) {
        return textResult(renderMachineJson({ schemas: exportAllSchemas(includeVersion), available: SCHEMA_NAMES }));
      }

      const name = typeof opts.name === 'string' ? opts.name : undefined;
      if (!name) {
        return outcomeResult({
          status: 'error',
          code: 'MISSING_NAME',
          message: `Please specify a schema name, or set list: true or all: true in opts. Available: ${SCHEMA_NAMES.join(', ')}.`,
        });
      }

      const schema = exportSchema(name, includeVersion);
      if (!schema) {
        return outcomeResult({
          status: 'error',
          code: 'UNKNOWN_SCHEMA',
          message: `Unknown schema "${name}". Available: ${SCHEMA_NAMES.join(', ')}.`,
        });
      }
      return textResult(renderMachineJson({ name, schema }));
    }
  );
}
