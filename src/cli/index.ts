#!/usr/bin/env node
/**
 * Pathfinder CLI
 *
 * Command-line tool for validating, building, and authoring guide packages.
 *
 * The CLI version is intentionally pinned to `CURRENT_SCHEMA_VERSION` —
 * `pathfinder-cli@1.2.0` means "supports schema 1.2.0". Authoring commands
 * stamp this version into every `content.json` and `manifest.json` they
 * produce so packages are tagged with the CLI version that built them.
 */

import { Command, Option } from 'commander';

import { CURRENT_SCHEMA_VERSION } from '../types/json-guide.schema';
import { COMMANDER_COMMANDS } from './cli-commands';
import { helpJsonForCommand } from './help-json';

const program = new Command();

program
  .name('pathfinder-cli')
  .description('CLI tools for Grafana Pathfinder plugin')
  .version(CURRENT_SCHEMA_VERSION)
  // Global output flags — every authoring command reads these via
  // `readOutputOptions`, which walks up the parent chain.
  .addOption(
    new Option('--quiet', 'Reduce output to a single confirmation line per call (terse mode for agents)').default(false)
  )
  .addOption(
    new Option('--format <format>', 'Output format for command responses').choices(['text', 'json']).default('text')
  );

// `--help --format json` is a stability contract — when the user requests
// help with the JSON format, emit the structured shape the P3 MCP layer
// will pass through verbatim instead of Commander's default text help.
//
// Hooked via the `preActionHook` chain rather than per-command override
// because Commander resolves --help before the action runs; we install a
// pre-help interceptor on every command in the tree below after registration.
function attachJsonHelpHook(cmd: Command): void {
  const originalHelpInformation = cmd.helpInformation.bind(cmd);
  // Commander's `helpInformation` signature accepts an optional context with
  // a required `error` boolean inside; cast through `any` because the
  // override needs to forward whatever Commander hands it without forcing
  // every caller to supply it. The error path doesn't matter for JSON help
  // — we always emit to the same stream.
  cmd.helpInformation = ((context?: unknown) => {
    let cursor: Command | null = cmd;
    while (cursor) {
      const opts = cursor.opts() as { format?: string };
      if (opts.format === 'json') {
        return JSON.stringify(helpJsonForCommand(cmd), null, 2) + '\n';
      }
      cursor = cursor.parent ?? null;
    }
    return originalHelpInformation(context as Parameters<typeof originalHelpInformation>[0]);
  }) as Command['helpInformation'];
  for (const child of cmd.commands) {
    attachJsonHelpHook(child);
  }
}

// Registration order is the manifest's, so `--help` lists commands in the order the
// runners declare them, followed by what the command line adds itself.
for (const command of COMMANDER_COMMANDS.values()) {
  program.addCommand(command);
}

// Walk the entire command tree (including nested add-block subcommands) and
// install the JSON help hook. Called after all addCommand() so every node is
// reachable.
attachJsonHelpHook(program);

// `parseAsync` (not `parse`) because at least one registered subcommand —
// `mcp` — has an async action handler. With `parse()`, a rejection from
// `runStdio()` / `runHttp()` (e.g. `EADDRINUSE`, stdio init failure) would
// escape as an unhandled promise rejection and surface as a raw Node crash
// instead of the clean single-line error message below. Commander's docs
// are explicit: if any action handler is async, use `.parseAsync()`.
program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(`pathfinder-cli: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
