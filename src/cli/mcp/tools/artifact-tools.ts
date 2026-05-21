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
import { newPackageState, buildArtifactSummary, readPackage, type TreeNode } from '../../utils/package-io';
import type { ContentJson, ManifestJson } from '../../../types/package.types';
import { generateSessionToken } from '../lib/session-token';
import {
  SESSION_GENERATION_ABSENT,
  SessionPreconditionFailedError,
  type SessionArtifact,
  type SessionStore,
} from '../lib/session-store';
import type { CommandOutcome } from '../../utils/output';
import { ARTIFACT_ETAG_FIELD, computeArtifactEtag } from '../../utils/etag';
import { writeAppend } from './annotations';
import { outcomeResult, textResult, withToolErrorEnvelope } from './result';

export function registerArtifactTools(
  server: McpServer,
  options: { sessionStore: SessionStore; mcpSessionId?: string }
): void {
  const { sessionStore, mcpSessionId } = options;
  server.registerTool(
    'pathfinder_create_package',
    {
      description:
        'Use this tool when the user wants to start a new Grafana Pathfinder interactive guide, tutorial, or walkthrough. Returns a sessionToken (for session-mode authoring) AND the seed artifact (for stateless-mode authoring) — clients pick the mode that suits them on subsequent mutation calls.',
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
    async ({ title, id, type, description }) =>
      withToolErrorEnvelope(undefined, 'create_package', async () => {
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
          const artifact = { content: state.content, manifest: state.manifest };
          const summary = buildArtifactSummary(state.content);

          // P7: mint a fresh session and persist the seed artifact. The
          // session token returned alongside the artifact is the agent's
          // handle for subsequent session-mode mutation calls. Token
          // generation collisions are vanishingly rare (~110 bits of
          // entropy) but we retry-on-conflict a few times just in case.
          const sessionToken = await mintSession(sessionStore, artifact);
          if (mcpSessionId !== undefined) {
            await sessionStore.bindMcpSessionId(sessionToken, mcpSessionId);
          }

          return sessionCreateResult(sessionToken, outcome, artifact, summary);
        } finally {
          try {
            fs.rmSync(dir, { recursive: true, force: true });
          } catch {
            // Best-effort cleanup.
          }
        }
      })
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
    async ({ id, title, description, category }) =>
      withToolErrorEnvelope(undefined, 'create_guide_template', async () => {
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

        const artifact = { content, manifest };
        const summary = buildArtifactSummary(content);
        const sessionToken = await mintSession(sessionStore, artifact);
        if (mcpSessionId !== undefined) {
          await sessionStore.bindMcpSessionId(sessionToken, mcpSessionId);
        }
        return sessionCreateResult(
          sessionToken,
          { status: 'ok', summary: 'Pre-populated guide template ready' },
          artifact,
          summary
        );
      })
  );
}

function deriveId(title: string): string | null {
  try {
    return defaultPackageId(title);
  } catch {
    return null;
  }
}

/**
 * Mint a fresh session token and persist `artifact` under it at
 * generation 1. Token collisions are vanishingly rare (~110 bits of
 * entropy); a few retries cover the cosmic-ray case.
 */
async function mintSession(store: SessionStore, artifact: SessionArtifact): Promise<string> {
  const MAX_ATTEMPTS = 4;
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const token = generateSessionToken();
    try {
      await store.save(token, artifact, SESSION_GENERATION_ABSENT);
      return token;
    } catch (err) {
      if (err instanceof SessionPreconditionFailedError) {
        // Token collision — try again with a fresh token.
        lastError = err;
        continue;
      }
      throw err;
    }
  }
  throw new Error(
    `mintSession: failed to mint a unique session token after ${MAX_ATTEMPTS} attempts ` +
      `(cause: ${lastError instanceof Error ? lastError.message : String(lastError)})`
  );
}

/**
 * Wire shape for the create-session output. Returns BOTH:
 *   - sessionToken + generation — for session-mode mutation flows.
 *   - artifact (with __etag) + summary — for stateless mutation flows.
 *
 * The agent picks the mode by what it passes on the next call. This is
 * the only create-time call that returns the full artifact; later
 * mutations under session-mode only return the ack.
 */
function sessionCreateResult(
  sessionToken: string,
  outcome: CommandOutcome,
  artifact: { content: unknown; manifest?: unknown },
  summary: TreeNode[]
): { content: Array<{ type: 'text'; text: string }>; isError?: boolean } {
  const payload: Record<string, unknown> = {
    ...outcome,
    sessionToken,
    generation: 1,
    artifact: {
      ...artifact,
      [ARTIFACT_ETAG_FIELD]: computeArtifactEtag(artifact),
    },
    summary,
  };
  return textResult(JSON.stringify(payload, null, 2), outcome.status === 'error');
}
