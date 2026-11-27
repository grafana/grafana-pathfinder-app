import { walkBlocks } from '../../../cli/utils/package-io/tree';
import { getProjectionRow, type ProjectionRow } from '../../../lib/guide-translation/projection-table';
import type { JsonBlock } from '../../../types/json-guide.types';
import { TranslationBlockEntrySchema } from '../../../types/translation-sidecar.schema';
import { PROJECTION_CONFORMANCE_CODES } from '../codes';
import { sidecarFileLabel, type SidecarCheck, type SidecarFinding } from '../types';

/** Block fields a translation must never carry: they drive selectors, requirements and structure. */
const STRUCTURAL_FIELDS: ReadonlySet<string> = new Set([
  'id',
  'type',
  'action',
  'reftarget',
  'requirements',
  'targeting',
  'targetvalue',
  'blocks',
  'whenTrue',
  'whenFalse',
]);

/** Read from the schema, so a tooling field added there later is allowed without an edit here. */
const TOOLING_FIELDS: ReadonlySet<string> = new Set(
  Object.keys(TranslationBlockEntrySchema.shape).filter((key) => key !== 'steps')
);

const listed = (fields: readonly string[]) => fields.join(', ');

function entryFindings(file: string, id: string, block: JsonBlock, entry: object): SidecarFinding[] {
  const path = [file, 'blocks', id];
  const where = `${file}: blocks.${id}`;
  const row: ProjectionRow | undefined = getProjectionRow(block.type);
  if (!row) {
    return [
      {
        severity: 'error',
        code: 'sidecar_block_type_not_translatable',
        message: `${where} addresses a ${block.type} block, which has no translatable fields; remove the entry`,
        path,
      },
    ];
  }

  return Object.entries(entry).flatMap(([key, value]): SidecarFinding[] => {
    if (TOOLING_FIELDS.has(key)) {
      return [];
    }
    if (key === 'steps') {
      return row.stepFields
        ? stepFindings(file, id, block.type, row.stepFields, value)
        : [
            {
              severity: 'error',
              code: 'sidecar_steps_not_allowed',
              message: `${where} has steps, but a ${block.type} block has none to translate; remove them`,
              path: [...path, 'steps'],
            },
          ];
    }
    if (key.startsWith('_')) {
      return [
        {
          severity: 'error',
          code: 'sidecar_reserved_field',
          message: `${where}.${key}: names starting with "_" are reserved for tooling; remove it`,
          path: [...path, key],
        },
      ];
    }
    if (STRUCTURAL_FIELDS.has(key)) {
      return [
        {
          severity: 'error',
          code: 'sidecar_structural_field',
          message: `${where}.${key}: "${key}" is structural on ${block.type} block "${id}" and cannot be translated; remove it`,
          path: [...path, key],
        },
      ];
    }
    // Compared verbatim: a conditional's `whenTrueSectionConfig.title` is one dotted key.
    if (row.fields.includes(key)) {
      return [];
    }
    return [
      {
        severity: 'error',
        code: 'sidecar_field_not_translatable',
        message: `${where}.${key}: a ${block.type} block translates only ${listed(row.fields)}; remove it`,
        path: [...path, key],
      },
    ];
  });
}

function stepFindings(
  file: string,
  id: string,
  blockType: string,
  stepFields: readonly string[],
  steps: unknown
): SidecarFinding[] {
  if (typeof steps !== 'object' || steps === null) {
    return [];
  }
  return Object.entries(steps).flatMap(([stepId, step]) =>
    Object.keys(typeof step === 'object' && step !== null ? step : {})
      .filter((key) => !stepFields.includes(key))
      .map((key): SidecarFinding => ({
        severity: 'error',
        code: 'sidecar_field_not_translatable',
        message: `${file}: blocks.${id}.steps.${stepId}.${key}: a ${blockType} step translates only ${listed(stepFields)}; remove it`,
        path: [file, 'blocks', id, 'steps', stepId, key],
      }))
  );
}

/** Errors on a sidecar field the projection table does not allow for the addressed block type. */
export const projectionConformanceCheck: SidecarCheck = {
  id: 'projection-conformance',
  codes: PROJECTION_CONFORMANCE_CODES,
  run: ({ content, sidecars }) => {
    // First block wins, as in sync-translations; a key with no block is the orphan-key check's.
    const blocksById = new Map<string, JsonBlock>();
    for (const { block } of walkBlocks(content)) {
      if (typeof block.id === 'string' && block.id.length > 0 && !blocksById.has(block.id)) {
        blocksById.set(block.id, block);
      }
    }
    return sidecars.flatMap(({ tag, sidecar }) => {
      const file = sidecarFileLabel(tag);
      return Object.entries(sidecar.blocks ?? {}).flatMap(([id, entry]) => {
        const block = blocksById.get(id);
        return block ? entryFindings(file, id, block, entry) : [];
      });
    });
  },
};
