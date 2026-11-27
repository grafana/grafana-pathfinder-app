import { walkBlocks } from '../../../cli/utils/package-io/tree';
import { hasTranslatedText } from '../../../lib/guide-translation/review';
import { isWellFormedSourceHash } from '../../../lib/guide-translation/source-hash';
import { formatEntryRef, type EntryRef } from '../../../lib/guide-translation/sync-translations';
import type { JsonBlock } from '../../../types/json-guide.types';
import type { TranslationEntry, TranslationSidecar } from '../../../types/translation-sidecar.schema';
import { SOURCE_HASH_CODES } from '../codes';
import {
  sidecarFileLabel,
  type SidecarCheck,
  type SidecarCheckContext,
  type SidecarFinding,
  type SidecarHashFunctions,
} from '../types';

const SYNC = 'pathfinder-cli sync-translations <dir>';

interface Entry {
  ref: EntryRef;
  /** Where the entry sits in the sidecar, e.g. `blocks.intro`. */
  label: string;
  path: string[];
  entry: TranslationEntry;
  /** The hash of the current English, or `undefined` when it cannot be computed here. */
  current: string | undefined;
}

/** `isEntryReviewed` (`review.ts`) with the synchronous digest, since checks cannot await. */
function isReviewed(entry: TranslationEntry, hash: SidecarHashFunctions): boolean {
  const recorded = entry._reviewHash;
  return entry.reviewed === true && isWellFormedSourceHash(recorded) && recorded === hash.entryText(entry);
}

function entriesOf(
  sidecar: TranslationSidecar,
  context: SidecarCheckContext,
  blocksById: ReadonlyMap<string, JsonBlock>
): Entry[] {
  const entries: Entry[] = [];
  if (sidecar.guide) {
    entries.push({
      ref: { kind: 'guide' },
      label: 'guide',
      path: ['guide'],
      entry: sidecar.guide,
      current: context.hash.guideTitle(context.content.title),
    });
  }
  if (sidecar.manifest) {
    entries.push({
      ref: { kind: 'manifest' },
      label: 'manifest',
      path: ['manifest'],
      entry: sidecar.manifest,
      current: context.manifest ? context.hash.manifest(context.manifest) : undefined,
    });
  }
  for (const [id, entry] of Object.entries(sidecar.blocks ?? {})) {
    const block = blocksById.get(id);
    entries.push({
      ref: { kind: 'block', id },
      label: `blocks.${id}`,
      path: ['blocks', id],
      entry,
      current: block ? context.hash.block(block) : undefined,
    });
  }
  return entries;
}

/** Errors on a translated entry with no `_sourceHash`, and on a reviewed one whose English changed since. */
export const sourceHashCheck: SidecarCheck = {
  id: 'source-hash',
  codes: SOURCE_HASH_CODES,
  run: (context) => {
    // First block wins, as in `sync-translations`; a key with no block is the orphan-key check's.
    const blocksById = new Map<string, JsonBlock>();
    for (const { block } of walkBlocks(context.content)) {
      if (typeof block.id === 'string' && block.id.length > 0 && !blocksById.has(block.id)) {
        blocksById.set(block.id, block);
      }
    }

    return context.sidecars.flatMap(({ tag, sidecar }) => {
      const file = sidecarFileLabel(tag);
      return entriesOf(sidecar, context, blocksById).flatMap(
        ({ ref, label, entry, current, ...at }): SidecarFinding[] => {
          // No English to hash against, so sync-translations can't stamp it either; orphan-key covers it.
          if (current === undefined || !hasTranslatedText(entry)) {
            return [];
          }
          const path = [file, ...at.path];
          if (entry._sourceHash === undefined) {
            return [
              {
                severity: 'error',
                code: 'sidecar_missing_source_hash',
                message: `${file}: ${label} has a translation but no _sourceHash, so it can never be detected as stale; run ${SYNC}`,
                path,
                remediation: SYNC,
              },
            ];
          }
          const matches = isWellFormedSourceHash(entry._sourceHash) && entry._sourceHash === current;
          if (matches || !isReviewed(entry, context.hash)) {
            return [];
          }
          const accept = `${SYNC} --locale ${tag} --accept ${formatEntryRef(ref)}`;
          return [
            {
              severity: context.allowStaleTranslations ? 'warn' : 'error',
              code: 'sidecar_stale_translation',
              message:
                `${file}: ${label} is stale: its _sourceHash does not match the current English. ` +
                `Update the translation in the same change, which also lapses its review, ` +
                `or, if the translation is still correct, run ${accept}`,
              path,
              remediation: accept,
            },
          ];
        }
      );
    });
  },
};
