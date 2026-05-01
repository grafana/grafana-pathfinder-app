#!/usr/bin/env node
/**
 * Pathfinder authoring MCP server entrypoint (`pathfinder-mcp`).
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
 * separate package version — `pathfinder-mcp@1.1.0` means "supports
 * schema 1.1.0", same as the CLI.
 */

import { Command, Option } from 'commander';

import { CURRENT_SCHEMA_VERSION } from '../../types/json-guide.schema';
import { runHttp } from './transports/http';
import { runStdio } from './transports/stdio';

const program = new Command();

program
  .name('pathfinder-mcp')
  .description('Pathfinder authoring MCP server')
  .version(CURRENT_SCHEMA_VERSION)
  .addOption(new Option('--transport <transport>', 'Transport to bind').choices(['stdio', 'http']).default('stdio'))
  .addOption(
    new Option('--port <port>', 'HTTP port (when --transport http)').default('8080').argParser((v) => Number(v))
  )
  .addOption(
    new Option(
      '--host <host>',
      'HTTP bind host (when --transport http). Defaults to 127.0.0.1 so a local dev run is not exposed on the network; pass --host 0.0.0.0 in container deployments.'
    ).default('127.0.0.1')
  )
  .action(async function (this: Command) {
    const opts = this.opts() as { transport: 'stdio' | 'http'; port: number; host: string };

    if (opts.transport === 'stdio') {
      await runStdio();
      return;
    }

    const handle = await runHttp({ port: opts.port, host: opts.host });
    process.stderr.write(`pathfinder-mcp listening on http://${opts.host}:${handle.port}/mcp\n`);

    const shutdown = async (): Promise<void> => {
      try {
        await handle.close();
      } finally {
        process.exit(0);
      }
    };
    process.on('SIGINT', () => void shutdown());
    process.on('SIGTERM', () => void shutdown());
  });

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(`pathfinder-mcp: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
