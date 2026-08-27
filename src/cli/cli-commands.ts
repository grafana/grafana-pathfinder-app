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
import {
  mountCommander,
  mountCommanderGroup,
  type CommanderPresentation,
  type CommandGroupSpec,
  type CommandSpec,
} from './contracts';
import { addBlockGroup } from './commands/add-block';
import { addChoiceSpec } from './commands/add-choice';
import { addStepSpec } from './commands/add-step';
import { buildGraphSpec } from './commands/build-graph';
import { buildRepositorySpec } from './commands/build-repository';
import { buildSnippetsSpec } from './commands/build-snippets';
import { buildStatsSpec } from './commands/build-stats';
import { createSpec } from './commands/create';
import { e2eSpec } from './commands/e2e';
import { editBlockSpec } from './commands/edit-block';
import { inspectSpec } from './commands/inspect';
import { moveBlockSpec } from './commands/move-block';
import { removeBlockSpec } from './commands/remove-block';
import { renameIdSpec } from './commands/rename-id';
import { requirementsGroup } from './commands/requirements';
import { schemaSpec } from './commands/schema';
import { setManifestSpec } from './commands/set-manifest';
import { validateCliSpec } from './commands/validate';
import { CURRENT_SCHEMA_VERSION } from '../types/json-guide.schema';
import { mcpSpec } from './mcp';

/** Declared by this surface rather than by the manifest, and rendered the same way. */
const SURFACE_ENTRIES: readonly CommandEntry[] = Object.freeze([{ name: mcpSpec.name, spec: mcpSpec }]);

/**
 * How each command reads as a command line: positionals, placeholders, short flags,
 * hidden options, and inheritance. Every entry names schema fields, checked at mount
 * time, so a rename that misses its presentation fails immediately.
 *
 * This is the single source of truth for command-line presentation. Command files
 * export specs only; mounting them into Commander objects happens here.
 */
const PRESENTATIONS: Record<string, CommanderPresentation> = {
  create: { positionals: ['dir'], placeholders: { type: 'type' } },
  'add-block': {
    positionals: ['dir'],
    placeholders: { parent: 'id', branch: 'branch', before: 'id', after: 'id', position: 'n' },
  },
  'add-step': { positionals: ['dir'], placeholders: { parent: 'id' } },
  'add-choice': { positionals: ['dir'], placeholders: { parent: 'id' } },
  'set-manifest': {
    positionals: ['dir'],
    // `<semver>`, `<platform>`, and `<json>` read better than the type-derived `<string>`.
    placeholders: { testMinVersion: 'semver', targetPlatform: 'platform', targetAnd: 'json' },
  },
  inspect: { positionals: ['dir'], placeholders: { block: 'id', at: 'jsonpath' } },
  'edit-block': {
    positionals: ['dir', 'id'],
    placeholders: { position: 'n', before: 'id', after: 'id' },
    // The reorder guards parse in order to refuse; listing them in help would
    // advertise a capability this command does not have.
    hidden: ['position', 'before', 'after'],
  },
  'remove-block': { positionals: ['dir', 'id'] },
  'move-block': {
    positionals: ['dir', 'id'],
    placeholders: { before: 'id', after: 'id', position: 'n', toPosition: 'n', into: 'containerId' },
    hidden: ['toPosition'],
  },
  'rename-id': {
    positionals: ['dir', 'newId'],
    // `<new-id>` keeps the hyphenated spelling the usage line has always shown.
    placeholders: { newId: 'new-id' },
  },
  validate: {
    positionals: ['files'],
    placeholders: { files: 'files...', format: 'format', package: 'dir', packages: 'dir' },
    inherits: ['format'],
  },
  e2e: {
    positionals: ['files'],
    placeholders: {
      files: 'files...',
      grafanaUrl: 'url',
      output: 'path',
      artifacts: 'dir',
      package: 'dirOrId',
      tier: 'tier',
      cleanReadyTimeoutMs: 'ms',
      repository: 'path',
      repoUrl: 'url',
      resolverUrl: 'url',
      cloudInstanceAdminToken: 'host=envVar',
      cloudUrl: 'url',
      cloudStackPoolManagerUrl: 'url',
      cloudStackPoolManagerToken: 'envVar',
      cloudStackPoolId: 'id',
      cloudStackMaxWaitSeconds: 'seconds',
    },
    // These six have printed `(default: false)` since they were hand-declared.
    showDefaults: { verbose: true, trace: true, headed: true, alwaysScreenshot: true, clean: true, remote: true },
  },
  'build-repository': {
    positionals: ['root'],
    placeholders: { output: 'file', exclude: 'paths...' },
    shorts: { output: 'o', exclude: 'e' },
  },
  'build-stats': {
    positionals: ['root'],
    placeholders: { exclude: 'paths...' },
    shorts: { exclude: 'e' },
  },
  'build-snippets': {
    positionals: ['dir'],
    placeholders: { output: 'file' },
    shorts: { output: 'o' },
  },
  'build-graph': {
    positionals: ['repositories'],
    placeholders: { repositories: 'repositories...', output: 'file' },
    shorts: { output: 'o' },
    negatable: { lint: 'Suppress lint output' },
  },
  schema: { positionals: ['name'] },
  requirements: {
    omitted: ['format', 'quiet'],
    inherits: ['format', 'quiet'],
  },
  mcp: {
    placeholders: { transport: 'transport', port: 'port', host: 'host' },
  },
};

const ENTRIES: readonly CommandEntry[] = Object.freeze([...COMMAND_MANIFEST, ...SURFACE_ENTRIES]);

// Mount all commands from their specs and presentations.
const RENDERED: Record<string, Command> = {
  create: mountCommander(createSpec, PRESENTATIONS.create),
  'add-block': mountCommanderGroup(addBlockGroup, PRESENTATIONS['add-block']),
  'add-step': mountCommander(addStepSpec, PRESENTATIONS['add-step']),
  'add-choice': mountCommander(addChoiceSpec, PRESENTATIONS['add-choice']),
  'set-manifest': mountCommander(setManifestSpec, PRESENTATIONS['set-manifest']),
  inspect: mountCommander(inspectSpec, PRESENTATIONS.inspect),
  'edit-block': mountCommander(editBlockSpec, PRESENTATIONS['edit-block']),
  'remove-block': mountCommander(removeBlockSpec, PRESENTATIONS['remove-block']),
  'move-block': mountCommander(moveBlockSpec, PRESENTATIONS['move-block']),
  'rename-id': mountCommander(renameIdSpec, PRESENTATIONS['rename-id']),
  validate: mountCommander(validateCliSpec, PRESENTATIONS.validate),
  e2e: mountCommander(e2eSpec, PRESENTATIONS.e2e),
  'build-repository': mountCommander(buildRepositorySpec, PRESENTATIONS['build-repository']),
  'build-stats': mountCommander(buildStatsSpec, PRESENTATIONS['build-stats']),
  'build-snippets': mountCommander(buildSnippetsSpec, PRESENTATIONS['build-snippets']),
  'build-graph': mountCommander(buildGraphSpec, PRESENTATIONS['build-graph']),
  schema: mountCommander(schemaSpec, PRESENTATIONS.schema),
  requirements: mountCommanderGroup(requirementsGroup, PRESENTATIONS.requirements),
  mcp: mountCommander(mcpSpec, PRESENTATIONS.mcp).version(CURRENT_SCHEMA_VERSION),
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
