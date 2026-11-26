import { CONTAINER_CHILD_KEYS } from '../../../cli/utils/package-io/tree';
import { getProjectionRow, readProjectedField } from '../../../lib/guide-translation/projection-table';
import type { JsonBlock } from '../../../types/json-guide.types';
import { TRANSLATABLE_IDS_CODES } from '../codes';
import type { SidecarCheck, SidecarFinding } from '../types';

const CONTENT_FILE = 'content.json';
const STAMP_IDS = 'pathfinder-cli stamp-ids <dir>';

interface Located {
  block: JsonBlock;
  path: string[];
}

function hasId(unit: { id?: unknown }): unit is { id: string } {
  return typeof unit.id === 'string' && unit.id.length > 0;
}

function locate(blocks: readonly JsonBlock[], parent: string[], out: Located[]): void {
  blocks.forEach((block, index) => {
    const path = [...parent, String(index)];
    out.push({ block, path });
    for (const key of CONTAINER_CHILD_KEYS[block.type] ?? []) {
      const children = (block as unknown as Record<string, unknown>)[key];
      if (Array.isArray(children)) {
        locate(children as JsonBlock[], [...path, key], out);
      }
    }
  });
}

/** `blocks[1].steps[0]`: the path inside content.json, as an author reads it. */
const show = (path: readonly string[]) =>
  path
    .slice(1)
    .map((segment, index) => (/^\d+$/.test(segment) ? `[${segment}]` : `${index === 0 ? '' : '.'}${segment}`))
    .join('');

function hasTranslatableText(block: JsonBlock): boolean {
  const row = getProjectionRow(block.type);
  return row !== undefined && row.fields.some((field) => readProjectedField(block, field) !== undefined);
}

/** Errors on a translatable block or step with no id, or with an id another one uses, in a package that ships a sidecar. */
export const translatableIdsCheck: SidecarCheck = {
  id: 'translatable-ids',
  codes: TRANSLATABLE_IDS_CODES,
  run: ({ content }) => {
    const findings: SidecarFinding[] = [];
    const located: Located[] = [];
    locate(content.blocks, ['blocks'], located);

    const firstPathById = new Map<string, string[]>();
    for (const { block, path } of located) {
      const where = [CONTENT_FILE, ...path];
      const translatable = hasTranslatableText(block);
      if (translatable && hasId(block)) {
        const first = firstPathById.get(block.id);
        if (first === undefined) {
          firstPathById.set(block.id, where);
        } else {
          findings.push({
            severity: 'error',
            code: 'duplicate_block_id',
            message: `${CONTENT_FILE}: block id "${block.id}" is used at ${show(first)} and at ${show(where)}; a sidecar keys blocks by id, so rename one of them in content.json`,
            path: where,
          });
        }
      } else if (translatable) {
        findings.push({
          severity: 'error',
          code: 'translatable_block_missing_id',
          message: `${CONTENT_FILE}: ${block.type} block at ${show(where)} has no id, so a translation cannot attach to it; run ${STAMP_IDS}`,
          path: where,
          remediation: STAMP_IDS,
        });
      }

      const steps = (block as { steps?: unknown }).steps;
      if (!getProjectionRow(block.type)?.stepFields || !Array.isArray(steps)) {
        continue;
      }
      const seen = new Map<string, string[]>();
      steps.forEach((step: { id?: unknown }, stepIndex) => {
        const stepPath = [...where, 'steps', String(stepIndex)];
        if (!hasId(step)) {
          findings.push({
            severity: 'error',
            code: 'translatable_step_missing_id',
            message: `${CONTENT_FILE}: step at ${show(stepPath)} has no id, so a translation cannot attach to it; run ${STAMP_IDS}`,
            path: stepPath,
            remediation: STAMP_IDS,
          });
          return;
        }
        const first = seen.get(step.id);
        if (first === undefined) {
          seen.set(step.id, stepPath);
        } else {
          findings.push({
            severity: 'error',
            code: 'duplicate_step_id',
            message: `${CONTENT_FILE}: step id "${step.id}" is used at ${show(first)} and at ${show(stepPath)}; a sidecar keys steps by id, so rename one of them in content.json`,
            path: stepPath,
          });
        }
      });
    }
    return findings;
  },
};
