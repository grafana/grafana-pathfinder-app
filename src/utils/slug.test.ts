import { slugify, uniqueSlug } from './slug';

describe('slugify', () => {
  it('lowercases and hyphenates basic text', () => {
    expect(slugify('Explore your data')).toBe('explore-your-data');
  });

  it('strips diacritics', () => {
    expect(slugify('Café Résumé')).toBe('cafe-resume');
  });

  it('strips punctuation', () => {
    expect(slugify('Hello, World! (Really?)')).toBe('hello-world-really');
  });

  it('preserves leading digits', () => {
    expect(slugify('123 Start with digits')).toBe('123-start-with-digits');
  });

  it('returns an empty string for empty input', () => {
    expect(slugify('')).toBe('');
  });

  it('returns an empty string for input with no alphanumerics', () => {
    expect(slugify('!!!')).toBe('');
  });

  it('trims and collapses repeated separators', () => {
    expect(slugify('  Multiple---dashes___here  ')).toBe('multiple-dashes-here');
  });
});

describe('uniqueSlug', () => {
  it('returns the base slug when it is not taken', () => {
    expect(uniqueSlug('overview', new Set())).toBe('overview');
  });

  it('appends -1 on a single collision', () => {
    expect(uniqueSlug('overview', new Set(['overview']))).toBe('overview-1');
  });

  it('increments through multiple collisions', () => {
    const taken = new Set(['overview', 'overview-1', 'overview-2']);
    expect(uniqueSlug('overview', taken)).toBe('overview-3');
  });

  it('respects a pre-seeded taken set', () => {
    const taken = new Set(['overview', 'overview-1']);
    expect(uniqueSlug('overview', taken)).toBe('overview-2');
    expect(uniqueSlug('summary', taken)).toBe('summary');
  });
});
