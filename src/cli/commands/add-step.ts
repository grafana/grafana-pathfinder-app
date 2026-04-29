/**
 * `pathfinder-cli add-step <dir> --parent <id> [flags]` — append a step to a
 * multistep or guided block. Flags are derived from `JsonStepSchema`.
 */

import { Command, Option } from 'commander';

import { JsonStepSchema } from '../../types/json-guide.schema';
import type { JsonStep } from '../../types/json-guide.types';
import { assertCliStepFields, CliValidationError } from '../utils/cli-validators';
import { appendStep, mutateAndValidate, PackageIOError } from '../utils/package-io';
import {
  issueToOutcome,
  manyIssuesOutcome,
  printOutcome,
  readOutputOptions,
  renderError,
  type CommandOutcome,
} from '../utils/output';
import { parseOptionValues, registerSchemaOptions } from '../utils/schema-options';

export const addStepCommand = new Command('add-step')
  .description('Append a step to a multistep or guided block')
  .argument('<dir>', 'package directory')
  .addOption(new Option('--parent <id>', 'Parent multistep or guided block id').makeOptionMandatory());

// JsonStepSchema is `.refine()`-wrapped; .shape stays accessible in Zod v4.
registerSchemaOptions(addStepCommand, JsonStepSchema as unknown as Parameters<typeof registerSchemaOptions>[1]);

addStepCommand.action(async function (this: Command, dir: string) {
  const opts = this.opts() as Record<string, unknown>;
  const output = readOutputOptions(this);
  const outcome = await runAddStep({
    dir,
    parentId: String(opts.parent),
    flagValues: opts,
  });
  process.exit(printOutcome(outcome, output));
});

interface AddStepArgs {
  dir: string;
  parentId: string;
  flagValues: Record<string, unknown>;
}

export async function runAddStep(args: AddStepArgs): Promise<CommandOutcome> {
  const projected = parseOptionValues(
    JsonStepSchema as unknown as Parameters<typeof parseOptionValues>[0],
    args.flagValues
  ) as Record<string, unknown>;
  delete projected.parent;

  try {
    assertCliStepFields(projected);
  } catch (err) {
    if (err instanceof CliValidationError) {
      return { status: 'error', code: 'SCHEMA_VALIDATION', message: err.message };
    }
    throw err;
  }

  const candidate = JsonStepSchema.safeParse(projected);
  if (!candidate.success) {
    return manyIssuesOutcome(candidate.error.issues, 'step');
  }

  let position = '';
  let legacyIdsMinted = 0;
  try {
    const result = await mutateAndValidate(args.dir, ({ content }) => {
      const r = appendStep(content, candidate.data as JsonStep, args.parentId);
      position = r.position;
    });
    if (!result.validation.ok) {
      const first = result.validation.issues[0];
      return first
        ? issueToOutcome(first, { issues: result.validation.issues })
        : { status: 'error', code: 'SCHEMA_VALIDATION', message: 'Validation failed after append' };
    }
    legacyIdsMinted = result.state.idsAssignedOnRead ?? 0;
  } catch (err) {
    if (err instanceof PackageIOError) {
      return issueToOutcome(err.issues[0] ?? { code: err.code, message: err.message });
    }
    return {
      status: 'error',
      code: 'SCHEMA_VALIDATION',
      message: renderError(err),
    };
  }

  return {
    status: 'ok',
    summary: `Added step (action: ${String(candidate.data.action)}) to "${args.parentId}" at ${position}`,
    details: {
      action: String(candidate.data.action),
      position,
      'package valid': true,
      ...(legacyIdsMinted > 0 ? { 'ids minted on legacy blocks': legacyIdsMinted } : {}),
    },
    hints: [
      `Add another step with: pathfinder-cli add-step ${args.dir} --parent ${args.parentId} --action <action>`,
      `Or move on with: pathfinder-cli add-block <type> ${args.dir}`,
    ],
    data: {
      position,
      parent: args.parentId,
      ...(legacyIdsMinted > 0 ? { idsAssignedOnRead: legacyIdsMinted } : {}),
    },
  };
}
