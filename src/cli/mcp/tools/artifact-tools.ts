/**
 * Tools that produce a fresh artifact:
 *   - `pathfinder_create_package` opens a blank artifact for the standard
 *     authoring loop (then mutate via add_block / add_step / ...).
 *   - `pathfinder_create_guide_template` returns a pre-populated starter
 *     guide (markdown intro + one `section` placeholder) — the
 *     "scaffolded" alternative for agents that want a non-empty seed.
 *     Replaces the Go `create_guide_template` tool from `pkg/plugin/mcp.go`.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { runCreate } from '../../commands/create';
import { runValidate } from '../../commands/validate';
import { defaultPackageId } from '../../utils/auto-id';
import { newPackageState, buildArtifactSummary, readPackage } from '../../utils/package-io';
import type { ContentJson, ManifestJson } from '../../../types/package.types';
import { writeAppend } from './annotations';
import { outcomeResult } from './result';

export function registerArtifactTools(server: McpServer, _options: { sessionStore: import('../lib/session-store').SessionStore }): void {
  // _options.sessionStore is wired in a follow-up commit that adds the
  // session-mint branch to pathfinder_create_package.
  void _options;
  server.registerTool(
    'pathfinder_create_package',
    {
      description:
        'Use this tool when the user wants to start a new Grafana Pathfinder interactive guide, tutorial, or walkthrough. Returns a fresh authoring artifact ({ content, manifest }) for use as input to subsequent Pathfinder authoring tools.',
      annotations: writeAppend('Create Pathfinder package'),
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
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pathfinder-cli-mcp-create-'));
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

  server.registerTool(
    'pathfinder_create_guide_template',
    {
      description:
        'Use this tool when an agent wants a pre-populated starter guide instead of the blank artifact pathfinder_create_package returns. Produces a schema-valid guide with a markdown intro block and one section placeholder, plus a manifest with default category/author/testEnvironment fields. Output passes Pathfinder validation by construction.',
      annotations: writeAppend('Create Pathfinder guide template'),
      inputSchema: {
        id: z
          .string()
          .describe('Package id (kebab-case). Required; the template tool does not auto-derive an id from title.'),
        title: z.string().describe('Guide title shown to learners.'),
        description: z
          .string()
          .optional()
          .describe('Short description shown in catalogs. Defaults to the title when omitted.'),
        category: z.string().optional().describe('Manifest category. Defaults to "getting-started" when omitted.'),
      },
    },
    async ({ id, title, description, category }) => {
      const resolvedDescription = description ?? title;
      const resolvedCategory = category ?? 'getting-started';

      let state;
      try {
        state = newPackageState({ id, title, type: 'guide', description: resolvedDescription });
      } catch (err) {
        return outcomeResult({
          status: 'error',
          code: 'SCHEMA_VALIDATION',
          message: err instanceof Error ? err.message : String(err),
        });
      }

      const content = state.content as ContentJson & { blocks: unknown[] };
      content.blocks = [
        {
          type: 'markdown',
          id: 'markdown-1',
          content: `# ${title}\n\n${resolvedDescription}\n\nThis guide will walk you through the steps below.`,
        },
        {
          type: 'section',
          id: 'step-1',
          title: 'Step 1',
          blocks: [
            {
              type: 'markdown',
              id: 'markdown-2',
              content: 'Describe what to do in step 1.',
            },
          ],
        },
      ];

      const manifest = state.manifest as ManifestJson & Record<string, unknown>;
      manifest.title = title;
      manifest.category = resolvedCategory;
      manifest.path = `${id}/`;
      manifest.startingLocation = '/';
      manifest.author = { name: 'Your Name', team: 'Your Team' };
      manifest.testEnvironment = { tier: 'local', minVersion: '12.2.0' };

      const validation = runValidate({
        content,
        manifest,
        manifestSchemaVersionAuthored: true,
      });
      if (validation.status !== 'ok') {
        return outcomeResult(validation, { content, manifest }, buildArtifactSummary(content));
      }

      return outcomeResult(
        { status: 'ok', summary: 'Pre-populated guide template ready' },
        { content, manifest },
        buildArtifactSummary(content)
      );
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
