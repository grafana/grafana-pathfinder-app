/**
 * The one place that knows how a guide's content file is named: `content.json`
 * or a compiled `content.<locale>.json` beside it (docs/design/I18N.md §6.1).
 * Only the canonical URL carries guide identity (§6.6, "Identity rule"); a
 * localized URL is a fetch detail that entry points normalize with
 * {@link canonicalContentFileUrl}. `src/validation/content-file-literal.test.ts`
 * fails on a new `/content.json` literal outside this module.
 */

export const CANONICAL_CONTENT_FILE = 'content.json';

export interface ContentFileRef {
  /** Everything before `/content[.<locale>].json`; `''` for a bare file name. */
  readonly base: string;
  /** The canonical BCP 47 tag of a localized file; absent for `content.json`. */
  readonly locale?: string;
  /** The query string and fragment, verbatim; `''` when there are none. */
  readonly query: string;
}

// language[-script][-region](-variant)*: the subset of BCP 47 a guide locale can use.
const LOCALE_TAG = /^([a-z]{2,3})(?:-([a-z]{4}))?(?:-([a-z]{2}|\d{3}))?((?:-(?:[a-z\d]{5,8}|\d[a-z\d]{3}))*)$/i;
const CONTENT_FILE = /(^|\/)content(?:\.([^/?#]*))?\.json$/;

/** The canonical spelling of a BCP 47 tag, or undefined when `tag` is not one. */
export function canonicalLocaleTag(tag: string): string | undefined {
  const match = LOCALE_TAG.exec(tag);
  if (!match) {
    return undefined;
  }
  const [, language, script, region, variants] = match;
  return [
    language!.toLowerCase(),
    script && script.charAt(0).toUpperCase() + script.slice(1).toLowerCase(),
    region?.toUpperCase(),
    variants && variants.slice(1).toLowerCase(),
  ]
    .filter(Boolean)
    .join('-');
}

/**
 * Parse a URL or path whose last segment is `content.json` or
 * `content.<BCP 47 tag>.json`. Returns undefined for anything else, including
 * look-alikes such as `content.json.bak`, `content..json` and a tag that is not
 * BCP 47.
 */
export function parseContentFileUrl(url: string): ContentFileRef | undefined {
  const queryStart = url.search(/[?#]/);
  const path = queryStart === -1 ? url : url.slice(0, queryStart);
  const query = queryStart === -1 ? '' : url.slice(queryStart);
  const match = CONTENT_FILE.exec(path);
  if (!match) {
    return undefined;
  }
  const base = path.slice(0, match.index);
  const tag = match[2];
  if (tag === undefined) {
    return { base, query };
  }
  const locale = canonicalLocaleTag(tag);
  return locale ? { base, locale, query } : undefined;
}

/** `content.json`, or `content.<locale>.json` for a BCP 47 tag. Throws on a tag that is not one. */
export function contentFileName(locale?: string): string {
  if (locale === undefined) {
    return CANONICAL_CONTENT_FILE;
  }
  const tag = canonicalLocaleTag(locale);
  if (!tag) {
    throw new Error(`Not a BCP 47 locale tag: ${JSON.stringify(locale)}`);
  }
  return `content.${tag}.json`;
}

export function isContentFileUrl(url: string): boolean {
  return parseContentFileUrl(url) !== undefined;
}

/** `ref` rebuilt with `fileName` in place of its content file. */
function withFileName(ref: ContentFileRef, fileName: string): string {
  return `${ref.base === '' ? '' : `${ref.base}/`}${fileName}${ref.query}`;
}

/**
 * The identity-bearing form of a URL: a localized content-file URL becomes the
 * canonical `content.json` URL plus its locale. Any other URL, canonical
 * content-file URLs included, is returned unchanged with no locale.
 */
export function canonicalContentFileUrl(url: string): { url: string; locale?: string } {
  const ref = parseContentFileUrl(url);
  if (!ref?.locale) {
    return { url };
  }
  return { url: withFileName(ref, CANONICAL_CONTENT_FILE), locale: ref.locale };
}

/** A sibling of the content file (`manifest.json`, `unstyled.html`), or undefined when `url` names no content file. */
export function contentFileSiblingUrl(url: string, fileName: string): string | undefined {
  const ref = parseContentFileUrl(url);
  return ref && withFileName(ref, fileName);
}

/**
 * The package's own address: `url` with a trailing content file removed.
 * Strips only when the content file ends the URL, so a URL with a query or a
 * fragment, or one that is nothing but the file name, is returned unchanged.
 */
export function stripContentFile(url: string): string {
  const ref = parseContentFileUrl(url);
  return ref && ref.query === '' && ref.base !== '' ? ref.base : url;
}
