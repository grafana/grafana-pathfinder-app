import { localeChain } from './locale-chain';

describe('localeChain', () => {
  it('lists a region tag, then its language', () => {
    expect(localeChain('ja-JP')).toEqual(['ja-JP', 'ja']);
  });

  it('walks every prefix of a longer tag', () => {
    expect(localeChain('zh-Hant-TW')).toEqual(['zh-Hant-TW', 'zh-Hant', 'zh']);
  });

  it('is just the tag for a bare language', () => {
    expect(localeChain('ja')).toEqual(['ja']);
  });
});
