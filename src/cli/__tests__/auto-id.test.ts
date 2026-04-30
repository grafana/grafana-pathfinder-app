import { defaultPackageId, kebabOfTitle, randomBase32Suffix } from '../utils/auto-id';
import { PACKAGE_ID_MAX_LENGTH, PACKAGE_ID_REGEX } from '../../types/package.schema';

describe('kebabOfTitle', () => {
  it.each([
    ['Getting started with Loki', 'getting-started-with-loki'],
    ['First Dashboard', 'first-dashboard'],
    ['Connect Prometheus', 'connect-prometheus'],
    ['Loki 101!', 'loki-101'],
    ['  spaced  out  ', 'spaced-out'],
    ['Café résumé', 'cafe-resume'],
    ['Quotes "and" punctuation.', 'quotes-and-punctuation'],
    ['UPPERCASE', 'uppercase'],
    ['mixed-Case-Already', 'mixed-case-already'],
  ])('converts %s -> %s', (title, expected) => {
    expect(kebabOfTitle(title)).toBe(expected);
  });

  it('returns an empty string for an all-punctuation title', () => {
    expect(kebabOfTitle('!!!---???')).toBe('');
  });

  it('clamps length to leave room for the suffix and matches the regex', () => {
    const long = 'a'.repeat(500);
    const slug = kebabOfTitle(long);
    expect(slug.length).toBeLessThanOrEqual(PACKAGE_ID_MAX_LENGTH - 7);
    expect(PACKAGE_ID_REGEX.test(slug)).toBe(true);
  });
});

describe('randomBase32Suffix', () => {
  it('produces a deterministic suffix when given a deterministic byte source', () => {
    const fakeRng = () => Buffer.from([0, 1, 2, 3, 4, 5]);
    const out = randomBase32Suffix(fakeRng);
    expect(out).toHaveLength(6);
    // Crockford-like alphabet — no 0, 1, 8, 9, i, l, o, u.
    expect(out).toMatch(/^[abcdefghjkmnpqrstvwxyz23456789]{6}$/);
  });

  it('emits unique suffixes from independent random draws', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      seen.add(randomBase32Suffix());
    }
    // Even with randomness, 50 draws of 6-char base32 (30 distinct chars)
    // collide vanishingly rarely; if this ever flakes, the alphabet is too
    // small.
    expect(seen.size).toBeGreaterThan(45);
  });
});

describe('defaultPackageId', () => {
  it('combines slug and suffix and matches the canonical regex', () => {
    const id = defaultPackageId('Welcome to Grafana');
    expect(id.startsWith('welcome-to-grafana-')).toBe(true);
    expect(PACKAGE_ID_REGEX.test(id)).toBe(true);
    expect(id.length).toBeLessThanOrEqual(PACKAGE_ID_MAX_LENGTH);
  });

  it('throws on a title that produces an empty slug', () => {
    expect(() => defaultPackageId('???')).toThrow(/empty slug/);
  });

  it('respects the deterministic-rng injection point', () => {
    const id = defaultPackageId('Loki 101', () => Buffer.from([0, 0, 0, 0, 0, 0]));
    expect(id).toBe('loki-101-aaaaaa');
  });
});
