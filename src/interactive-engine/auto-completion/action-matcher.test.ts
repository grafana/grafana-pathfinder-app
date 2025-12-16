/**
 * Tests for regex pattern matching utilities in action-matcher.ts
 *
 * @module action-matcher.test
 */

import { isRegexPattern, parseRegexPattern, matchesRegexPattern, matchFormValue } from './action-matcher';

describe('isRegexPattern', () => {
  describe('detects slash-delimited patterns', () => {
    it('should detect /pattern/', () => {
      expect(isRegexPattern('/test/')).toBe(true);
    });

    it('should detect /pattern/flags', () => {
      expect(isRegexPattern('/test/i')).toBe(true);
      expect(isRegexPattern('/test/gi')).toBe(true);
    });

    it('should detect complex patterns', () => {
      expect(isRegexPattern('/^https?:\\/\\//')).toBe(true);
      expect(isRegexPattern('/[a-z-]+/')).toBe(true);
    });

    it('should not detect single slash', () => {
      // A single slash is not a valid regex pattern
      expect(isRegexPattern('/test')).toBe(false);
      expect(isRegexPattern('test/')).toBe(false);
    });
  });

  describe('detects anchor patterns', () => {
    it('should detect ^ start anchor', () => {
      expect(isRegexPattern('^https://')).toBe(true);
      expect(isRegexPattern('^')).toBe(true);
    });

    it('should detect $ end anchor', () => {
      expect(isRegexPattern('example.com$')).toBe(true);
      expect(isRegexPattern('$')).toBe(true);
    });

    it('should detect both anchors', () => {
      expect(isRegexPattern('^exact$')).toBe(true);
    });
  });

  describe('rejects non-patterns', () => {
    it('should reject plain strings', () => {
      expect(isRegexPattern('exact-value')).toBe(false);
      expect(isRegexPattern('hello world')).toBe(false);
      expect(isRegexPattern('my-dashboard-name')).toBe(false);
    });

    it('should reject empty/null values', () => {
      expect(isRegexPattern('')).toBe(false);
      expect(isRegexPattern(null as unknown as string)).toBe(false);
      expect(isRegexPattern(undefined as unknown as string)).toBe(false);
    });

    it('should reject URLs without anchors', () => {
      expect(isRegexPattern('https://grafana.com')).toBe(false);
      expect(isRegexPattern('http://localhost:3000')).toBe(false);
    });
  });
});

describe('parseRegexPattern', () => {
  describe('parses slash-delimited patterns', () => {
    it('should parse /pattern/', () => {
      const regex = parseRegexPattern('/test/');
      expect(regex).not.toBeNull();
      expect(regex?.test('test')).toBe(true);
      expect(regex?.test('TEST')).toBe(false);
    });

    it('should parse /pattern/i with case-insensitive flag', () => {
      const regex = parseRegexPattern('/test/i');
      expect(regex).not.toBeNull();
      expect(regex?.test('test')).toBe(true);
      expect(regex?.test('TEST')).toBe(true);
    });

    it('should parse /pattern/g with global flag', () => {
      const regex = parseRegexPattern('/test/g');
      expect(regex).not.toBeNull();
      expect(regex?.global).toBe(true);
    });

    it('should handle escaped characters', () => {
      const regex = parseRegexPattern('/^https?:\\/\\//');
      expect(regex).not.toBeNull();
      expect(regex?.test('https://')).toBe(true);
      expect(regex?.test('http://')).toBe(true);
    });
  });

  describe('parses anchor patterns', () => {
    it('should parse ^pattern', () => {
      const regex = parseRegexPattern('^https://');
      expect(regex).not.toBeNull();
      expect(regex?.test('https://grafana.com')).toBe(true);
      expect(regex?.test('http://grafana.com')).toBe(false);
    });

    it('should parse pattern$', () => {
      const regex = parseRegexPattern('.com$');
      expect(regex).not.toBeNull();
      expect(regex?.test('grafana.com')).toBe(true);
      expect(regex?.test('grafana.io')).toBe(false);
    });

    it('should parse ^pattern$', () => {
      const regex = parseRegexPattern('^exact$');
      expect(regex).not.toBeNull();
      expect(regex?.test('exact')).toBe(true);
      expect(regex?.test('exact value')).toBe(false);
      expect(regex?.test('not exact')).toBe(false);
    });
  });

  describe('handles invalid patterns', () => {
    it('should return null for empty string', () => {
      expect(parseRegexPattern('')).toBeNull();
    });

    it('should return null for invalid regex', () => {
      // Unclosed character class
      const result = parseRegexPattern('/[invalid/');
      expect(result).toBeNull();
    });
  });
});

