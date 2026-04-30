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

import { registerArtifactTools } from './artifact-tools';
import { registerAuthoringStart } from './authoring-start';
import { registerFinalizeTool } from './finalize';
import { registerHelpTool } from './help';
import { registerInspectionTools } from './inspection-tools';
import { registerMutationTools } from './mutation-tools';

export function registerAuthoringTools(server: McpServer): void {
  registerAuthoringStart(server);
  registerHelpTool(server);
  registerArtifactTools(server);
  registerMutationTools(server);
  registerInspectionTools(server);
  registerFinalizeTool(server);
}
