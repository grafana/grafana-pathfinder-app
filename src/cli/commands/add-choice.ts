/**
 * `pathfinder-cli add-choice <dir> --parent <id> --id <a|b|c> --text <text>` —
 * append a choice to a quiz block. Flags are derived from `JsonQuizChoiceSchema`.
 */

import { Command, Option } from 'commander';

import { JsonQuizChoiceSchema } from '../../types/json-guide.schema';
import type { JsonQuizChoice } from '../../types/json-guide.types';
import { assertCliChoiceFields, CliValidationError } from '../utils/cli-validators';
import { appendChoice, mutateAndValidate, PackageIOError } from '../utils/package-io';
import { issueToOutcome, printOutcome, readOutputOptions, renderError, type CommandOutcome } from '../utils/output';
import { parseOptionValues, registerSchemaOptions } from '../utils/schema-options';

export const addChoiceCommand = new Command('add-choice')
  .description('Append a choice to a quiz block')
  .argument('<dir>', 'package directory')
  .addOption(new Option('--parent <id>', 'Quiz block id').makeOptionMandatory());

registerSchemaOptions(addChoiceCommand, JsonQuizChoiceSchema);

addChoiceCommand.action(async function (this: Command, dir: string) {
  const opts = this.opts() as Record<string, unknown>;
  const output = readOutputOptions(this);
  const outcome = await runAddChoice({ dir, parentId: String(opts.parent), flagValues: opts });
  process.exit(printOutcome(outcome, output));
});

interface AddChoiceArgs {
  dir: string;
  parentId: string;
  flagValues: Record<string, unknown>;
}

export async function runAddChoice(args: AddChoiceArgs): Promise<CommandOutcome> {
  const projected = parseOptionValues(JsonQuizChoiceSchema, args.flagValues) as Record<string, unknown>;
  delete projected.parent;

  try {
    assertCliChoiceFields(projected);
  } catch (err) {
    if (err instanceof CliValidationError) {
      return { status: 'error', code: 'SCHEMA_VALIDATION', message: err.message };
    }
    throw err;
  }

  const candidate = JsonQuizChoiceSchema.safeParse(projected);
  if (!candidate.success) {
    const first = candidate.error.issues[0];
    return {
      status: 'error',
      code: 'SCHEMA_VALIDATION',
      message: first ? `${first.path.join('.') || 'choice'}: ${first.message}` : 'Invalid choice',
    };
  }

  let position = '';
  try {
    const result = await mutateAndValidate(args.dir, ({ content }) => {
      const r = appendChoice(content, candidate.data as JsonQuizChoice, args.parentId);
      position = r.position;
    });
    if (!result.validation.ok) {
      const first = result.validation.issues[0];
      return first
        ? issueToOutcome(first, { issues: result.validation.issues })
        : { status: 'error', code: 'SCHEMA_VALIDATION', message: 'Validation failed after append' };
    }
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
    summary: `Added choice "${candidate.data.id}" to quiz "${args.parentId}" at ${position}`,
    details: { id: candidate.data.id, correct: candidate.data.correct ?? false, position, 'package valid': true },
    hints: [
      `Add another choice with: pathfinder-cli add-choice ${args.dir} --parent ${args.parentId} --id <id> --text <text>`,
    ],
    data: { position, parent: args.parentId, id: candidate.data.id },
  };
}
