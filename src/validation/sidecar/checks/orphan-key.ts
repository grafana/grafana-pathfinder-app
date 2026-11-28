import { walkBlocks } from '../../../cli/utils/package-io/tree';
import { ORPHAN_KEY_CODES } from '../codes';
import { sidecarFileLabel, type SidecarCheck, type SidecarFinding } from '../types';

const REKEY_OR_DELETE = 'if the block was renamed, re-key the entry to its new id; if it was removed, delete the entry';

/** Warns on a sidecar block or step key that matches no id in `content.json`. */
export const orphanKeyCheck: SidecarCheck = {
  id: 'orphan-key',
  codes: ORPHAN_KEY_CODES,
  run: ({ content, sidecars }) => {
    const blocksById = new Map<string, unknown>();
    for (const { block } of walkBlocks(content)) {
      if (typeof block.id === 'string' && block.id.length > 0 && !blocksById.has(block.id)) {
        blocksById.set(block.id, block);
      }
    }

    return sidecars.flatMap(({ tag, sidecar }): SidecarFinding[] => {
      const file = sidecarFileLabel(tag);
      return Object.entries(sidecar.blocks ?? {}).flatMap(([blockId, entry]): SidecarFinding[] => {
        const block = blocksById.get(blockId);
        if (block === undefined) {
          return [
            {
              severity: 'warn',
              code: 'sidecar_orphan_key',
              message: `${file}: blocks.${blockId} matches no block id in content.json`,
              path: [file, 'blocks', blockId],
              remediation: `${REKEY_OR_DELETE} (${file}, blocks.${blockId})`,
            },
          ];
        }
        const steps = (block as { steps?: unknown }).steps;
        if (!Array.isArray(steps)) {
          return [];
        }
        const stepIds = new Set(
          steps.flatMap((step: { id?: unknown }) => (typeof step.id === 'string' ? [step.id] : []))
        );
        return Object.keys(entry.steps ?? {})
          .filter((stepId) => !stepIds.has(stepId))
          .map((stepId): SidecarFinding => ({
            severity: 'warn',
            code: 'sidecar_orphan_step',
            message: `${file}: blocks.${blockId}.steps.${stepId} matches no step id in block "${blockId}"`,
            path: [file, 'blocks', blockId, 'steps', stepId],
            remediation: `${REKEY_OR_DELETE} (${file}, blocks.${blockId}.steps.${stepId})`,
          }));
      });
    });
  },
};
