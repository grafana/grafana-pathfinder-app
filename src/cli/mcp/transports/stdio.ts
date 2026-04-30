/**
 * Stdio transport for the Pathfinder authoring MCP server.
 *
 * The default transport for local MCP clients (Cursor, Claude Desktop, MCP
 * Inspector). The MCP client owns the process lifecycle; auth is the user's
 * local trust boundary.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { buildServer } from '../server';

export async function runStdio(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Keep the process alive while the transport is open. The SDK closes the
  // transport when stdin EOFs (the parent client disconnected); when that
  // happens, exit cleanly.
  await new Promise<void>((resolve) => {
    transport.onclose = () => resolve();
  });
}
