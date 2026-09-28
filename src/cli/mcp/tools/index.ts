/**
 * Pathfinder authoring MCP tool registry.
 *
 * Each module's first line is `Contract: mcp-native | cli-routed`:
 *
 * - **mcp-native** — the tool's behavior and schema live here. Explicit Zod;
 *   no pathfinder_help / `opts`. Includes discovery (`pathfinder_help`).
 * - **cli-routed** — a thin wrap of a CLI `runX`. Agents copy `opts` from
 *   pathfinder_help; MCP adds only shared plumbing (tmpdir, session
 *   transport) around the runner.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { AuthoringSessionStore } from '../lib/session-store';
import { registerArtifactTools } from './artifact-tools';
import { registerAuthoringStart } from './authoring-start';
import { registerFinalizeTool } from './finalize';
import { registerHelpTool } from './help';
import { registerInspectTool } from './inspect';
import { registerMutationTools } from './mutation-tools';
import { registerRepositoryTools } from './repository-tools';
import { registerSchemaTools } from './schema-tools';
import { registerSessionReadTools } from './session-read-tools';
import { registerValidateTool } from './validate';

export interface RegisterAuthoringToolsOptions {
  /**
   * Session store used by the session-mode branch of every mutation /
   * inspection / read tool. Stateless `{artifact}` mode does not consult
   * the store; tools that only support artifact mode ignore this option.
   */
  sessionStore: AuthoringSessionStore;
  /**
   * Transport-layer Mcp-Session-Id header value for this request (HTTP only).
   * Threaded through to session-mode tools so they can bind the pin on mint
   * and check it on subsequent calls. See `lib/session-pin.ts`.
   */
  mcpSessionId?: string;
}

export function registerAuthoringTools(server: McpServer, options: RegisterAuthoringToolsOptions): void {
  // mcp-native — MCP-owned behavior
  registerAuthoringStart(server);
  registerHelpTool(server);
  registerValidateTool(server, options);
  registerSessionReadTools(server, options);
  registerFinalizeTool(server, options);
  registerRepositoryTools(server);

  // cli-routed — thin wrap of CLI runX
  registerSchemaTools(server);
  registerArtifactTools(server, options);
  registerMutationTools(server, options);
  registerInspectTool(server, options);
}
