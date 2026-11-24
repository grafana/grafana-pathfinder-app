/**
 * `pathfinder-cli rename-block <dir> <id> <new-id>` renames one block id and
 * rewrites every supported reference to it inside the same package.
 *
 * Supported references: any `section-completed:` token in a `requirements`,
 * `objectives`, `conditions`, `verify` or `successCriteria` field that the runtime
 * resolves to this block. Ids in a compiled locale's `translation` annotation are
 * reported and the rename refused, and so is a new id a condition cannot carry
 * (a comma, or edge whitespace). Other packages and completion records are out of scope.
 */

import { z } from 'zod';

import { ParameterizedRequirementPrefix } from '../../types/requirements.types';
import { defineCommand } from '../contracts';
import { collectAllIds, findBlockById, mutateAndValidate, PackageIOError } from '../utils/package-io';
import { issueToOutcome, renderError, type CommandOutcome } from '../utils/output';

const SECTION_COMPLETED = ParameterizedRequirementPrefix.SECTION_COMPLETED;
// A section renders as `section-<id>`, and the section check adds that prefix unless the ref already has it.
const SECTION_PREFIX = 'section-';
const CONDITION_KEYS = new Set(['requirements', 'objectives', 'conditions', 'verify', 'successCriteria']);

export const RenameBlockCommand = z.object({
  dir: z.string().describe('package directory').meta({ role: 'io' }),
  id: z.string().describe('current id of the block to rename').meta({ role: 'addressing' }),
  newId: z
    .string()
    .min(1)
    .describe('new block id (no comma, no leading or trailing whitespace)')
    .meta({ role: 'content' }),
});

export type RenameBlockInput = z.output<typeof RenameBlockCommand>;

interface RenameScan {
  oldId: string;
  newId: string;
  rewritten: Set<string>;
  unsupported: string[];
}

// Mirrors sectionCompletedCheck, so a ref is only rewritten when the runtime would look up this block.
function sectionLookupId(ref: string): string {
  return ref.startsWith(SECTION_PREFIX) ? ref : `${SECTION_PREFIX}${ref}`;
}

// A single condition token. Keeps the surrounding whitespace and returns it unchanged unless it names this block.
function rewriteToken(part: string, path: string, scan: RenameScan): string {
  const token = part.trim();
  if (!token.startsWith(SECTION_COMPLETED)) {
    return part;
  }
  const ref = token.slice(SECTION_COMPLETED.length);
  if (sectionLookupId(ref) !== `${SECTION_PREFIX}${scan.oldId}`) {
    return part;
  }
  // Keep the short spelling only when it still resolves to the renamed block.
  const keepShort = ref === scan.oldId && !scan.newId.startsWith(SECTION_PREFIX);
  scan.rewritten.add(path);
  const next = `${SECTION_COMPLETED}${keepShort ? '' : SECTION_PREFIX}${scan.newId}`;
  // A replacer function keeps `$` sequences in the new id literal.
  return part.replace(token, () => next);
}

// Only a string field holds several comma-separated conditions. Each array entry is one condition.
function rewriteConditionString(value: string, path: string, scan: RenameScan): string {
  return value
    .split(',')
    .map((part) => rewriteToken(part, path, scan))
    .join(',');
}

// An id the condition parser would split or trim cannot be written into a reference and read back as itself.
function unsafeIdReason(id: string): string | undefined {
  if (id.includes(',')) {
    return 'it contains a comma, which separates conditions';
  }
  if (id !== id.trim()) {
    return 'it starts or ends with whitespace, which condition parsing trims';
  }
  return undefined;
}

