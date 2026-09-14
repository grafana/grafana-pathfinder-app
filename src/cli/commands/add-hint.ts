/**
 * `pathfinder-cli add-hint <dir> --parent <id> --text <text>` — append a
 * progressive hint to a challenge block. Content fields come from
 * `JsonChallengeHintSchema`.
 */

import { z } from 'zod';

import { JsonChallengeHintSchema } from '../../types/json-guide.schema';
import type { JsonChallengeHint } from '../../types/json-guide.types';
import { defineCommand, pickContent, shapeKeys, withPolicy } from '../contracts';
import { appendHint, mutateAndValidate, PackageIOError } from '../utils/package-io';
import { issueToOutcome, manyIssuesOutcome, renderError, type CommandOutcome } from '../utils/output';

const HINT_CONTENT_KEYS = shapeKeys(JsonChallengeHintSchema);

export const AddHintCommand = z.object({
  dir: z.string().describe('package directory').meta({ role: 'io' }),
  parent: z.string().describe('Challenge block id').meta({ role: 'addressing' }),
  ...withPolicy(JsonChallengeHintSchema.shape, { role: 'content' }),
});

export type AddHintInput = z.output<typeof AddHintCommand>;

export async function runAddHint(args: AddHintInput): Promise<CommandOutcome> {
  const parentId = args.parent;
  const projected = pickContent(args as Record<string, unknown>, HINT_CONTENT_KEYS);
  const candidate = JsonChallengeHintSchema.safeParse(projected);
  if (!candidate.success) {
    return manyIssuesOutcome(candidate.error.issues, 'challenge hint');
  }

  let position = '';
  let legacyIdsMinted = 0;
  try {
    const result = await mutateAndValidate(args.dir, ({ content }) => {
      const appended = appendHint(content, candidate.data as JsonChallengeHint, parentId);
      position = appended.position;
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
    summary: `Added hint to challenge "${parentId}" at ${position}`,
    details: {
      position,
      'package valid': true,
      ...(legacyIdsMinted > 0 ? { 'ids minted on legacy blocks': legacyIdsMinted } : {}),
    },
    hints: [`Add another hint with: pathfinder-cli add-hint ${args.dir} --parent ${parentId} --text <text>`],
    data: {
      position,
      parent: parentId,
      ...(legacyIdsMinted > 0 ? { idsAssignedOnRead: legacyIdsMinted } : {}),
    },
  };
}

export const addHintSpec = defineCommand({
  name: 'add-hint',
  summary: 'Append a progressive hint to a challenge block',
  schema: AddHintCommand,
  run: runAddHint,
});
