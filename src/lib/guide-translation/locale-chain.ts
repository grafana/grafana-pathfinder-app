/**
 * The BCP 47 fallback chain of a locale tag (docs/design/I18N.md §6.4): the
 * tag itself, then each shorter prefix, most specific first. `ja-JP` gives
 * `['ja-JP', 'ja']`. The canonical language is the implicit last step, so it
 * is not part of the chain.
 */
export function localeChain(locale: string): string[] {
  const subtags = locale.split('-');
  return subtags.map((_, dropped) => subtags.slice(0, subtags.length - dropped).join('-'));
}
