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

import type { SessionStore } from '../lib/session-store';
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
   * inspection / read tool (P7). Stateless `{artifact}` mode does not
   * consult the store; tools that only support artifact mode ignore this
   * option.
   */
  sessionStore: SessionStore;
}

export function registerAuthoringTools(server: McpServer, options: RegisterAuthoringToolsOptions): void {
  registerAuthoringStart(server);
  registerHelpTool(server);
  registerArtifactTools(server, options);
  registerMutationTools(server, options);
  registerInspectionTools(server, options);
  registerSessionReadTools(server, options);
  registerFinalizeTool(server);
  registerRepositoryTools(server);
  registerSchemaTools(server);
}
