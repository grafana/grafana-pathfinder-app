/**
 * Map of CLI command name → Commander `Command` instance, built once on
 * import. Exposed for the MCP `pathfinder_help` tool so it can produce
 * the same `--help --format json` shape the CLI exposes without having
 * to rebuild a parallel program tree.
 *
 * The Command singletons themselves come from each command module — they
 * are the same instances `src/cli/index.ts` registers with the
 * `pathfinder-cli` program, so flag drift between the CLI and the MCP
 * help surface is structurally impossible.
 */

import type { Command } from 'commander';

import { addBlockCommand } from '../commands/add-block';
import { addChoiceCommand } from '../commands/add-choice';
import { addStepCommand } from '../commands/add-step';
import { buildGraphCommand } from '../commands/build-graph';
import { buildRepositoryCommand } from '../commands/build-repository';
import { createCommand } from '../commands/create';
import { e2eCommand } from '../commands/e2e';
import { editBlockCommand } from '../commands/edit-block';
import { inspectCommand } from '../commands/inspect';
import { moveBlockCommand } from '../commands/move-block';
import { removeBlockCommand } from '../commands/remove-block';
import { renameIdCommand } from '../commands/rename-id';
import { requirementsCommand } from '../commands/requirements';
import { schemaCommand } from '../commands/schema';
import { setManifestCommand } from '../commands/set-manifest';
import { validateCommand } from '../commands/validate';

export const CLI_COMMANDS: ReadonlyMap<string, Command> = new Map([
  ['create', createCommand],
  ['add-block', addBlockCommand],
  ['add-step', addStepCommand],
  ['add-choice', addChoiceCommand],
  ['set-manifest', setManifestCommand],
  ['inspect', inspectCommand],
  ['edit-block', editBlockCommand],
  ['remove-block', removeBlockCommand],
  ['move-block', moveBlockCommand],
  ['rename-id', renameIdCommand],
  ['validate', validateCommand],
  ['e2e', e2eCommand],
  ['build-repository', buildRepositoryCommand],
  ['build-graph', buildGraphCommand],
  ['schema', schemaCommand],
  ['requirements', requirementsCommand],
]);
