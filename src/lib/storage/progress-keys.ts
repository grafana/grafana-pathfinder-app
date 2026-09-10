/**
 * Keys for the four per-section progress namespaces — interactive steps,
 * section collapse, section acknowledgement, section done.
 *
 * There is one shape, and every read and write uses it:
 *
 *   `{prefix}{len(contentKey)}:{contentKey}:{sectionId}`
 *
 * The character count in front of the content key is what makes it safe. The
 * shape it replaces joined the content key and the section id with a hyphen,
 * and content keys are hyphen-rich (`bundled:welcome-to-grafana`) or whole tab
 * URLs, so nothing marked where one ended: a scan for
 * `bundled:welcome-to-grafana` also matched every record belonging to
 * `bundled:welcome-to-grafana-cloud`. Counting to a declared boundary cannot
 * make that mistake.
 *
 * Records in the old shape are not read, migrated, or attributed — which
 * cannot be done correctly, because the information that would settle who owns
 * one was never stored. They are discarded in one pass on load
 * ({@link sweepDiscardedProgressRecords}).
 */

import { logger } from '../logging';
import {
  HYBRID_TIMESTAMP_SUFFIX,
  PROGRESS_SECTION_PREFIXES,
  StorageKeys,
  buildVersionedSectionStorageKey,
  parseVersionedStorageKey,
} from '../storage-keys';
import { collectKeysByPrefix } from './key-utils';

/** One section's stored value, still serialized as it sits in localStorage. */
export interface RawProgressEntry {
  sectionId: string;
  raw: string;
}

/** The key one section's progress is read from and written to. */
export function progressSectionKey(prefix: string, contentKey: string, sectionId: string): string {
  return buildVersionedSectionStorageKey(prefix, contentKey, sectionId);
}

function stripTimestampCompanion(key: string): string {
  return key.endsWith(HYBRID_TIMESTAMP_SUFFIX) ? key.slice(0, -HYBRID_TIMESTAMP_SUFFIX.length) : key;
}

/**
 * Every record under one namespace for one content key.
 *
 * Unambiguous by construction: the declared length pins the content-key
 * boundary, so another guide's records can never appear here however much of
 * its name this one's name happens to be.
 */
export function listProgressEntries(prefix: string, contentKey: string): RawProgressEntry[] {
  const entries: RawProgressEntry[] = [];
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key || key.endsWith(HYBRID_TIMESTAMP_SUFFIX)) {
        continue;
      }
      const parsed = parseVersionedStorageKey(prefix, key);
      if (!parsed || parsed.contentKey !== contentKey || parsed.sectionId === '') {
        continue;
      }
      const raw = localStorage.getItem(key);
      if (raw !== null) {
        entries.push({ sectionId: parsed.sectionId, raw });
      }
    }
  } catch {
    return entries;
  }
  return entries;
}

const DISCARDABLE_PREFIXES: readonly string[] = [
  ...PROGRESS_SECTION_PREFIXES,
  StorageKeys.CONTENT_PROGRESS_V2_PREFIX,
];

/**
 * True for a key in one of the four progress namespaces that is not a
 * well-formed section key, and for the per-content marker the previous scheme
 * used to retire records it could not identify. Both are discarded shapes.
 *
 * Deliberately narrow: it never looks at a key outside those five prefixes, so
 * the sweep cannot reach the learning-progress record (badges, streak,
 * completed guides), the durable completion queue, journey or milestone
 * completion, or anything else the plugin stores.
 */
function isDiscardedProgressKey(key: string): boolean {
  if (key.startsWith(StorageKeys.CONTENT_PROGRESS_V2_PREFIX)) {
    return true;
  }
  for (const prefix of PROGRESS_SECTION_PREFIXES) {
    if (key.startsWith(prefix)) {
      const parsed = parseVersionedStorageKey(prefix, key);
      return parsed === null || parsed.sectionId === '';
    }
  }
  return false;
}

/**
 * Removes every progress record left in the discarded key shape, along with
 * the timestamp companions the hybrid backend wrote beside them.
 *
 * Removes rather than migrates because the old shape cannot say which guide a
 * record belongs to; see the module comment. What a reader loses is their
 * position inside a guide they had started and not finished. Finished guides,
 * badges and the streak live under a single fixed key that carries no guide
 * name, and finished milestones and durable completions live in records of
 * their own — none of which this touches.
 *
 * Removals go straight to localStorage rather than through the storage
 * backend: the backend's delete writes a timestamp companion per key, and
 * these namespaces are never read back from Grafana storage, so routing a
 * discard through it would spend quota recording the removal of records
 * nothing will ask for again.
 *
 * Idempotent — a second pass finds nothing.
 */
export function sweepDiscardedProgressRecords(): number {
  const discarded = new Set<string>();
  for (const prefix of DISCARDABLE_PREFIXES) {
    for (const key of collectKeysByPrefix(localStorage, prefix)) {
      if (isDiscardedProgressKey(stripTimestampCompanion(key))) {
        discarded.add(key);
      }
    }
  }

  let removed = 0;
  try {
    for (const key of discarded) {
      localStorage.removeItem(key);
      removed++;
    }
  } catch (error) {
    logger.warn('Failed to sweep discarded progress records', { error, removed });
  }
  return removed;
}
