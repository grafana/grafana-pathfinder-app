/**
 * `pathfinder-cli add-choice <dir> --parent <id> --id <a|b|c> --text <text>` —
 * append a choice to a quiz block. Content fields come from
 * `JsonQuizChoiceSchema`.
 *
 * See `add-step.ts` for the composition pattern. `id` here is the choice's own content
 * field rather than an address — the address is `parent` — a distinction that used to
 * be implicit in which file declared the flag.
 */

import { z } from 'zod';

import { JsonQuizChoiceSchema } from '../../types/json-guide.schema';
import type { JsonQuizChoice } from '../../types/json-guide.types';
import { defineCommand, mountCommander, pickContent, shapeKeys, withPolicy } from '../contracts';
import { assertCliChoiceFields, CliValidationError } from '../utils/cli-validators';
import { appendChoice, mutateAndValidate, PackageIOError } from '../utils/package-io';
import { issueToOutcome, manyIssuesOutcome, renderError, type CommandOutcome } from '../utils/output';

const CHOICE_CONTENT_KEYS = shapeKeys(JsonQuizChoiceSchema);

export const AddChoiceCommand = z.object({
  dir: z.string().describe('package directory').meta({ role: 'io' }),
  parent: z.string().describe('Quiz block id').meta({ role: 'addressing' }),
  ...withPolicy(JsonQuizChoiceSchema.shape, { role: 'content' }),
});

export type AddChoiceInput = z.output<typeof AddChoiceCommand>;

export async function runAddChoice(args: AddChoiceInput): Promise<CommandOutcome> {
  const parentId = args.parent;
  const projected = pickContent(args as Record<string, unknown>, CHOICE_CONTENT_KEYS);

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
    return manyIssuesOutcome(candidate.error.issues, 'choice');
  }

  let position = '';
  let legacyIdsMinted = 0;
  try {
    const result = await mutateAndValidate(args.dir, ({ content }) => {
      const r = appendChoice(content, candidate.data as JsonQuizChoice, parentId);
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
    summary: `Added choice "${candidate.data.id}" to quiz "${parentId}" at ${position}`,
    details: {
      id: candidate.data.id,
      correct: candidate.data.correct ?? false,
      position,
      'package valid': true,
      ...(legacyIdsMinted > 0 ? { 'ids minted on legacy blocks': legacyIdsMinted } : {}),
    },
    hints: [
      `Add another choice with: pathfinder-cli add-choice ${args.dir} --parent ${parentId} --id <id> --text <text>`,
    ],
    data: {
      position,
      parent: parentId,
      id: candidate.data.id,
      ...(legacyIdsMinted > 0 ? { idsAssignedOnRead: legacyIdsMinted } : {}),
    },
  };
}

export const addChoiceSpec = defineCommand({
  name: 'add-choice',
  summary: 'Append a choice to a quiz block',
  schema: AddChoiceCommand,
  run: runAddChoice,
});

export const addChoiceCommand = mountCommander(addChoiceSpec, {
  positionals: ['dir'],
  placeholders: { parent: 'id' },
});
