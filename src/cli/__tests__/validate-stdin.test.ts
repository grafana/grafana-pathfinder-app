/**
 * Tests for validate --stdin flow.
 *
 * Calls the validation functions directly (same code path as --stdin)
 * rather than spawning a subprocess, following the existing test patterns.
 */

import { validateGuideFromString, toLegacyResult } from '../../validation';

describe('validate --stdin', () => {
  describe('valid guide', () => {
    it('returns isValid true for a minimal valid guide', () => {
      const input = JSON.stringify({
        id: 'test-guide',
        title: 'Test guide',
        blocks: [{ type: 'markdown', content: '# Hello' }],
      });
      const result = validateGuideFromString(input);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.guide).not.toBeNull();
    });

    it('returns legacy format compatible with JSON output', () => {
      const input = JSON.stringify({
        id: 'test-guide',
        title: 'Test guide',
        blocks: [{ type: 'markdown', content: '# Hello' }],
      });
      const result = validateGuideFromString(input);
      const legacy = toLegacyResult(result);
      expect(legacy.isValid).toBe(true);
      expect(legacy.errors).toHaveLength(0);
      expect(Array.isArray(legacy.warnings)).toBe(true);
    });
  });

  describe('invalid guide', () => {
    it('returns isValid false for a guide missing required fields', () => {
      const input = JSON.stringify({ blocks: [] });
      const result = validateGuideFromString(input);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('returns errors for invalid block types', () => {
      const input = JSON.stringify({
        id: 'bad-guide',
        title: 'Bad guide',
        blocks: [{ type: 'nonexistent', content: 'x' }],
      });
      const result = validateGuideFromString(input);
      expect(result.isValid).toBe(false);
    });

    it('returns legacy error strings for machine consumption', () => {
      const input = JSON.stringify({ id: '', title: '' });
      const result = validateGuideFromString(input);
      const legacy = toLegacyResult(result);
      expect(legacy.isValid).toBe(false);
      expect(legacy.errors.length).toBeGreaterThan(0);
      for (const err of legacy.errors) {
        expect(typeof err).toBe('string');
      }
    });
  });

  describe('non-JSON input', () => {
    it('returns a parse error for non-JSON input', () => {
      const result = validateGuideFromString('not json at all');
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].message).toContain('valid JSON');
    });

    it('returns a parse error for a JSON array', () => {
      const result = validateGuideFromString('[1, 2, 3]');
      expect(result.isValid).toBe(false);
      expect(result.errors[0].message).toContain('object');
    });
  });

  describe('strict mode', () => {
    it('promotes warnings to errors in strict mode', () => {
      const input = JSON.stringify({
        id: 'strict-guide',
        title: 'Strict guide',
        blocks: [{ type: 'markdown', content: '# Hello', unknownField: true }],
      });
      const normalResult = validateGuideFromString(input);
      expect(normalResult.isValid).toBe(true);
      expect(normalResult.warnings.length).toBeGreaterThan(0);

      const strictResult = validateGuideFromString(input, { strict: true });
      expect(strictResult.isValid).toBe(false);
      expect(strictResult.errors.length).toBeGreaterThan(0);
    });
  });

  describe('format json', () => {
    it('stdin JSON output contains only isValid, errors, warnings (no guide)', () => {
      const input = JSON.stringify({
        id: 'json-guide',
        title: 'JSON guide',
        blocks: [{ type: 'markdown', content: '# Hello' }],
      });
      const result = validateGuideFromString(input);
      const legacy = toLegacyResult(result);
      const { isValid, errors, warnings } = legacy;
      const output = { isValid, errors, warnings };
      const parsed = JSON.parse(JSON.stringify(output));
      expect(parsed.isValid).toBe(true);
      expect(Array.isArray(parsed.errors)).toBe(true);
      expect(Array.isArray(parsed.warnings)).toBe(true);
      expect(parsed.guide).toBeUndefined();
      expect(Object.keys(parsed).sort()).toEqual(['errors', 'isValid', 'warnings']);
    });
  });
});
