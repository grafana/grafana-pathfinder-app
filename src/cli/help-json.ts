/**
 * `--help --format json` for the command line.
 *
 * The CLI's own rendering of the help contract, which is why it lives on the CLI
 * side and takes a Commander `Command`: resolving *which* command the user asked
 * about is a parser concern. What gets published comes from what the command
 * declares, so this adds no facts of its own.
 *
 * Shared with the surface-parity harness so the snapshot covers what the CLI emits
 * rather than a parallel computation.
 */

import type { Command } from 'commander';

import { cliGroup, cliSpec } from './cli-commands';
import { CLI_VIEW, renderGroupInterface, renderInterface, type CommandSpec } from './contracts';
import type { HelpJson } from './utils/output';

export function helpJsonForCommand(command: Command): HelpJson {
  const group = cliGroup(command.name());
  if (group) {
    return renderGroupInterface(group, CLI_VIEW);
  }
  // A group's variants are `CommandSpec`s reached as subcommands, so a variant
  // renders through the ordinary spec path.
  const spec = cliSpec(command.name()) ?? variantSpec(command);
  return spec ? renderInterface(spec, CLI_VIEW) : namespaceHelpJson(command);
}

/** The spec behind a command that is a group variant, if it is one. */
function variantSpec(command: Command): CommandSpec | undefined {
  const parent = command.parent?.name();
  const group = parent ? cliGroup(parent) : undefined;
  return group?.variants.get(command.name());
}

/**
 * A command that only holds other commands — the root program, or a group root
 * reached before its variants. Reading `.commands` is not the projection this
 * refactor removed: it states no parameters, so there is nothing for it to
 * disagree with a schema about.
 */
function namespaceHelpJson(command: Command): HelpJson {
  return {
    command: command.name(),
    summary: command.description(),
    required: [],
    optional: [],
    subcommands: command.commands.map((child) => child.name()),
  };
}
