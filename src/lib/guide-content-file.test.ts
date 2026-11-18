import {
  CANONICAL_CONTENT_FILE,
  canonicalContentFileUrl,
  canonicalLocaleTag,
  contentFileName,
  contentFileSiblingUrl,
  isContentFileUrl,
  parseContentFileUrl,
  stripContentFile,
} from './guide-content-file';

const PACKAGE = 'https://interactive-learning.grafana.net/packages/first-dashboard';

describe('parseContentFileUrl', () => {
  it.each([
    ['content.json', { base: '', query: '' }],
    ['/content.json', { base: '', query: '' }],
    [`${PACKAGE}/content.json`, { base: PACKAGE, query: '' }],
    [`${PACKAGE}/content.ja.json`, { base: PACKAGE, locale: 'ja', query: '' }],
    [`${PACKAGE}/content.ja-JP.json`, { base: PACKAGE, locale: 'ja-JP', query: '' }],
    [`${PACKAGE}/content.zh-Hans.json`, { base: PACKAGE, locale: 'zh-Hans', query: '' }],
    [`${PACKAGE}/content.zh-Hans-CN.json`, { base: PACKAGE, locale: 'zh-Hans-CN', query: '' }],
    [`${PACKAGE}/content.es-419.json`, { base: PACKAGE, locale: 'es-419', query: '' }],
    [`${PACKAGE}/content.ja.json?ref=main`, { base: PACKAGE, locale: 'ja', query: '?ref=main' }],
    [`${PACKAGE}/content.json#pf-pr-abc`, { base: PACKAGE, query: '#pf-pr-abc' }],
    [`${PACKAGE}/content.ja-JP.json?a=1#step-2`, { base: PACKAGE, locale: 'ja-JP', query: '?a=1#step-2' }],
    ['bundled:welcome-to-grafana/content.json', { base: 'bundled:welcome-to-grafana', query: '' }],
    ['bundled:welcome-to-grafana/content.ja.json', { base: 'bundled:welcome-to-grafana', locale: 'ja', query: '' }],
    ['first-dashboard/content.ja.json', { base: 'first-dashboard', locale: 'ja', query: '' }],
  ])('parses %s', (url, expected) => {
    expect(parseContentFileUrl(url)).toEqual(expected);
  });

  it('canonicalizes the case of the locale tag', () => {
    expect(parseContentFileUrl(`${PACKAGE}/content.JA-jp.json`)?.locale).toBe('ja-JP');
    expect(parseContentFileUrl(`${PACKAGE}/content.ZH-hans.json`)?.locale).toBe('zh-Hans');
  });

  it.each([
    `${PACKAGE}/content.json.bak`,
    `${PACKAGE}/content..json`,
    `${PACKAGE}/content.<script>.json`,
    `${PACKAGE}/content.ja.JP.json`,
    `${PACKAGE}/content.json.json`,
    `${PACKAGE}/content.backup.json`,
    `${PACKAGE}/content.ja_JP.json`,
    `${PACKAGE}/content.j.json`,
    `${PACKAGE}/mycontent.json`,
    `${PACKAGE}/content.ja.json/`,
    `${PACKAGE}/content.json/extra`,
    `${PACKAGE}/manifest.json`,
    `${PACKAGE}/unstyled.html`,
    `${PACKAGE}/`,
    PACKAGE,
    'bundled:welcome-to-grafana',
    '',
  ])('rejects %s', (url) => {
    expect(parseContentFileUrl(url)).toBeUndefined();
    expect(isContentFileUrl(url)).toBe(false);
  });

  it('reads a content-file name inside the query as query, not as the file', () => {
    expect(parseContentFileUrl(`${PACKAGE}/?file=content.ja.json`)).toBeUndefined();
  });
});

