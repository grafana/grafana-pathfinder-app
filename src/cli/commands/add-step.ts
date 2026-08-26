/**
 * `pathfinder-cli add-step <dir> --parent <id> [flags]` — append a step to a
 * multistep or guided block. Content fields come from `JsonStepSchema`.
 *
 * Composition over a shared runtime schema: the step content fields are copied out
 * of `JsonStepSchema` and annotated as content, and the command adds its own `parent`
 * and `dir` on top. `JsonStepSchema` is left untouched for the block editor and
 * validation layer, which have no business knowing about flags.
 */

import { z } from 'zod';

import { JsonStepSchema } from '../../types/json-guide.schema';
import { defineCommand, mountCommander, pickContent, shapeKeys, withPolicy } from '../contracts';
import type { JsonStep } from '../../types/json-guide.types';
import { assertCliStepFields, CliValidationError } from '../utils/cli-validators';
import { appendStep, mutateAndValidate, PackageIOError } from '../utils/package-io';
import {
  issueToOutcome,
  manyIssuesOutcome,
  renderError,
  type CommandOutcome,
  type OutcomeWarning,
} from '../utils/output';
import { isNonEmptySelector, unverifiedSelectorWarning } from '../utils/warnings';

// Read without a cast: `.refine()` returns `this` in Zod v4, so `.shape` keeps its
// per-field types. Casting to `ZodRawShape` would erase them invisibly — the command
// schema still builds, but `z.output` degrades to `dir` and `parent` alone, making
// every content field a runner reads an unchecked property access.
const stepShape = JsonStepSchema.shape;
const STEP_CONTENT_KEYS = shapeKeys(JsonStepSchema);

export const AddStepCommand = z.object({
  dir: z.string().describe('package directory').meta({ role: 'io' }),
  parent: z.string().describe('Parent multistep or guided block id').meta({ role: 'addressing' }),
  ...withPolicy(stepShape, { role: 'content' }),
});

export type AddStepInput = z.output<typeof AddStepCommand>;

export async function runAddStep(args: AddStepInput): Promise<CommandOutcome> {
  const parentId = args.parent;
  const projected = pickContent(args as Record<string, unknown>, STEP_CONTENT_KEYS);

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
      const r = appendStep(content, candidate.data as JsonStep, parentId);
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

  // Issue #3 — surface the soft "this reftarget wasn't verified" signal so a
  // reviewer can grep for the warning. See `unverifiedSelectorWarning`.
  const warnings: OutcomeWarning[] = [];
  if (isNonEmptySelector((candidate.data as { reftarget?: unknown }).reftarget)) {
    warnings.push(unverifiedSelectorWarning(`${position}/reftarget`));
  }

  return {
    status: 'ok',
    summary: `Added step (action: ${String(candidate.data.action)}) to "${parentId}" at ${position}`,
    details: {
      action: String(candidate.data.action),
      position,
      'package valid': true,
      ...(legacyIdsMinted > 0 ? { 'ids minted on legacy blocks': legacyIdsMinted } : {}),
    },
    ...(warnings.length > 0 ? { warnings } : {}),
    hints: [
      `Add another step with: pathfinder-cli add-step ${args.dir} --parent ${parentId} --action <action>`,
      `Or move on with: pathfinder-cli add-block <type> ${args.dir}`,
    ],
    data: {
      position,
      parent: parentId,
      ...(legacyIdsMinted > 0 ? { idsAssignedOnRead: legacyIdsMinted } : {}),
    },
  };
}

export const addStepSpec = defineCommand({
  name: 'add-step',
  summary: 'Append a step to a multistep or guided block',
  schema: AddStepCommand,
  run: runAddStep,
});

export const addStepCommand = mountCommander(addStepSpec, {
  positionals: ['dir'],
  placeholders: { parent: 'id' },
});
