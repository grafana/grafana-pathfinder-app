/**
 * `pathfinder_get_schema` — exposes the canonical Zod-derived JSON Schema for
 * Pathfinder authoring artifacts (guide, block, content, manifest, repository,
 * graph). Replaces the hand-maintained `guideSchemas` map that lived in
 * `pkg/plugin/mcp.go` (`get_guide_schema`) by wrapping the existing
 * `src/cli/commands/schema.ts` exports — so the TS Zod schema is now the
 * single source of truth for cross-language consumers.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { exportAllSchemas, exportSchema, listSchemas, SCHEMA_REGISTRY } from '../../commands/schema';
import { renderMachineJson } from '../../utils/output';
import { readOnly } from './annotations';
import { outcomeResult, textResult } from './result';

const SCHEMA_NAMES = Object.keys(SCHEMA_REGISTRY);
const SCHEMA_NAMES_LIST = SCHEMA_NAMES.join(', ');

export function registerSchemaTools(server: McpServer): void {
  server.registerTool(
    'pathfinder_get_schema',
    {
      description:
        'Use this tool when an agent or downstream consumer needs the canonical JSON Schema for a Pathfinder authoring artifact (guide, block, content, manifest, repository, graph). Returns the Zod-derived JSON Schema with refinement notes — the same schema the CLI validator enforces. Read-only.',
      annotations: readOnly('Get Pathfinder schema'),
      inputSchema: {
        name: z
          .string()
          .optional()
          .describe(
            `Name of the schema to export. One of: ${SCHEMA_NAMES_LIST}. Omit and pass mode="all" to return every schema, or mode="list" to enumerate available names.`
          ),
        mode: z
          .enum(['one', 'all', 'list'])
          .optional()
          .describe(
            'Output mode. "one" (default when name is supplied) returns a single schema. "all" returns every schema keyed by name. "list" returns the registry summary (name + description) without payloads.'
          ),
        includeVersion: z
          .boolean()
          .optional()
          .describe('Include x-schema-version metadata in returned schemas. Defaults to true.'),
      },
    },
    async ({ name, mode, includeVersion }) => {
      const wantVersion = includeVersion !== false;
      const resolvedMode = mode ?? (name ? 'one' : 'all');

      if (resolvedMode === 'list') {
        return textResult(renderMachineJson({ schemas: listSchemas() }));
      }

      if (resolvedMode === 'all') {
        return textResult(renderMachineJson({ schemas: exportAllSchemas(wantVersion), available: SCHEMA_NAMES }));
      }

      if (!name) {
        return outcomeResult({
          status: 'error',
          code: 'MISSING_NAME',
          message: `mode="one" requires a name. Available: ${SCHEMA_NAMES_LIST}.`,
        });
      }

      const schema = exportSchema(name, wantVersion);
      if (!schema) {
        return outcomeResult({
          status: 'error',
          code: 'UNKNOWN_SCHEMA',
          message: `Unknown schema "${name}". Available: ${SCHEMA_NAMES_LIST}.`,
        });
      }

      return textResult(renderMachineJson({ name, schema }));
    }
  );
}
