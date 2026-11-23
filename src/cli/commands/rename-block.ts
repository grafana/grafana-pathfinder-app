/**
 * `pathfinder-cli rename-block <dir> <id> <new-id>` renames one block id and
 * rewrites every supported reference to it inside the same package.
 *
 * Supported references: `section-completed:<id>` and `section-completed:section-<id>`
 * in any `requirements`, `objectives`, `conditions` or `verify` field. Shapes it
 * cannot rewrite safely are reported and the rename refused: an alias another
 * block could also own, and ids in a compiled locale's `translation` annotation.
 * Other packages and completion records are out of scope.
 */

import { z } from 'zod';

import { ParameterizedRequirementPrefix } from '../../types/requirements.types';
import { defineCommand } from '../contracts';
import { collectAllIds, findBlockById, mutateAndValidate, PackageIOError } from '../utils/package-io';
import { issueToOutcome, renderError, type CommandOutcome } from '../utils/output';

const SECTION_COMPLETED = ParameterizedRequirementPrefix.SECTION_COMPLETED;
// The section check maps `section-completed:X` and `section-completed:section-X` to the same section.
const SECTION_ALIAS_PREFIX = 'section-';
const CONDITION_KEYS = new Set(['requirements', 'objectives', 'conditions', 'verify']);

export const RenameBlockCommand = z.object({
  dir: z.string().describe('package directory').meta({ role: 'io' }),
  id: z.string().describe('current id of the block to rename').meta({ role: 'addressing' }),
  newId: z.string().min(1).describe('new block id').meta({ role: 'content' }),
});

export type RenameBlockInput = z.output<typeof RenameBlockCommand>;

interface RenameScan {
  oldId: string;
  newId: string;
  /** True when another block owns `section-<oldId>`, so the alias spelling could mean either block. */
  aliasIsAmbiguous: boolean;
  rewritten: string[];
  unsupported: string[];
}

function rewriteConditionString(value: string, path: string, scan: RenameScan): string {
  const exact = `${SECTION_COMPLETED}${scan.oldId}`;
  const alias = `${SECTION_COMPLETED}${SECTION_ALIAS_PREFIX}${scan.oldId}`;
  return value
    .split(',')
    .map((part) => {
      const token = part.trim();
      if (token === exact) {
        scan.rewritten.push(path);
        return part.replace(token, `${SECTION_COMPLETED}${scan.newId}`);
      }
      if (token === alias && scan.aliasIsAmbiguous) {
        scan.unsupported.push(`${path}: "${token}" could also mean block "${SECTION_ALIAS_PREFIX}${scan.oldId}"`);
      } else if (token === alias) {
        scan.rewritten.push(path);
        return part.replace(token, `${SECTION_COMPLETED}${SECTION_ALIAS_PREFIX}${scan.newId}`);
      }
      return part;
    })
    .join(',');
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
        typeof entry === 'string' ? rewriteConditionString(entry, `${childPath}[${i}]`, scan) : entry
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
        aliasIsAmbiguous: ids.has(`${SECTION_ALIAS_PREFIX}${args.id}`),
        rewritten: [],
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
  const rewritten = scan.rewritten;
  return {
    status: 'ok',
    summary: `Renamed ${blockType} "${args.id}" to "${args.newId}" and rewrote ${rewritten.length} reference(s)`,
    details: {
      'old id': args.id,
      'new id': args.newId,
      references: rewritten.length > 0 ? rewritten.join(', ') : 'none',
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
