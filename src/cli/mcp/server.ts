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
import { InMemorySessionStore, type SessionStore } from './lib/session-store';
import { SERVER_INSTRUCTIONS } from './lib/server-instructions';
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
  /**
   * Session store for the P7 session-mode branch of mutation / inspection
   * tools. When omitted, a fresh process-local `InMemorySessionStore` is
   * used — the safe default for tests and short-lived stdio sessions.
   *
   * Production transports (stdio + http) resolve the env-driven store via
   * `getDefaultSessionStore()` at startup and pass it here so every
   * request handler shares one backend. Tests pass a dedicated store for
   * isolation.
   */
  sessionStore?: SessionStore;
  /**
   * P7 task 16. Transport-layer `Mcp-Session-Id` header value for the
   * current request. HTTP transport extracts and threads it per request;
   * stdio omits it (the user's local trust boundary is the process
   * boundary). On session mint this value is persisted as a pin against
   * the new session token; on every subsequent session-mode call the
   * value is compared against the pin — a mismatch surfaces as
   * SESSION_NOT_FOUND. See `lib/session-pin.ts`.
   */
  mcpSessionId?: string;
}

export function buildServer(options: BuildServerOptions = {}): McpServer {
  const server = new McpServer(
    {
      name: options.name ?? 'pathfinder-cli-mcp',
      version: CURRENT_SCHEMA_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
      // M1 layer 3 — server-level instructions surfaced to MCP-aware clients
      // on `initialize`. Reaches the model before tool selection; covers
      // routing vocabulary (#7) plus the two highest-cost authoring rules
      // (#3 selector discipline, #8 multistep / noop composition).
      instructions: SERVER_INSTRUCTIONS,
    }
  );

  if (options.instrumentation) {
    instrumentServer(server, options.instrumentation);
  }

  const sessionStore = options.sessionStore ?? new InMemorySessionStore();
  registerAuthoringTools(server, { sessionStore, mcpSessionId: options.mcpSessionId });

  return server;
}
