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
import { formatHelpAsJson } from './utils/output';
import { addBlockCommand } from './commands/add-block';
import { addChoiceCommand } from './commands/add-choice';
import { addStepCommand } from './commands/add-step';
import { buildGraphCommand } from './commands/build-graph';
import { buildRepositoryCommand } from './commands/build-repository';
import { createCommand } from './commands/create';
import { e2eCommand } from './commands/e2e';
import { editBlockCommand } from './commands/edit-block';
import { inspectCommand } from './commands/inspect';
import { removeBlockCommand } from './commands/remove-block';
import { schemaCommand } from './commands/schema';
import { setManifestCommand } from './commands/set-manifest';
import { validateCommand } from './commands/validate';

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
        return JSON.stringify(formatHelpAsJson(cmd), null, 2) + '\n';
      }
      cursor = cursor.parent ?? null;
    }
    return originalHelpInformation(context as Parameters<typeof originalHelpInformation>[0]);
  }) as Command['helpInformation'];
  for (const child of cmd.commands) {
    attachJsonHelpHook(child);
  }
}

// Authoring commands (P1).
program.addCommand(createCommand);
program.addCommand(addBlockCommand);
program.addCommand(addStepCommand);
program.addCommand(addChoiceCommand);
program.addCommand(setManifestCommand);
program.addCommand(inspectCommand);
program.addCommand(editBlockCommand);
program.addCommand(removeBlockCommand);

// Existing commands (validation, build, schema export, e2e).
program.addCommand(validateCommand);
program.addCommand(e2eCommand);
program.addCommand(buildRepositoryCommand);
program.addCommand(buildGraphCommand);
program.addCommand(schemaCommand);

// Walk the entire command tree (including nested add-block subcommands) and
// install the JSON help hook. Called after all addCommand() so every node is
// reachable.
attachJsonHelpHook(program);

program.parse(process.argv);