describe('matchesRegexPattern', () => {
  it('should match using slash-delimited pattern', () => {
    expect(matchesRegexPattern('test', '/test/')).toBe(true);
    expect(matchesRegexPattern('TEST', '/test/i')).toBe(true);
    expect(matchesRegexPattern('other', '/test/')).toBe(false);
  });

  it('should match using anchor pattern', () => {
    expect(matchesRegexPattern('https://grafana.com', '^https://')).toBe(true);
    expect(matchesRegexPattern('http://grafana.com', '^https://')).toBe(false);
  });

  it('should handle null/undefined values', () => {
    expect(matchesRegexPattern(null as unknown as string, '/test/')).toBe(false);
    expect(matchesRegexPattern(undefined as unknown as string, '/test/')).toBe(false);
  });

  it('should handle invalid patterns gracefully', () => {
    expect(matchesRegexPattern('test', '/[invalid/')).toBe(false);
  });
});

describe('matchFormValue', () => {
  describe('regex pattern matching', () => {
    it('should use regex matching for patterns starting with ^', () => {
      const result = matchFormValue('https://grafana.com', '^https://');
      expect(result.isMatch).toBe(true);
      expect(result.usedRegex).toBe(true);
    });

    it('should use regex matching for patterns ending with $', () => {
      const result = matchFormValue('grafana.com', '.com$');
      expect(result.isMatch).toBe(true);
      expect(result.usedRegex).toBe(true);
    });

    it('should use regex matching for slash-delimited patterns', () => {
      const result = matchFormValue('my-dashboard-name', '/^[a-z-]+$/');
      expect(result.isMatch).toBe(true);
      expect(result.usedRegex).toBe(true);
    });

    it('should return false for non-matching regex', () => {
      const result = matchFormValue('http://grafana.com', '^https://');
      expect(result.isMatch).toBe(false);
      expect(result.usedRegex).toBe(true);
    });
  });

  describe('exact string matching (backward compatibility)', () => {
    it('should use exact matching for plain strings', () => {
      const result = matchFormValue('exact-value', 'exact-value');
      expect(result.isMatch).toBe(true);
      expect(result.usedRegex).toBe(false);
    });

    it('should fail exact matching for non-matching strings', () => {
      const result = matchFormValue('different', 'exact-value');
      expect(result.isMatch).toBe(false);
      expect(result.usedRegex).toBe(false);
    });

    it('should use exact matching for URLs without anchors', () => {
      const result = matchFormValue('https://grafana.com', 'https://grafana.com');
      expect(result.isMatch).toBe(true);
      expect(result.usedRegex).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should accept any value when expectedValue is undefined', () => {
      const result = matchFormValue('anything', undefined);
      expect(result.isMatch).toBe(true);
      expect(result.usedRegex).toBe(false);
    });

    it('should accept any value when expectedValue is empty', () => {
      const result = matchFormValue('anything', '');
      expect(result.isMatch).toBe(true);
      expect(result.usedRegex).toBe(false);
    });

    it('should fail when actualValue is undefined', () => {
      const result = matchFormValue(undefined, 'expected');
      expect(result.isMatch).toBe(false);
    });

    it('should include expectedPattern in result', () => {
      const result = matchFormValue('test', '^https://');
      expect(result.expectedPattern).toBe('^https://');
    });
  });

  describe('real-world patterns', () => {
    it('should validate URL format', () => {
      // URL must start with https://
      expect(matchFormValue('https://grafana.com', '^https://').isMatch).toBe(true);
      expect(matchFormValue('http://grafana.com', '^https://').isMatch).toBe(false);
      expect(matchFormValue('ftp://files.com', '^https://').isMatch).toBe(false);
    });

    it('should validate email-like patterns', () => {
      const emailPattern = '/^[^@]+@[^@]+\\.[^@]+$/';
      expect(matchFormValue('user@example.com', emailPattern).isMatch).toBe(true);
      expect(matchFormValue('invalid-email', emailPattern).isMatch).toBe(false);
    });

    it('should validate dashboard names', () => {
      // Dashboard names: lowercase letters, numbers, and dashes only
      const namePattern = '/^[a-z0-9-]+$/';
      expect(matchFormValue('my-dashboard-123', namePattern).isMatch).toBe(true);
      expect(matchFormValue('My Dashboard', namePattern).isMatch).toBe(false);
      expect(matchFormValue('dashboard_name', namePattern).isMatch).toBe(false);
    });

    it('should validate numeric values', () => {
      // Only digits
      const numericPattern = '/^\\d+$/';
      expect(matchFormValue('12345', numericPattern).isMatch).toBe(true);
      expect(matchFormValue('123.45', numericPattern).isMatch).toBe(false);
      expect(matchFormValue('12a45', numericPattern).isMatch).toBe(false);
    });
  });
});