function rewriteReferences(node: unknown, path: string, scan: RenameScan): void {
  if (Array.isArray(node)) {
    node.forEach((child, i) => rewriteReferences(child, `${path}[${i}]`, scan));
    return;
  }
  if (!node || typeof node !== 'object') {
    return;
  }
  const record = node as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    const childPath = `${path}.${key}`;
    if (CONDITION_KEYS.has(key) && typeof value === 'string') {
      record[key] = rewriteConditionString(value, childPath, scan);
    } else if (CONDITION_KEYS.has(key) && Array.isArray(value)) {
      record[key] = value.map((entry, i) =>
        typeof entry === 'string' ? rewriteToken(entry, `${childPath}[${i}]`, scan) : entry
      );
    } else {
      rewriteReferences(value, childPath, scan);
    }
  }
}

export async function runRenameBlock(args: RenameBlockInput): Promise<CommandOutcome> {
  let scan: RenameScan | undefined;
  let blockType = '';
  try {
    const result = await mutateAndValidate(args.dir, ({ content }) => {
      const block = findBlockById(content, args.id);
      if (!block) {
        throw new PackageIOError({ code: 'BLOCK_NOT_FOUND', message: `Block "${args.id}" not found in package` });
      }
      if (args.id === args.newId) {
        return;
      }
      const unsafe = unsafeIdReason(args.newId);
      if (unsafe) {
        throw new PackageIOError({
          code: 'INVALID_BLOCK_ID',
          message: `Block id "${args.newId}" cannot be used because ${unsafe}`,
        });
      }
      const ids = collectAllIds(content);
      if (ids.has(args.newId)) {
        throw new PackageIOError({
          code: 'DUPLICATE_ID',
          message: `Block id "${args.newId}" is already used in this package`,
        });
      }
      blockType = block.type;
      block.id = args.newId;
      const found: RenameScan = {
        oldId: args.id,
        newId: args.newId,
        rewritten: new Set(),
        unsupported: [],
      };
      scan = found;
      rewriteReferences(content.blocks, 'blocks', found);
      for (const key of ['staleBlockIds', 'fallbackBlockIds'] as const) {
        content.translation?.[key].forEach((id, i) => {
          if (id === args.id) {
            found.unsupported.push(`translation.${key}[${i}]: recompile the locale instead`);
          }
        });
      }
      if (found.unsupported.length > 0) {
        throw new PackageIOError({
          code: 'UNSUPPORTED_REFERENCE',
          message: `Found references to "${args.id}" that rename-block cannot rewrite safely: ${found.unsupported.join('; ')}`,
        });
      }
    });
    if (!result.validation.ok) {
      const first = result.validation.issues[0];
      return first
        ? issueToOutcome(first, { issues: result.validation.issues })
        : { status: 'error', code: 'SCHEMA_VALIDATION', message: 'Validation failed after rename-block' };
    }
  } catch (err) {
    if (err instanceof PackageIOError) {
      return issueToOutcome(err.issues[0] ?? { code: err.code, message: err.message });
    }
    return { status: 'error', code: 'SCHEMA_VALIDATION', message: renderError(err) };
  }

  if (!scan) {
    return {
      status: 'ok',
      summary: `Block id is already "${args.newId}" (no change)`,
      data: { id: args.newId, renamed: false, referencesRewritten: [] },
    };
  }
  const rewritten = [...scan.rewritten];
  return {
    status: 'ok',
    summary: `Renamed ${blockType} "${args.id}" to "${args.newId}" and rewrote ${rewritten.length} field(s) that referenced it`,
    details: {
      'old id': args.id,
      'new id': args.newId,
      fields: rewritten.length > 0 ? rewritten.join(', ') : 'none',
      'package valid': true,
    },
    hints: [`Completion records saved under "${args.id}" are not migrated, and other packages are not scanned.`],
    data: { oldId: args.id, newId: args.newId, renamed: true, referencesRewritten: rewritten },
  };
}

export const renameBlockSpec = defineCommand({
  name: 'rename-block',
  summary: 'Rename a block id and rewrite its in-package section-completed references',
  schema: RenameBlockCommand,
  run: runRenameBlock,
});