describe('contentFileName', () => {
  it.each([
    [undefined, CANONICAL_CONTENT_FILE],
    ['ja', 'content.ja.json'],
    ['ja-JP', 'content.ja-JP.json'],
    ['ja-jp', 'content.ja-JP.json'],
    ['zh-Hans', 'content.zh-Hans.json'],
  ])('builds the file name for %s', (locale, expected) => {
    expect(contentFileName(locale)).toBe(expected);
  });

  it.each(['', 'json', '<script>', 'ja_JP', 'ja.JP', '../ja'])('throws on the non-tag %j', (locale) => {
    expect(() => contentFileName(locale)).toThrow('Not a BCP 47 locale tag');
  });

  it('round-trips through the parser', () => {
    for (const locale of ['ja', 'ja-JP', 'zh-Hans', 'pt-BR']) {
      expect(parseContentFileUrl(`${PACKAGE}/${contentFileName(locale)}`)).toEqual({
        base: PACKAGE,
        locale,
        query: '',
      });
    }
  });
});

describe('canonicalLocaleTag', () => {
  it.each([
    ['ja', 'ja'],
    ['JA', 'ja'],
    ['zh-hant-tw', 'zh-Hant-TW'],
    ['de-CH-1996', 'de-CH-1996'],
  ])('canonicalizes %s', (tag, expected) => {
    expect(canonicalLocaleTag(tag)).toBe(expected);
  });

  it.each(['', 'j', 'json', 'ja-', '-ja', 'ja--JP'])('rejects %j', (tag) => {
    expect(canonicalLocaleTag(tag)).toBeUndefined();
  });
});

describe('canonicalContentFileUrl', () => {
  it.each([
    [`${PACKAGE}/content.ja.json`, { url: `${PACKAGE}/content.json`, locale: 'ja' }],
    [`${PACKAGE}/content.ja-JP.json?ref=main#x`, { url: `${PACKAGE}/content.json?ref=main#x`, locale: 'ja-JP' }],
    ['bundled:welcome-to-grafana/content.ja.json', { url: 'bundled:welcome-to-grafana/content.json', locale: 'ja' }],
    ['content.ja.json', { url: 'content.json', locale: 'ja' }],
  ])('turns the localized %s into the canonical URL plus its locale', (url, expected) => {
    expect(canonicalContentFileUrl(url)).toEqual(expected);
  });

  it.each([
    `${PACKAGE}/content.json`,
    `${PACKAGE}/content.json?ref=main`,
    `${PACKAGE}/content.json.bak`,
    'bundled:welcome-to-grafana',
    'backend-guide:my-guide',
    'https://grafana.com/docs/grafana/latest/',
  ])('leaves %s unchanged', (url) => {
    expect(canonicalContentFileUrl(url)).toEqual({ url });
  });
});

describe('contentFileSiblingUrl', () => {
  it('swaps either content file for the sibling, keeping the query', () => {
    expect(contentFileSiblingUrl(`${PACKAGE}/content.json`, 'manifest.json')).toBe(`${PACKAGE}/manifest.json`);
    expect(contentFileSiblingUrl(`${PACKAGE}/content.ja.json?x=1`, 'manifest.json')).toBe(
      `${PACKAGE}/manifest.json?x=1`
    );
  });

  it('is undefined for a URL that names no content file', () => {
    expect(contentFileSiblingUrl(`${PACKAGE}/unstyled.html`, 'manifest.json')).toBeUndefined();
  });
});

describe('stripContentFile', () => {
  it.each([
    [`${PACKAGE}/content.json`, PACKAGE],
    [`${PACKAGE}/content.ja.json`, PACKAGE],
    ['bundled:welcome-to-grafana/content.zh-Hans.json', 'bundled:welcome-to-grafana'],
    ['bundled:welcome-to-grafana', 'bundled:welcome-to-grafana'],
    ['/content.json', '/content.json'],
    ['content.json', 'content.json'],
    ['', ''],
    [`${PACKAGE}/content.json?ref=main`, `${PACKAGE}/content.json?ref=main`],
    [`${PACKAGE}/content.json.bak`, `${PACKAGE}/content.json.bak`],
  ])('strips %s to %s', (url, expected) => {
    expect(stripContentFile(url)).toBe(expected);
  });
});
