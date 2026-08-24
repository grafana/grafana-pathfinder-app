/**
 * `pathfinder-cli edit-block <dir> <id> [flags]` — update fields on an
 * existing block. Scalar fields use merge semantics; arrays replace entirely.
 *
 * This is the one command whose parameter surface is a *union*. Every other
 * command knows its shape from its name, but the block being edited only reveals
 * its type when it is read from disk, so the command accepts any field any block
 * type declares and the runner narrows to the addressed block's own schema. The
 * union is built once, here, with the first declaration of a shared field
 * winning — `content` is declared by several block types and needs one flag with
 * one description.
 *
 * Every parameter is a patch parameter (`patchShape`): fields required to *create* a
 * block — `image.src`, `interactive.action` — are optional when editing one. The
 * interface used to publish all eleven as required while the preflight enforced none,
 * because requiredness rode on `forceOptional` plus a side table (§3.4 ii).
 *
 * Both of this command's refusals are stated as parameters rather than runner
 * branches, so they reach whichever entrypoint tried it: reordering (`reorderGuard`)
 * and `UNEDITABLE_BLOCK_FIELDS`, which is omitted from the union.
 */

import { z } from 'zod';

import {
  editBlock,
  findBlockById,
  mutateAndValidate,
  PackageIOError,
  readPackage,
  UNEDITABLE_BLOCK_FIELDS,
} from '../utils/package-io';
import {
  issueToOutcome,
  manyIssuesOutcome,
  renderError,
  type CommandOutcome,
  type OutcomeWarning,
} from '../utils/output';
import { BLOCK_SCHEMA_MAP, type BlockType } from '../utils/block-registry';
import { assertCliBlockFields, CliValidationError } from '../utils/cli-validators';
import { normalizeBlockInput } from '../utils/input-normalizers';
import { isNonEmptySelector, unverifiedSelectorWarning } from '../utils/warnings';
import {
  defineCommand,
  mountCommander,
  patchShape,
  pickSupplied,
  shapeKeys,
  withPolicy,
  type CommandShape,
} from '../contracts';

/**
 * Every field any editable block type declares, first declaration winning.
 *
 * `UNEDITABLE_BLOCK_FIELDS` is omitted because the mutator rejects those, and
 * publishing a parameter that can only fail would be a lie. It is also what
 * dissolves the two-`id` problem (§8.5 (a)): `id` leaves the content union, leaving
 * the address below as the command's only `id`.
 *
 * Fields with no flag spelling — `type` literals, arrays of nested blocks — need no
 * exclusion: the renderers drop them for not being representable.
 */
function blockFieldUnion(): CommandShape {
  const union: CommandShape = {};
  for (const schema of Object.values(BLOCK_SCHEMA_MAP)) {
    const shape = (schema as unknown as { shape: CommandShape }).shape;
    for (const [name, field] of Object.entries(shape)) {
      if (UNEDITABLE_BLOCK_FIELDS.has(name) || name in union) {
        continue;
      }
      union[name] = field;
    }
  }
  return union;
}

/**
 * A placement parameter this command accepts in order to refuse it. Without the
 * declaration, `--position 3` is Commander's "unknown option", which tells an author
 * something untrue: the CLI does reorder blocks, just with another command. Stated in
 * the schema, the redirect is written once and reaches both entrypoints.
 *
 * Hiding it from text help is a separate decision made at the mount site — an author
 * should be able to stumble into the redirect, not be offered it.
 */
function reorderGuard(instead: string) {
  return z
    .string()
    .optional()
    .refine((value) => value === undefined, {
      message: `edit-block does not reorder blocks — use "move-block <dir> <id> --${instead} <value>"`,
    })
    .describe('Reordering is not handled here — use move-block')
    .meta({ role: 'placement' });
}

export const EditBlockCommand = z.object({
  dir: z.string().describe('package directory').meta({ role: 'io' }),
  id: z.string().describe('id of the block to edit').meta({ role: 'addressing' }),
  ...withPolicy(patchShape(blockFieldUnion()), { role: 'content' }),
  position: reorderGuard('to-position'),
  before: reorderGuard('before'),
  after: reorderGuard('after'),
});

/**
 * Typed plumbing plus an open bag of block fields. The union is assembled by
 * iterating `BLOCK_SCHEMA_MAP` at runtime, so the content half is `unknown` — the
 * honest shape rather than a gap, since which fields are legal depends on a block type
 * this command does not know until it reads the file, and their types belong to that
 * block's schema.
 */
export type EditBlockInput = z.output<typeof EditBlockCommand> & Record<string, unknown>;

