/**
 * Pathfinder authoring MCP tool registry.
 *
 * One entry per MCP tool. Each tool is a thin dispatcher to a CLI `runX`
 * function — the CLI is the sole validator. The tool list intentionally
 * mirrors the CLI command surface plus three MCP-specific tools
 * (`pathfinder_authoring_start`, `pathfinder_help`,
 * `pathfinder_finalize_for_app_platform`).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { AuthoringSessionStore } from '../lib/session-store';
import { registerArtifactTools } from './artifact-tools';
import { registerAuthoringStart } from './authoring-start';
import { registerFinalizeTool } from './finalize';
import { registerHelpTool } from './help';
import { registerInspectionTools } from './inspection-tools';
import { registerMutationTools } from './mutation-tools';
import { registerRepositoryTools } from './repository-tools';
import { registerSchemaTools } from './schema-tools';
import { registerSessionReadTools } from './session-read-tools';

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
  registerAuthoringStart(server);
  registerHelpTool(server);
  registerArtifactTools(server, options);
  registerMutationTools(server, options);
  registerInspectionTools(server, options);
  registerSessionReadTools(server, options);
  registerFinalizeTool(server, options);
  registerRepositoryTools(server);
  registerSchemaTools(server);
}
