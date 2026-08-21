/**
 * Contract: cli-routed
 *
 * Thin wrap of CLI `inspect`. Agents copy `opts` from pathfinder_help; `dir`
 * is withheld (tmpdir). `artifact` | `sessionToken` is shared MCP plumbing
 * around `runInspect`, not a second command interface.
 *
 * Canonical "pull the full artifact" escape hatch in session mode.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { runInspect } from '../../commands/inspect';
import { registerCommandInterfaceConfig, validateCommandArgs } from '../lib/command-interface';
import type { AuthoringSessionStore } from '../lib/session-store';
import { readOnly } from './annotations';
import { resolveReadOnlyInput } from './read-input';
import { outcomeResult, withToolErrorEnvelope } from './result';
import { withArtifact } from './state-bridge';
import { ArtifactInputBase, SessionTokenBase } from './two-mode-input';

const ArtifactSchema = ArtifactInputBase.describe(
  'STATELESS MODE. Pass an in-flight artifact directly. Pass EITHER `artifact` OR `sessionToken`, not both.'
);

const SessionTokenSchema = SessionTokenBase.describe(
  'SESSION MODE. Token returned by pathfinder_create_package. The server loads the artifact from session storage.'
);

const InspectOptsSchema = z
  .record(z.string(), z.unknown())
  .optional()
  .default({})
  .describe(
    'Optional parameters keyed exactly as pathfinder_help({ command: "inspect" }) returns them. Omit or pass {} for the default full-artifact view.'
  );

export function registerInspectTool(
  server: McpServer,
  options: { sessionStore: AuthoringSessionStore; mcpSessionId?: string }
): void {
  const { sessionStore, mcpSessionId } = options;
  registerCommandInterfaceConfig('inspect', { optBlacklist: ['dir'] });

  server.registerTool(
    'pathfinder_inspect',
    {
      description:
        'Use this tool when you need to read the current state of an in-flight Pathfinder authoring artifact — tree summary, block lookup by id, or array enumeration at a JSONPath. Read-only. Call pathfinder_help({ command: "inspect" }) for the `opts` interface. Pass `artifact` for stateless mode or `sessionToken` for session mode (the full artifact returns to your context in either case — this is the explicit "pull the artifact" escape hatch).',
      annotations: readOnly('Inspect Pathfinder artifact'),
      inputSchema: {
        artifact: ArtifactSchema,
        sessionToken: SessionTokenSchema,
        opts: InspectOptsSchema,
      },
    },
    async ({ artifact, sessionToken, opts }) => {
      const bag = opts ?? {};
      const rejected = validateCommandArgs('inspect', bag);
      if (rejected) {
        return rejected;
      }
      return withToolErrorEnvelope(sessionToken, 'inspect', async () => {
        const resolved = await resolveReadOnlyInput(sessionStore, { artifact, sessionToken }, mcpSessionId);
        if (!resolved.ok) {
          return resolved.response;
        }
        const result = await withArtifact({ content: resolved.content, manifest: resolved.manifest }, (dir) =>
          runInspect({ dir, blockId: bag.block as string | undefined, at: bag.at as string | undefined })
        );
        return outcomeResult(result.outcome, result.artifact, result.summary);
      });
    }
  );
}