export async function runEditBlock(args: EditBlockInput): Promise<CommandOutcome> {
  // Inspect the block first to figure out which schema its flags must
  // project through. This is the price of a single command targeting any
  // block type — we pay one read up front.
  let blockType: BlockType;
  try {
    const state = readPackage(args.dir);
    const block = findBlockById(state.content, args.id);
    if (!block) {
      return {
        status: 'error',
        code: 'BLOCK_NOT_FOUND',
        message: `Block "${args.id}" not found in ${args.dir}`,
      };
    }
    blockType = block.type as BlockType;
  } catch (err) {
    if (err instanceof PackageIOError) {
      return issueToOutcome(err.issues[0] ?? { code: err.code, message: err.message });
    }
    return { status: 'error', code: 'NOT_FOUND', message: renderError(err) };
  }

  const schema = BLOCK_SCHEMA_MAP[blockType];
  if (!schema) {
    return {
      status: 'error',
      code: 'BLOCK_NOT_FOUND',
      message: `Block "${args.id}" is type "${blockType}" which the CLI cannot edit (excluded from authoring surface)`,
    };
  }

  // Narrow the union to the addressed block's own fields. A parameter that is
  // valid for some other block type is dropped rather than written, which is
  // the behaviour the union buys at the cost of this step.
  const editable = shapeKeys(schema).filter((name) => !UNEDITABLE_BLOCK_FIELDS.has(name));
  const rawPatch = pickSupplied(args as Record<string, unknown>, editable);

  if (Object.keys(rawPatch).length === 0) {
    return {
      status: 'error',
      code: 'NO_CHANGES',
      message: 'edit-block needs at least one field of this block type to change.',
    };
  }

  // M3 — apply known input normalizations to the patch before any
  // validator runs. The persisted block carries the canonical form, and a
  // warning rides on the outcome so the agent learns for next time.
  const { normalized: patch, warnings: normalizationWarnings } = normalizeBlockInput(blockType, rawPatch);

  // CLI-strict semantic checks against the patch values.
  try {
    assertCliBlockFields(blockType, patch);
  } catch (err) {
    if (err instanceof CliValidationError) {
      return { status: 'error', code: 'SCHEMA_VALIDATION', message: err.message };
    }
    throw err;
  }

  let changed: string[] = [];
  let legacyIdsMinted = 0;
  try {
    const result = await mutateAndValidate(args.dir, ({ content }) => {
      const r = editBlock(content, args.id, { patch });
      changed = r.changed;
    });
    if (!result.validation.ok) {
      const issues = result.validation.issues;
      if (issues.length === 0) {
        return { status: 'error', code: 'SCHEMA_VALIDATION', message: 'Validation failed after edit' };
      }
      if (issues.length === 1) {
        return issueToOutcome(issues[0]!, { issues });
      }
      const multi = manyIssuesOutcome(issues, `${blockType} block`);
      return { ...multi, code: issues[0]!.code, data: { ...(multi.data ?? {}), issues } };
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

  // M3 — normalization warnings always ride on the successful outcome.
  // Issue #3 — fire the unverified-selector signal only when the patch
  // itself wrote a non-empty `reftarget`. Edits that touch other fields on
  // a block whose pre-existing reftarget is unchanged do not re-arm this
  // warning (the original write was the moment of risk).
  const warnings: OutcomeWarning[] = [...normalizationWarnings];
  if (changed.includes('reftarget') && isNonEmptySelector(patch.reftarget)) {
    warnings.push(unverifiedSelectorWarning(`<id:${args.id}>/reftarget`));
  }

  return {
    status: 'ok',
    summary: `Updated ${blockType} block "${args.id}" (changed: ${changed.join(', ')})`,
    details: {
      type: blockType,
      id: args.id,
      changed,
      'package valid': true,
      ...(legacyIdsMinted > 0 ? { 'ids minted on legacy blocks': legacyIdsMinted } : {}),
    },
    ...(warnings.length > 0 ? { warnings } : {}),
    data: {
      type: blockType,
      id: args.id,
      changed,
      ...(legacyIdsMinted > 0 ? { idsAssignedOnRead: legacyIdsMinted } : {}),
    },
  };
}

export const editBlockSpec = defineCommand({
  name: 'edit-block',
  summary: "Update fields on an existing block by id. Only options valid for the block's actual type are retained.",
  schema: EditBlockCommand,
  run: runEditBlock,
});

export const editBlockCommand = mountCommander(editBlockSpec, {
  positionals: ['dir', 'id'],
  placeholders: { position: 'n', before: 'id', after: 'id' },
  // The reorder guards parse in order to refuse; listing them in help would
  // advertise a capability this command does not have.
  hidden: ['position', 'before', 'after'],
});
