/**
 * Tools that produce a fresh artifact:
 *   - `pathfinder_create_package` opens a blank artifact for the standard
 *     authoring loop (then mutate via pathfinder_manage_block / ...).
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { runCreate } from '../../commands/create';
import { defaultPackageId } from '../../utils/auto-id';
import { buildArtifactSummary, readPackage, type TreeNode } from '../../utils/package-io';
import { MCP_TMPDIR_PREFIX } from '../lib/constants';
import { generateSessionToken } from '../lib/session-token';
import { SESSION_GENERATION_ABSENT, type SessionArtifact, type AuthoringSessionStore } from '../lib/session-store';
import { type CommandOutcome, renderMachineJson } from '../../utils/output';
import { ARTIFACT_ETAG_FIELD, computeArtifactEtag } from '../../utils/etag';
import { writeAppend } from './annotations';
import { outcomeResult, textResult, withToolErrorEnvelope } from './result';

export function registerArtifactTools(
  server: McpServer,
  options: { sessionStore: AuthoringSessionStore; mcpSessionId?: string }
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
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${MCP_TMPDIR_PREFIX}create-`));
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
 * generation 1. The token is 110 bits of CSPRNG entropy; a collision
 * with an existing session is below cosmic-ray probability, so the
 * `ifGenerationMatch=ABSENT` save is treated as infallible from a
 * collision standpoint. Any error here (auth, storage outage) is
 * routed through `withToolErrorEnvelope` by the caller.
 */
async function mintSession(store: AuthoringSessionStore, artifact: SessionArtifact): Promise<string> {
  const token = generateSessionToken();
  await store.save(token, artifact, SESSION_GENERATION_ABSENT);
  return token;
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
  return textResult(renderMachineJson(payload), outcome.status === 'error');
}
