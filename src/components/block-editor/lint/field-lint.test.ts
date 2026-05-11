/**
 * Tests for field-level lint.
 *
 * Focus: behavior (which inputs produce diagnostics, what suggestions look
 * like, mid-edit suppression). We don't pin specific message strings — those
 * come from the canonical condition-validator and are tested there.
 */

import { lintConditionField, replaceTokenInConditionField, removeTokenFromConditionField } from './field-lint';

describe('lintConditionField', () => {
  describe('happy path', () => {
    it('returns no diagnostics for an empty field', () => {
      expect(lintConditionField('').diagnostics).toEqual([]);
      expect(lintConditionField('   ').diagnostics).toEqual([]);
    });

    it('returns no diagnostics for valid fixed requirements', () => {
      expect(lintConditionField('exists-reftarget').diagnostics).toEqual([]);
      expect(lintConditionField('navmenu-open').diagnostics).toEqual([]);
      expect(lintConditionField('is-admin').diagnostics).toEqual([]);
    });

    it('returns no diagnostics for valid parameterized requirements', () => {
      expect(lintConditionField('on-page:/explore').diagnostics).toEqual([]);
      expect(lintConditionField('has-datasource:prometheus').diagnostics).toEqual([]);
      expect(lintConditionField('min-version:11.0.0').diagnostics).toEqual([]);
      expect(lintConditionField('var-policyAccepted:true').diagnostics).toEqual([]);
    });

    it('accepts comma-separated mixes', () => {
      const result = lintConditionField('exists-reftarget, on-page:/explore, has-role:editor');
      expect(result.diagnostics).toEqual([]);
    });
  });

  describe('typo detection and suggestions', () => {
    it('flags an unknown bare token', () => {
      const result = lintConditionField('totally-bogus');
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]!.severity).toBe('warning');
      expect(result.diagnostics[0]!.code).toBe('condition.unknown_type');
      expect(result.diagnostics[0]!.tokenAtFault).toBe('totally-bogus');
    });

    it('offers a near-match suggestion for misspelled fixed requirements', () => {
      // `is-amdin` is one transposition away from `is-admin`.
      const result = lintConditionField('is-amdin');
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]!.suggestion).toBe('is-admin');
      expect(result.diagnostics[0]!.tokenAtFault).toBe('is-amdin');
    });

    it('offers a near-match suggestion for misspelled parameterized prefixes', () => {
      // `n-page:/foo` is one insertion away from the real `on-page:` prefix.
      // suggestRequirement should propose `on-page:/foo`, preserving the
      // user's argument.
      const result = lintConditionField('n-page:/foo');
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]!.suggestion).toBe('on-page:/foo');
      expect(result.diagnostics[0]!.tokenAtFault).toBe('n-page:/foo');
    });

    it('flags a parameterized requirement that is missing its argument', () => {
      const result = lintConditionField('on-page:');
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]!.code).toBe('condition.missing_argument');
    });

    it('flags a fixed requirement that has been given an argument', () => {
      const result = lintConditionField('is-admin:true');
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]!.code).toBe('condition.unexpected_argument');
    });

    it('flags an on-page argument that does not start with a slash', () => {
      const result = lintConditionField('on-page:explore');
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]!.code).toBe('condition.invalid_format');
    });
  });

  describe('mid-edit suppression', () => {
    it('does NOT flag a token that is a strict prefix of a known fixed requirement', () => {
      // Author is mid-typing `exists-reftarget`.
      const result = lintConditionField('exists-r');
      expect(result.diagnostics).toEqual([]);
    });

    it('does NOT flag a token that is a strict prefix of a known parameterized prefix', () => {
      // Author is mid-typing `on-page:/explore`.
      expect(lintConditionField('on-pa').diagnostics).toEqual([]);
      expect(lintConditionField('on-page').diagnostics).toEqual([]);
    });

    it('DOES flag the same prefix-looking token when suppression is disabled', () => {
      // Tests that the suppression toggle works (used by the parity test).
      const result = lintConditionField('on-pa', { suppressInProgress: false });
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]!.code).toBe('condition.unknown_type');
    });

    it('still flags a fully-typed unknown token even if it overlaps a prefix', () => {
      // `on-pag` is not a prefix of `on-page:` (they differ at position 6 where
      // `on-pag` ends but `on-page:` has `e`); but `on-pag` IS a prefix of
      // `on-page:` (since `on-page:`.startsWith(`on-pag`) is true). So
      // suppression keeps `on-pag` quiet — that's the desired behaviour.
      // But `on-pog` (a typo) IS NOT a prefix of any known requirement and
      // SHOULD be flagged.
      const result = lintConditionField('on-pog');
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]!.code).toBe('condition.unknown_type');
    });
  });

  describe('comma-separated handling', () => {
    it('reports diagnostics for each bad token in a list', () => {
      const result = lintConditionField('exists-reftarget, totally-bogus, on-page:no-slash');
      expect(result.diagnostics).toHaveLength(2);
      const codes = result.diagnostics.map((d) => d.code);
      expect(codes).toContain('condition.unknown_type');
      expect(codes).toContain('condition.invalid_format');
    });
  });
});

describe('replaceTokenInConditionField', () => {
  it('replaces a single token preserving spaces around it', () => {
    expect(replaceTokenInConditionField('is-amdin', 'is-amdin', 'is-admin')).toBe('is-admin');
    expect(replaceTokenInConditionField(' is-amdin ', 'is-amdin', 'is-admin')).toBe(' is-admin ');
  });

  it('replaces only the first occurrence', () => {
    expect(replaceTokenInConditionField('is-amdin, is-amdin', 'is-amdin', 'is-admin')).toBe('is-admin, is-amdin');
  });

  it('preserves untouched tokens around the replacement', () => {
    expect(replaceTokenInConditionField('exists-reftarget, is-amdin, on-page:/x', 'is-amdin', 'is-admin')).toBe(
      'exists-reftarget, is-admin, on-page:/x'
    );
  });

  it('returns the original value unchanged if the bad token is not present', () => {
    const value = 'exists-reftarget, on-page:/x';
    expect(replaceTokenInConditionField(value, 'is-amdin', 'is-admin')).toBe(value);
  });
});

describe('removeTokenFromConditionField', () => {
  it('removes a single token and trims leading/trailing whitespace', () => {
    expect(removeTokenFromConditionField('foo', 'foo')).toBe('');
    expect(removeTokenFromConditionField('  foo  ', 'foo')).toBe('');
  });

  it('removes the first occurrence and leaves later duplicates intact', () => {
    expect(removeTokenFromConditionField('foo, bar, foo', 'foo')).toBe('bar, foo');
  });

  it('cleans up commas left behind when the bad token is at the start', () => {
    expect(removeTokenFromConditionField('foo, exists-reftarget, on-page:/x', 'foo')).toBe(
      'exists-reftarget, on-page:/x'
    );
  });

  it('cleans up commas left behind when the bad token is at the end', () => {
    expect(removeTokenFromConditionField('exists-reftarget, on-page:/x, bar', 'bar')).toBe(
      'exists-reftarget, on-page:/x'
    );
  });

  it('returns the original value unchanged if the bad token is not present', () => {
    const value = 'exists-reftarget, on-page:/x';
    expect(removeTokenFromConditionField(value, 'foo')).toBe(value);
  });
});
