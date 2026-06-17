/**
 * @jest-environment node
 *
 * Tests for the P7 session token generator + validator + logging helpers.
 */

import {
  generateSessionToken,
  isValidSessionToken,
  normalizeSessionToken,
  tokenLogHash,
  tokenLogPrefix,
} from '../session-token';

// Mirror the constants from session-token.ts. Kept in sync with the
// implementation by the alphabet/length tests below.
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
const TOKEN_LENGTH = 22;

describe('generateSessionToken', () => {
  it('returns a string of the expected length', () => {
    const token = generateSessionToken();
    expect(token).toHaveLength(TOKEN_LENGTH);
  });

  it('uses only the Crockford-lowercase alphabet', () => {
    // 64 samples is enough to make a stray excluded char vanishingly unlikely
    // if the alphabet were broader than intended.
    for (let i = 0; i < 64; i++) {
      const token = generateSessionToken();
      for (const ch of token) {
        expect(ALPHABET).toContain(ch);
      }
    }
  });

  it('never emits the excluded lookalike letters i, l, o, u', () => {
    const excluded = ['i', 'l', 'o', 'u'];
    for (let i = 0; i < 128; i++) {
      const token = generateSessionToken();
      for (const ch of excluded) {
        expect(token).not.toContain(ch);
      }
    }
  });

  it('produces unique tokens across many calls (collision sanity check)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      seen.add(generateSessionToken());
    }
    expect(seen.size).toBe(1000);
  });
});

describe('isValidSessionToken', () => {
  it('accepts a freshly generated token', () => {
    expect(isValidSessionToken(generateSessionToken())).toBe(true);
  });

  it('rejects the empty string', () => {
    expect(isValidSessionToken('')).toBe(false);
  });

  it('rejects non-string input', () => {
    expect(isValidSessionToken(undefined)).toBe(false);
    expect(isValidSessionToken(null)).toBe(false);
    expect(isValidSessionToken(123)).toBe(false);
    expect(isValidSessionToken({})).toBe(false);
  });

  it('rejects too-short and too-long strings of valid characters', () => {
    expect(isValidSessionToken('a'.repeat(TOKEN_LENGTH - 1))).toBe(false);
    expect(isValidSessionToken('a'.repeat(TOKEN_LENGTH + 1))).toBe(false);
  });

  it('rejects mixed case (caller must normalize first)', () => {
    // Generate until we get a token containing at least one letter we can
    // upper-case. Digit-only tokens are theoretically possible but happen
    // with probability ~10/32 per char — rare enough this loop terminates
    // in one or two tries, and we want a deterministic test, not a
    // probabilistic skip.
    for (let attempt = 0; attempt < 16; attempt++) {
      const token = generateSessionToken();
      const idx = [...token].findIndex((ch) => ch >= 'a' && ch <= 'z');
      if (idx === -1) {
        continue;
      }
      const upcased = token.slice(0, idx) + token[idx]!.toUpperCase() + token.slice(idx + 1);
      expect(upcased).not.toBe(token);
      expect(isValidSessionToken(upcased)).toBe(false);
      return;
    }
    throw new Error('failed to generate a token with a letter in 16 attempts (highly improbable)');
  });

  it('rejects forbidden lookalike characters', () => {
    const base = '0123456789abcdefghjkmn'; // 22 chars, no forbidden
    expect(isValidSessionToken(base)).toBe(true);
    for (const ch of ['i', 'l', 'o', 'u']) {
      const swapped = ch + base.slice(1);
      expect(isValidSessionToken(swapped)).toBe(false);
    }
  });
});

describe('normalizeSessionToken', () => {
  it('lowercases a mixed-case token', () => {
    const token = generateSessionToken();
    const upper = token.toUpperCase();
    expect(normalizeSessionToken(upper)).toBe(token);
  });

  it('returns the canonical form unchanged when already lowercase', () => {
    const token = generateSessionToken();
    expect(normalizeSessionToken(token)).toBe(token);
  });

  it('returns null for invalid input even after lowering', () => {
    expect(normalizeSessionToken('not-a-token')).toBeNull();
    expect(normalizeSessionToken('Iiiiiiiiiiiiiiiiiiiiii')).toBeNull(); // contains 'i'
    expect(normalizeSessionToken(undefined)).toBeNull();
    expect(normalizeSessionToken(42)).toBeNull();
  });
});

describe('tokenLogPrefix', () => {
  it('returns the first 12 chars of a valid token', () => {
    const token = generateSessionToken();
    expect(tokenLogPrefix(token)).toBe(token.slice(0, 12));
    expect(tokenLogPrefix(token)).toHaveLength(12);
  });

  it('throws on invalid input rather than returning a partial string', () => {
    expect(() => tokenLogPrefix('too-short')).toThrow(/invalid session token/);
    // mixed case is invalid pre-normalization — fail loudly
    const token = generateSessionToken();
    expect(() => tokenLogPrefix(token.toUpperCase())).toThrow(/invalid session token/);
  });
});

describe('tokenLogHash', () => {
  it('is deterministic for the same input', () => {
    const token = generateSessionToken();
    expect(tokenLogHash(token)).toBe(tokenLogHash(token));
  });

  it('returns 16 hex chars', () => {
    const token = generateSessionToken();
    const hash = tokenLogHash(token);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('differs across distinct tokens (collision sanity)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 256; i++) {
      seen.add(tokenLogHash(generateSessionToken()));
    }
    expect(seen.size).toBe(256);
  });

  it('throws on invalid input', () => {
    expect(() => tokenLogHash('too-short')).toThrow(/invalid session token/);
  });
});
