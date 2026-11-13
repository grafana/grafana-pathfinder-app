import type { TranslationEntry } from '../../types/translation-sidecar.schema';

/**
 * The single place that decides whether an entry's `reviewed` mark still
 * counts (docs/design/I18N.md §7.1, "Review validity"). Every caller asks
 * here instead of reading `reviewed`, so the invalidation mechanism lands by
 * changing only this function and the schema field it needs.
 */
export function isEntryReviewed(entry: TranslationEntry | undefined): boolean {
  return entry?.reviewed === true;
}
