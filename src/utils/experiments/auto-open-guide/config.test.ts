jest.mock('../../find-doc-page', () => ({
  findDocPage: (guide: string) =>
    guide.startsWith('bundled:') && guide !== 'bundled:missing'
      ? { url: guide, title: guide, type: 'docs-page' }
      : null,
}));

import { isAutoOpenGuideConfig, matchesExperience } from './config';

const experience = (guide = 'bundled:a', pages = ['/explore*']) => ({ guide, pages });

describe('isAutoOpenGuideConfig', () => {
  it.each([1, 2, 3])('accepts %i experiences', (count) => {
    const experiences = Array.from({ length: count }, (_, i) => experience(`bundled:${i}`));
    expect(isAutoOpenGuideConfig({ variant: 'treatment', experiences })).toBe(true);
    expect(isAutoOpenGuideConfig({ variant: 'control', experiences })).toBe(true);
  });

  it('accepts a bare excluded payload', () => {
    expect(isAutoOpenGuideConfig({ variant: 'excluded' })).toBe(true);
  });

  it.each([
    ['no experiences', { variant: 'treatment', experiences: [] }],
    ['four experiences', { variant: 'treatment', experiences: [1, 2, 3, 4].map((i) => experience(`bundled:${i}`)) }],
    ['missing experiences', { variant: 'treatment' }],
    ['empty pages', { variant: 'treatment', experiences: [experience('bundled:a', [])] }],
    ['blank page', { variant: 'treatment', experiences: [experience('bundled:a', [' '])] }],
    ['non-string page', { variant: 'treatment', experiences: [{ guide: 'bundled:a', pages: [42] }] }],
    ['non-string guide', { variant: 'treatment', experiences: [{ guide: 42, pages: ['/explore'] }] }],
    ['unresolvable guide', { variant: 'treatment', experiences: [experience('bundled:missing')] }],
    ['non-allowlisted guide', { variant: 'treatment', experiences: [experience('https://evil.example/guide')] }],
    ['one bad experience among good ones', { variant: 'control', experiences: [experience(), { guide: '' }] }],
    ['unknown variant', { variant: 'treament', experiences: [experience()] }],
    ['null', null],
    ['non-object', 'treatment'],
    ['array', [experience()]],
  ])('rejects the whole payload with %s', (_, value) => {
    expect(isAutoOpenGuideConfig(value)).toBe(false);
  });
});

describe('matchesExperience', () => {
  it('matches any page pattern on a segment boundary', () => {
    const target = experience('bundled:a', ['/dashboards', '/explore*']);
    expect(matchesExperience(target, '/explore/metrics')).toBe(true);
    expect(matchesExperience(target, '/dashboards/')).toBe(true);
    expect(matchesExperience(target, '/explorer')).toBe(false);
    expect(matchesExperience(target, '/dashboards/new')).toBe(false);
  });
});
