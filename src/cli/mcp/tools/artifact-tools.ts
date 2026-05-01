/**
 * Tools that produce a fresh artifact (`pathfinder_create_package`) and
 * the entrypoint that opens the per-call tmpdir bridge for mutation tools.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { runCreate } from '../../commands/create';
import { defaultPackageId } from '../../utils/auto-id';
import { buildArtifactSummary, readPackage } from '../../utils/package-io';
import { outcomeResult } from './result';

export function registerArtifactTools(server: McpServer): void {
  server.registerTool(
    'pathfinder_create_package',
    {
      description:
        'Create a fresh authoring artifact (content.json + manifest.json) for a new guide. Returns { content, manifest } for use as input to subsequent authoring tools.',
      inputSchema: {
        title: z.string().describe('Guide title shown to learners.'),
        id: z
          .string()
          .optional()
          .describe('Package id (kebab-case). Auto-generated from title with a random suffix if omitted.'),
        type: z.enum(['guide', 'path', 'journey']).default('guide').describe('Package type.'),
        description: z.string().optional().describe('Short description shown in catalogs.'),
      },
    },
    async ({ title, id, type, description }) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pathfinder-mcp-create-'));
      try {
        const pkgDir = path.join(dir, 'pkg');
        const finalId = id ?? deriveId(title);
        if (!finalId) {
          return outcomeResult({
            status: 'error',
            code: 'INVALID_TITLE',
            message:
              'Title must contain at least one alphanumeric character so an id can be generated. Pass id explicitly to override.',
          });
        }
        const outcome = await runCreate({ dir: pkgDir, id: finalId, title, type, description });
        if (outcome.status !== 'ok') {
          return outcomeResult(outcome);
        }
        const state = readPackage(pkgDir);
        return outcomeResult(
          outcome,
          { content: state.content, manifest: state.manifest },
          buildArtifactSummary(state.content)
        );
      } finally {
        try {
          fs.rmSync(dir, { recursive: true, force: true });
        } catch {
          // Best-effort cleanup.
        }
      }
    }
  );
}

function deriveId(title: string): string | null {
  try {
    return defaultPackageId(title);
  } catch {
    return null;
  }
}
