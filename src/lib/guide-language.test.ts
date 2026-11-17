import {
  buildLocaleChain,
  FOLLOW_GRAFANA,
  normalizeGuideLanguagePreference,
  parseBcp47Tag,
  resolveEffectiveGuideLanguage,
} from './guide-language';

describe('buildLocaleChain', () => {
  it.each([
    ['ja-JP', 'en', ['ja-JP', 'ja', 'en']],
    ['ja', 'en', ['ja', 'en']],
    ['en-US', 'en', ['en-US', 'en']],
    ['en', 'en', ['en']],
    ['zh-Hans-CN', 'en', ['zh-Hans-CN', 'zh-Hans', 'zh', 'en']],
    ['pt-BR', 'pt', ['pt-BR', 'pt']],
    ['ja-JP', 'ja', ['ja-JP', 'ja']],
    ['en-US', 'en-GB', ['en-US', 'en', 'en-GB']],
    ['en-GB', 'en', ['en-GB', 'en']],
  ])('%s with canonical %s gives %j', (effective, canonical, expected) => {
    expect(buildLocaleChain(effective, canonical)).toEqual(expected);
  });

  it('puts the canonical language last and removes duplicates', () => {
    const chain = buildLocaleChain('en-GB', 'en-GB');
    expect(chain).toEqual(['en-GB']);
    expect(new Set(chain).size).toBe(chain.length);
  });

  it('normalizes the case of a tag', () => {
    expect(buildLocaleChain('JA-jp', 'EN')).toEqual(['ja-JP', 'ja', 'en']);
  });

  it('degrades to the canonical language for a tag with extension subtags', () => {
    expect(buildLocaleChain('ja-JP-u-ca-japanese', 'en')).toEqual(['en']);
  });

  it('degrades to the canonical language for an unusable tag', () => {
    expect(buildLocaleChain('', 'en')).toEqual(['en']);
    expect(buildLocaleChain('not a tag', 'en')).toEqual(['en']);
    expect(buildLocaleChain(FOLLOW_GRAFANA, 'en')).toEqual(['en']);
  });

  it('falls back to en when the canonical language is unusable', () => {
    expect(buildLocaleChain('ja', '')).toEqual(['ja', 'en']);
  });

  it('does not mutate shared state between calls', () => {
    expect(buildLocaleChain('ja-JP', 'en')).toEqual(buildLocaleChain('ja-JP', 'en'));
  });
});

describe('parseBcp47Tag', () => {
  it.each([
    ['ja', 'ja'],
    ['ja-JP', 'ja-JP'],
    ['  pt-br ', 'pt-BR'],
    ['zh-Hans-CN', 'zh-Hans-CN'],
    ['iw', 'iw'],
  ])('accepts %j as %j', (input, expected) => {
    expect(parseBcp47Tag(input)).toBe(expected);
  });

  it.each([
    [undefined],
    [null],
    [42],
    [''],
    ['   '],
    ['ja_JP'],
    ['not a tag'],
    ['follow-grafana'],
    ['browser'],
    ['ja-'],
    ['ja-JP-u-ca-japanese'],
  ])('rejects %j', (input) => {
    expect(parseBcp47Tag(input)).toBeNull();
  });
});

describe('normalizeGuideLanguagePreference', () => {
  it('reads a valid tag', () => {
    expect(normalizeGuideLanguagePreference('ja-JP')).toBe('ja-JP');
  });

  it('keeps follow-grafana', () => {
    expect(normalizeGuideLanguagePreference(FOLLOW_GRAFANA)).toBe(FOLLOW_GRAFANA);
  });

  it.each([[undefined], [null], [''], ['nonsense value'], [7], [{ language: 'ja' }]])(
    'reads %j as follow-grafana',
    (stored) => {
      expect(normalizeGuideLanguagePreference(stored)).toBe(FOLLOW_GRAFANA);
    }
  );
});

describe('resolveEffectiveGuideLanguage', () => {
  const base = { override: null, preferred: FOLLOW_GRAFANA, grafanaUiLocale: 'ja-JP', canonicalLanguage: 'en' };

  it('prefers the override over everything', () => {
    expect(resolveEffectiveGuideLanguage({ ...base, override: 'fr', preferred: 'de' })).toBe('fr');
  });

  it('then the saved tag', () => {
    expect(resolveEffectiveGuideLanguage({ ...base, preferred: 'de' })).toBe('de');
  });

  it("then Grafana's UI locale", () => {
    expect(resolveEffectiveGuideLanguage(base)).toBe('ja-JP');
  });

  it('then the canonical language when the UI locale is missing', () => {
    expect(resolveEffectiveGuideLanguage({ ...base, grafanaUiLocale: undefined })).toBe('en');
  });
});
