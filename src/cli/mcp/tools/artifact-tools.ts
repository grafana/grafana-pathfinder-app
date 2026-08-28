/**
 * Contract: cli-routed
 *
 * Thin wrap of CLI `create`. Agents copy `opts` from pathfinder_help; `dir`
 * is withheld (tmpdir). Session minting and the create-time wire shape are
 * shared MCP plumbing around `runCreate`, not a second command interface.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { createSpec } from '../../commands/create';
import { parseCommandInput } from '../../contracts';
import { buildArtifactSummary, readPackage, type TreeNode } from '../../utils/package-io';
import { MCP_TMPDIR_PREFIX } from '../lib/constants';
import { bindCommandInterface, validateCommandArgs } from '../lib/command-interface';
import { generateSessionToken } from '../lib/session-token';
import { SESSION_GENERATION_ABSENT, type SessionArtifact, type AuthoringSessionStore } from '../lib/session-store';
import { type CommandOutcome, renderMachineJson } from '../../utils/output';
import { ARTIFACT_ETAG_FIELD, computeArtifactEtag } from '../../utils/etag';
import { writeAppend } from './annotations';
import { sanitizeOutcomeForMcp, outcomeResult, textResult, withToolErrorEnvelope, type ToolResult } from './result';

export function registerArtifactTools(
  server: McpServer,
  options: { sessionStore: AuthoringSessionStore; mcpSessionId?: string }
): void {
  const { sessionStore, mcpSessionId } = options;
  bindCommandInterface('create');

  server.registerTool(
    'pathfinder_create_package',
    {
      description:
        'Use this tool when the user wants to start a new Grafana Pathfinder interactive guide, tutorial, or walkthrough. Call pathfinder_help({ command: "create" }) for the `opts` interface. Returns a sessionToken (for session-mode authoring) AND the seed artifact (for stateless-mode authoring) — clients pick the mode that suits them on subsequent mutation calls.',
      annotations: writeAppend('Create Pathfinder package'),
      inputSchema: {
        opts: z
          .record(z.string(), z.unknown())
          .describe('Parameters keyed exactly as pathfinder_help({ command: "create" }) returns them.'),
      },
    },
    async ({ opts }) => {
      const rejected = validateCommandArgs('create', opts);
      if (rejected) {
        return rejected;
      }
      return withToolErrorEnvelope(undefined, 'create_package', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${MCP_TMPDIR_PREFIX}create-`));
        try {
          const pkgDir = path.join(dir, 'pkg');
          // Id minting, the `type` fallback, and the INVALID_TITLE report all live in
          // the runner, so this binding states nothing about the command's shape. It
          // used to restate all three, with its own INVALID_TITLE wording.
          const parsed = parseCommandInput(createSpec, { ...opts, dir: pkgDir });
          if (!parsed.ok) {
            return outcomeResult(parsed.outcome);
          }
          const outcome = await createSpec.run(parsed.value);
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
      });
    }
  );
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
): ToolResult {
  const payload: Record<string, unknown> = {
    ...sanitizeOutcomeForMcp(outcome),
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
