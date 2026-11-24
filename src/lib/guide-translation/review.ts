import type { TranslationEntry } from '../../types/translation-sidecar.schema';
import { canonicalizeSourceText, hashCanonical, isWellFormedSourceHash } from './source-hash';

type RawRecord = Record<string, unknown>;

function isRecord(value: unknown): value is RawRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Keys that are not translated text: the review mark, `steps` (handled apart), and tooling fields. */
function isTextKey(key: string): boolean {
  return key !== 'reviewed' && key !== 'steps' && !key.startsWith('_');
}

function textFieldsOf(record: RawRecord): Array<[string, string]> {
  return Object.keys(record)
    .filter(isTextKey)
    .sort()
    .flatMap((key): Array<[string, string]> => {
      const value = record[key];
      return typeof value === 'string' ? [[key, canonicalizeSourceText(value)]] : [];
    });
}

function stepTextOf(steps: unknown): Array<[string, Record<string, string>]> {
  if (!isRecord(steps)) {
    return [];
  }
  return Object.keys(steps)
    .sort()
    .flatMap((stepId): Array<[string, Record<string, string>]> => {
      const step = steps[stepId];
      const fields = isRecord(step) ? textFieldsOf(step) : [];
      return fields.length === 0 ? [] : [[stepId, Object.fromEntries(fields)]];
    });
}

/**
 * The serialization an entry's review hash is taken over: every translated
 * string the entry carries, with keys sorted so the hash does not depend on
 * file order. It is entry-local on purpose: a sidecar entry has no block type,
 * so the projection row cannot say which fields it holds, and the validator
 * already rejects a field the row does not allow.
 */
export function canonicalEntryText(entry: unknown): string {
  const record = isRecord(entry) ? entry : {};
  const steps = stepTextOf(record.steps);
  return JSON.stringify({
    ...Object.fromEntries(textFieldsOf(record)),
    ...(steps.length > 0 ? { steps: Object.fromEntries(steps) } : {}),
  });
}

/** Whether the entry carries any translated text for a review to cover. */
export function hasTranslatedText(entry: unknown): boolean {
  return canonicalEntryText(entry) !== '{}';
}

export async function hashEntryText(entry: unknown): Promise<string> {
  return hashCanonical(canonicalEntryText(entry));
}

/**
 * The single place that decides whether an entry's `reviewed` mark still
 * counts (docs/design/I18N.md §7.1, "Review validity"). Every caller asks
 * here instead of reading `reviewed`.
 *
 * The mark counts only while `_reviewHash`, stamped by `sync-translations`
 * when the review was affirmed, still equals the hash of the entry's current
 * translated text. A reviewed entry with no hash, or one whose text changed
 * since, is not reviewed.
 */
export async function isEntryReviewed(entry: TranslationEntry | undefined): Promise<boolean> {
  if (!isRecord(entry) || entry.reviewed !== true) {
    return false;
  }
  const recorded = entry._reviewHash;
  return isWellFormedSourceHash(recorded) && recorded === (await hashEntryText(entry));
}
