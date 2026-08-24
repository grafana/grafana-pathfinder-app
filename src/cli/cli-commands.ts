/**
 * What the command line offers: the manifest, plus what this surface adds itself.
 *
 * `mcp` is the whole of that addition, and the reason this layer exists. A command that
 * starts an adapter is a fact about the surface offering it, not a runner the package
 * ships — the manifest MCP reads has no business listing a way to launch MCP. So the
 * manifest stays adapter-free and the command line, which is where that subcommand is
 * actually useful, appends it here.
 *
 * Everything else is the manifest in its order, and a missing rendering is a startup
 * error rather than a command that silently vanishes from one surface.
 */

import type { Command } from 'commander';

import { COMMAND_MANIFEST, commandNames, type CommandEntry } from './commands/manifest';
import { mountCommander, type CommandGroupSpec, type CommandSpec } from './contracts';
import { addBlockCommand } from './commands/add-block';
import { addChoiceCommand } from './commands/add-choice';
import { addStepCommand } from './commands/add-step';
import { buildGraphCommand } from './commands/build-graph';
import { buildRepositoryCommand } from './commands/build-repository';
import { buildSnippetsCommand } from './commands/build-snippets';
import { buildStatsCommand } from './commands/build-stats';
import { createCommand } from './commands/create';
import { e2eCommand } from './commands/e2e';
import { editBlockCommand } from './commands/edit-block';
import { inspectCommand } from './commands/inspect';
import { moveBlockCommand } from './commands/move-block';
import { removeBlockCommand } from './commands/remove-block';
import { renameIdCommand } from './commands/rename-id';
import { requirementsCommand } from './commands/requirements';
import { schemaCommand } from './commands/schema';
import { setManifestCommand } from './commands/set-manifest';
import { validateCommand } from './commands/validate';
import { CURRENT_SCHEMA_VERSION } from '../types/json-guide.schema';
import { mcpSpec } from './mcp';

/** Declared by this surface rather than by the manifest, and rendered the same way. */
const SURFACE_ENTRIES: readonly CommandEntry[] = Object.freeze([{ name: mcpSpec.name, spec: mcpSpec }]);

// Rendered here rather than in `mcp/`, which then needs no Commander at all: the
// subcommand is this surface's way of offering the server, not part of serving.
const mcpCommand = mountCommander(mcpSpec, {
  placeholders: { transport: 'transport', port: 'port', host: 'host' },
}).version(CURRENT_SCHEMA_VERSION);

const ENTRIES: readonly CommandEntry[] = Object.freeze([...COMMAND_MANIFEST, ...SURFACE_ENTRIES]);

const RENDERED: Record<string, Command> = {
  create: createCommand,
  'add-block': addBlockCommand,
  'add-step': addStepCommand,
  'add-choice': addChoiceCommand,
  'set-manifest': setManifestCommand,
  inspect: inspectCommand,
  'edit-block': editBlockCommand,
  'remove-block': removeBlockCommand,
  'move-block': moveBlockCommand,
  'rename-id': renameIdCommand,
  validate: validateCommand,
  e2e: e2eCommand,
  'build-repository': buildRepositoryCommand,
  'build-stats': buildStatsCommand,
  'build-snippets': buildSnippetsCommand,
  'build-graph': buildGraphCommand,
  schema: schemaCommand,
  requirements: requirementsCommand,
  mcp: mcpCommand,
};

const missing = ENTRIES.filter(({ name }) => RENDERED[name] === undefined).map(({ name }) => name);
if (missing.length > 0) {
  throw new Error(`No Commander rendering for command(s): ${missing.join(', ')}.`);
}

const shadowed = SURFACE_ENTRIES.filter(({ name }) => commandNames().includes(name)).map(({ name }) => name);
if (shadowed.length > 0) {
  throw new Error(`Command(s) added by the command line collide with the manifest: ${shadowed.join(', ')}.`);
}

/** Every command the program registers, in registration order. */
export const COMMANDER_COMMANDS: ReadonlyMap<string, Command> = new Map(
  ENTRIES.map(({ name }) => [name, RENDERED[name]!])
);

/**
 * The spec or group behind a registered command, for the surface's own renderers —
 * `--help --format json` publishes what a command declares, and a command this surface
 * added declares it the same way the manifest's do.
 */
export function cliSpec(name: string): CommandSpec | undefined {
  return ENTRIES.find((command) => command.name === name)?.spec;
}

export function cliGroup(name: string): CommandGroupSpec | undefined {
  return ENTRIES.find((command) => command.name === name)?.group;
}
