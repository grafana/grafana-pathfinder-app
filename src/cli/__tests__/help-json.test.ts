/**
 * Unit tests for `helpJsonForCommand` — the function behind `--help --format
 * json` (`src/cli/index.ts`'s JSON help hook).
 *
 * The CHANGELOG's claim about this surface ("the bare `pathfinder-cli --help
 * --format json` reports the subcommand list rather than the root's own two
 * global flags") is specifically about the `namespaceHelpJson` branch below —
 * a command with no declared shape of its own. Other tests in this repo cover
 * `renderInterface`/`renderGroupInterface` directly, which pins the schema
 * rendering but not the wrapper that resolves a Commander `Command` to one.
 * These call `helpJsonForCommand` itself so a regression in that resolution —
 * wrong branch chosen, wrong name read off the command — fails here.
 */

import { Command } from 'commander';

import { cliGroup, cliSpec, COMMANDER_COMMANDS } from '../cli-commands';
import { CLI_VIEW, renderGroupInterface, renderInterface } from '../contracts';
import { helpJsonForCommand } from '../help-json';

describe('helpJsonForCommand', () => {
  it('renders a plain command the same way renderInterface does', () => {
    const command = COMMANDER_COMMANDS.get('create')!;
    const spec = cliSpec('create')!;
    expect(helpJsonForCommand(command)).toEqual(renderInterface(spec, CLI_VIEW));
  });

  it('renders a group root the same way renderGroupInterface does', () => {
    const command = COMMANDER_COMMANDS.get('add-block')!;
    const group = cliGroup('add-block')!;
    expect(helpJsonForCommand(command)).toEqual(renderGroupInterface(group, CLI_VIEW));
  });

  it('renders a group variant reached as a subcommand, as its own spec rather than the group', () => {
    const root = COMMANDER_COMMANDS.get('add-block')!;
    const markdown = root.commands.find((child) => child.name() === 'markdown')!;
    const group = cliGroup('add-block')!;
    const variantSpec = group.variants.get('markdown')!;
    expect(markdown).toBeDefined();
    // Unlike the MCP rendering (`renderGroupInterface(group, view, 'markdown')`), the
    // CLI does not republish the `type` discriminator here — `add-block markdown` has
    // already selected it via the subcommand name, so it is not a flag to pass.
    expect(helpJsonForCommand(markdown)).toEqual(renderInterface(variantSpec, CLI_VIEW));
    expect(helpJsonForCommand(markdown).required.map((f) => f.name)).not.toContain('type');
  });

  // A command with no declared shape of its own — the root program, or a group
  // root reached before a variant is chosen — only holds other commands.
  // `cliSpec`/`cliGroup` return nothing for a name the manifest never
  // declared, which is exactly the case a fake root exercises without
  // reaching into `index.ts` (which parses `process.argv` at import time).
  describe('a command with no declared shape', () => {
    it('reports its children as `subcommands`, with no parameters of its own', () => {
      const root = new Command('pathfinder-cli-test')
        .description('CLI tools for Grafana Pathfinder plugin')
        .addCommand(new Command('create'))
        .addCommand(new Command('add-block'));

      expect(helpJsonForCommand(root)).toEqual({
        command: 'pathfinder-cli-test',
        summary: 'CLI tools for Grafana Pathfinder plugin',
        required: [],
        optional: [],
        subcommands: ['create', 'add-block'],
      });
    });

    it('reports no subcommands for a leaf with no children and no schema', () => {
      const leaf = new Command('not-a-real-command');
      expect(helpJsonForCommand(leaf).subcommands).toEqual([]);
    });
  });
});
