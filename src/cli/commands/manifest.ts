/**
 * The command manifest: every runner this package ships, in canonical order.
 *
 * Owned by the runners rather than by either surface. A surface asks the manifest what
 * commands exist and what each one declares; nothing here knows that Commander or MCP
 * exist — not even to the extent of listing a command that starts one, which is why
 * `mcp` is added by the command line and not found here. Neither surface can become the
 * other's source of truth, and the order is the order any listing publishes.
 *
 * A command appears here once, as the spec or group that declares its shape. The
 * Commander instance a command module also exports is a rendering of that entry,
 * not a second entry.
 */

import type { CommandGroupSpec, CommandSpec } from '../contracts';
import { addBlockGroup } from './add-block';
import { addChoiceSpec } from './add-choice';
import { addStepSpec } from './add-step';
import { buildGraphSpec } from './build-graph';
import { buildRepositorySpec } from './build-repository';
import { buildSnippetsSpec } from './build-snippets';
import { buildStatsSpec } from './build-stats';
import { createSpec } from './create';
import { e2eSpec } from './e2e';
import { editBlockSpec } from './edit-block';
import { inspectSpec } from './inspect';
import { moveBlockSpec } from './move-block';
import { removeBlockSpec } from './remove-block';
import { renameIdSpec } from './rename-id';
import { requirementsGroup } from './requirements';
import { schemaSpec } from './schema';
import { setManifestSpec } from './set-manifest';
import { validateCliSpec } from './validate';

/** One command as declared: a single shape, or a family selected by a discriminator. */
export type CommandEntry =
  { name: string; spec: CommandSpec; group?: never } | { name: string; spec?: never; group: CommandGroupSpec };

const entry = (value: CommandSpec | CommandGroupSpec): CommandEntry =>
  'variants' in value ? { name: value.name, group: value } : { name: value.name, spec: value };

export const COMMAND_MANIFEST: readonly CommandEntry[] = Object.freeze([
  // Authoring (P1).
  entry(createSpec),
  entry(addBlockGroup),
  entry(addStepSpec),
  entry(addChoiceSpec),
  entry(setManifestSpec),
  entry(inspectSpec),
  entry(editBlockSpec),
  entry(removeBlockSpec),
  // Structural edits (P2).
  entry(moveBlockSpec),
  entry(renameIdSpec),
  // Validation, build, schema export, e2e.
  entry(validateCliSpec),
  entry(e2eSpec),
  entry(buildRepositorySpec),
  entry(buildStatsSpec),
  entry(buildSnippetsSpec),
  entry(buildGraphSpec),
  entry(schemaSpec),
  entry(requirementsGroup),
]);

export const COMMAND_SPECS: ReadonlyMap<string, CommandSpec> = new Map(
  COMMAND_MANIFEST.flatMap(({ name, spec }) => (spec ? [[name, spec] as const] : []))
);

export const COMMAND_GROUPS: ReadonlyMap<string, CommandGroupSpec> = new Map(
  COMMAND_MANIFEST.flatMap(({ name, group }) => (group ? [[name, group] as const] : []))
);

/** Every command name, in manifest order. */
export function commandNames(): string[] {
  return COMMAND_MANIFEST.map((command) => command.name);
}

/** Is this a command at all? Membership is the manifest's answer, not a parser's. */
export function isCommand(name: string): boolean {
  return COMMAND_SPECS.has(name) || COMMAND_GROUPS.has(name);
}

/**
 * The command's one-line summary. Deliberately not a surface's rendering of it:
 * the Commander group root appends a flag table to its description, which is a
 * command-line convenience and not what the command is.
 */
export function commandSummary(name: string): string | undefined {
  const found = COMMAND_MANIFEST.find((command) => command.name === name);
  return (found?.spec ?? found?.group)?.summary;
}
