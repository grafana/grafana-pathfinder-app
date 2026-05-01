/**
 * Pathfinder authoring MCP server.
 *
 * Builds an `McpServer` instance and registers every authoring tool against
 * it. Transport binding is the caller's job — `stdio.ts` and `http.ts` import
 * `buildServer` and connect their respective transports.
 *
 * The server holds no state of its own. Every tool is a stateless function
 * call against an in-flight artifact passed in by the client (see
 * AUTHORING-SESSION-ARTIFACTS.md). Schema validation is delegated to the CLI
 * `runX` functions; this layer never imports a Zod schema for a guide block.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { CURRENT_SCHEMA_VERSION } from '../../types/json-guide.schema';
import { registerAuthoringTools } from './tools';
import { instrumentServer, type ToolCallInstrumentation } from './transports/instrumentation';

export interface BuildServerOptions {
  /** Override the advertised server name (used in tests). */
  name?: string;
  /**
   * Optional callback invoked once per resolved tool call with structured
   * observations (tool name, error flag, artifact byte sizes, parsed
   * outcome status). Wired by the HTTP transport to populate access-log
   * fields the wire-level byte counters can't see; stdio passes nothing.
   */
  instrumentation?: ToolCallInstrumentation;
}

export function buildServer(options: BuildServerOptions = {}): McpServer {
  const server = new McpServer(
    {
      name: options.name ?? 'pathfinder-mcp',
      version: CURRENT_SCHEMA_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  if (options.instrumentation) {
    instrumentServer(server, options.instrumentation);
  }

  registerAuthoringTools(server);

  return server;
}
