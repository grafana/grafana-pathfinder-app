/**
 * `pathfinder-cli stamp-ids <dir>` — give every translatable block, and every
 * step of a `multistep` or `guided` block, a stable `id` when it has none
 * (docs/design/I18N.md §6.5, §12.2).
 *
 * The rule lives in `../utils/package-io/stamp-ids.ts`. This file reads the
 * package without the on-read id minting, applies the rule, checks the result
 * against `validatePackageState` and writes `content.json` only.
 */

import * as fs from 'fs';

import { z } from 'zod';

import { defineCommand } from '../contracts';
import { resolveCliPath } from '../utils/file-loader';
import {
  PackageIOError,
  readPackage,
  stampIds,
  validatePackageState,
  writePackageContent,
  type StampedId,
} from '../utils/package-io';
import { issueToOutcome, renderError, type CommandOutcome } from '../utils/output';

export const StampIdsCommand = z.object({
  dir: z.string().describe('package directory').meta({ role: 'io' }),
  check: z
    .boolean()
    .default(false)
    .describe('Print the ids that would be stamped and exit non-zero if there are any; write nothing')
    .meta({ role: 'control' }),
});

export type StampIdsInput = z.output<typeof StampIdsCommand>;

function describeStamp(stamp: StampedId): string {
  return stamp.kind === 'block' ? `${stamp.blockType} block: ${stamp.id}` : `step of ${stamp.parentId}: ${stamp.id}`;
}

function failure(code: string, message: string, data?: Record<string, unknown>): CommandOutcome {
  return { status: 'error', code, message, ...(data ? { data } : {}) };
}

export async function runStampIds(args: StampIdsInput): Promise<CommandOutcome> {
  const dir = resolveCliPath(args.dir);
  if (!fs.existsSync(dir)) {
    return failure('NOT_FOUND', `Package directory not found: ${dir}`);
  }

  try {
    const state = readPackage(dir, { mintIds: false });
    const { content, stamped } = stampIds(state.content);
    const lines = stamped.map(describeStamp);
    const data = { stamped: stamped.map((stamp) => ({ ...stamp })) };

    if (stamped.length === 0) {
      return { status: 'ok', summary: 'Every translatable block and step has an id (nothing to stamp)', data };
    }

    if (args.check) {
      return failure(
        'IDS_MISSING',
        `${stamped.length} id(s) would be stamped; run stamp-ids to write them.\n${lines.map((line) => `  - ${line}`).join('\n')}`,
        data
      );
    }

    const validation = validatePackageState(content, state.manifest, {
      manifestSchemaVersionAuthored: state.manifestSchemaVersionAuthored,
    });
    if (!validation.ok) {
      const first = validation.issues[0];
      return first
        ? issueToOutcome(first, { issues: validation.issues })
        : failure('SCHEMA_VALIDATION', 'Validation failed after stamping ids; nothing written');
    }

    writePackageContent(dir, content);
    return {
      status: 'ok',
      summary: `Stamped ${stamped.length} id(s) in content.json`,
      text: lines.map((line) => `  ${line}`).join('\n'),
      data,
    };
  } catch (err) {
    if (err instanceof PackageIOError) {
      return issueToOutcome(err.issues[0] ?? { code: err.code, message: err.message });
    }
    return failure('SCHEMA_VALIDATION', renderError(err));
  }
}

export const stampIdsSpec = defineCommand({
  name: 'stamp-ids',
  summary:
    'Stamp missing ids on translatable blocks (<type>-<n>) and steps (<block-id>-step-<k>), smallest unused number in document order; existing ids never change',
  schema: StampIdsCommand,
  run: runStampIds,
});
