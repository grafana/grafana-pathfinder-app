/**
 * Pathfinder authoring MCP server subcommand (`pathfinder-cli mcp`).
 *
 * Two transports from one codebase:
 *   - `--transport stdio` (default) for local MCP clients (Cursor, Claude
 *     Desktop, MCP Inspector). The MCP client owns the process; auth is
 *     the user's local trust boundary.
 *   - `--transport http --port <n>` for centrally hosted deployment. Ships
 *     without auth in the MVP (see AI-AUTHORING-IMPLEMENTATION.md
 *     "Does the hosted HTTP MCP need auth at all?" — resolved 2026-04-30).
 *
 * The version reported here is intentionally the schema version, not a
 * separate package version — `pathfinder-cli mcp --version` reports the
 * schema version it supports, same as `pathfinder-cli --version`.
 */

import { z } from 'zod';

import { defineCommand } from '../contracts';
import type { CommandOutcome } from '../utils/output';

export const McpCommand = z.object({
  transport: z.enum(['stdio', 'http']).default('stdio').describe('Transport to bind').meta({ role: 'io' }),
  port: z.number().default(8080).describe('HTTP port (when --transport http)').meta({ role: 'io' }),
  host: z
    .string()
    .default('127.0.0.1')
    .describe(
      'HTTP bind host (when --transport http). Defaults to 127.0.0.1 so a local dev run is not exposed on the network; pass --host 0.0.0.0 in container deployments.'
    )
    .meta({ role: 'io' }),
});

export type McpInput = z.output<typeof McpCommand>;

/**
 * Serve until signalled. The transports are imported lazily so that registering
 * this subcommand does not pull the MCP server — and the tool modules that read
 * the command registry — into every `pathfinder-cli` invocation.
 */
export async function runMcp(args: McpInput): Promise<CommandOutcome> {
  if (args.transport === 'stdio') {
    const { runStdio } = await import('./transports/stdio');
    await runStdio();
    return { status: 'ok', summary: 'stdio transport attached' };
  }

  const { runHttp } = await import('./transports/http');
  const handle = await runHttp({ port: args.port, host: args.host });
  process.stderr.write(`pathfinder-cli mcp listening on http://${args.host}:${handle.port}/mcp\n`);
  process.stderr.write('sessions: in-memory, process-local — run a single instance (Cloud Run --max-instances=1)\n');

  let shuttingDown = false;
  const shutdown = (): void => {
    // Idempotent: a second SIGINT/SIGTERM while draining must not start a
    // second close() that races the first.
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    // Hard fallback: if close() hangs past 10s (e.g. a bug in the force-
    // close path), exit non-zero rather than burning the full container
    // grace period and making orchestrators wait for a SIGKILL.
    const fallback = setTimeout(() => process.exit(1), 10_000);
    fallback.unref();
    handle
      .close()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  return { status: 'ok', summary: `http transport listening on ${args.host}:${handle.port}` };
}

/**
 * What starting this server takes, and nothing about who asks. The command line renders
 * it as a subcommand of its own (see `cli-commands`); this module states the shape and
 * runs it, the same as any other spec.
 */
export const mcpSpec = defineCommand({
  name: 'mcp',
  summary: 'Pathfinder authoring MCP server',
  schema: McpCommand,
  // The server owns the process and speaks its own protocol on stdout.
  emits: 'stream',
  run: runMcp,
});
