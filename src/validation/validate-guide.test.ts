/**
 * Schema Validation Tests
 *
 * Tests for the Zod schemas in json-guide.schema.ts
 */

import { validateGuideFromString } from './index';

describe('JsonGuideSchema', () => {
  describe('happy path - valid guides', () => {
    it('should validate a minimal valid guide', () => {
      const guide = JSON.stringify({
        id: 'test-guide',
        title: 'Test Guide',
        blocks: [{ type: 'markdown', content: '# Hello World' }],
      });
      const result = validateGuideFromString(guide);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.guide).not.toBeNull();
    });

    it('should validate a guide with schemaVersion', () => {
      const guide = JSON.stringify({
        schemaVersion: '1.0',
        id: 'versioned-guide',
        title: 'Versioned Guide',
        blocks: [{ type: 'markdown', content: 'Content' }],
      });
      const result = validateGuideFromString(guide);
      expect(result.isValid).toBe(true);
    });

    it('should validate a guide with match metadata', () => {
      const guide = JSON.stringify({
        id: 'matched-guide',
        title: 'Matched Guide',
        blocks: [{ type: 'markdown', content: 'Content' }],
        match: {
          urlPrefix: ['/dashboards', '/explore'],
          tags: ['beginner', 'tutorial'],
        },
      });
      const result = validateGuideFromString(guide);
      expect(result.isValid).toBe(true);
    });

    it('should validate all block types', () => {
      const guide = JSON.stringify({
        id: 'all-blocks',
        title: 'All Block Types',
        blocks: [
          { type: 'markdown', content: '# Markdown' },
          { type: 'html', content: '<p>HTML</p>' },
          { type: 'image', src: 'https://example.com/img.png' },
          { type: 'video', src: 'https://youtube.com/watch?v=abc' },
          {
            type: 'interactive',
            action: 'highlight',
            reftarget: '[data-testid="test"]',
            content: 'Interactive step',
          },
          {
            type: 'multistep',
            content: 'Multistep block',
            steps: [{ action: 'button', reftarget: '[data-testid="btn"]' }],
          },
          {
            type: 'guided',
            content: 'Guided block',
            steps: [{ action: 'highlight', reftarget: '[data-testid="target"]' }],
          },
          {
            type: 'section',
            title: 'Section',
            blocks: [{ type: 'markdown', content: 'Nested' }],
          },
          {
            type: 'quiz',
            question: 'What is 2+2?',
            choices: [
              { id: 'a', text: '3' },
              { id: 'b', text: '4', correct: true },
            ],
          },
          {
            type: 'assistant',
            blocks: [{ type: 'markdown', content: 'AI content' }],
          },
        ],
      });
      const result = validateGuideFromString(guide);
      expect(result.isValid).toBe(true);
    });
  });

  describe('required fields', () => {
    it('should reject guide without id', () => {
      const guide = JSON.stringify({
        title: 'Test',
        blocks: [],
      });
      const result = validateGuideFromString(guide);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should reject guide without title', () => {
      const guide = JSON.stringify({
        id: 'test',
        blocks: [],
      });
      const result = validateGuideFromString(guide);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should reject guide without blocks', () => {
      const guide = JSON.stringify({
        id: 'test',
        title: 'Test',
      });
      const result = validateGuideFromString(guide);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('block validation', () => {
    it('should reject unknown block types', () => {
      const guide = JSON.stringify({
        id: 'test',
        title: 'Test',
        blocks: [{ type: 'unknown-block' }],
      });
      const result = validateGuideFromString(guide);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should reject blocks without type', () => {
      const guide = JSON.stringify({
        id: 'test',
        title: 'Test',
        blocks: [{ content: 'No type' }],
      });
      const result = validateGuideFromString(guide);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should reject markdown block without content', () => {
      const guide = JSON.stringify({
        id: 'test',
        title: 'Test',
        blocks: [{ type: 'markdown' }],
      });
      const result = validateGuideFromString(guide);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should reject interactive block without required fields', () => {
      const guide = JSON.stringify({
        id: 'test',
        title: 'Test',
        blocks: [{ type: 'interactive' }],
      });
      const result = validateGuideFromString(guide);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should reject formfill without targetvalue', () => {
      const guide = JSON.stringify({
        id: 'test',
        title: 'Test',
        blocks: [
          {
            type: 'interactive',
            action: 'formfill',
            reftarget: '[data-testid="input"]',
            content: 'Fill this',
          },
        ],
      });
      const result = validateGuideFromString(guide);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('nested blocks', () => {
    it('should validate nested blocks in sections', () => {
      const guide = JSON.stringify({
        id: 'test',
        title: 'Test',
        blocks: [
          {
            type: 'section',
            blocks: [{ type: 'markdown', content: 'Nested' }],
          },
        ],
      });
      const result = validateGuideFromString(guide);
      expect(result.isValid).toBe(true);
    });

    it('should reject invalid nested blocks', () => {
      const guide = JSON.stringify({
        id: 'test',
        title: 'Test',
        blocks: [
          {
            type: 'section',
            blocks: [{ type: 'markdown' }], // missing content
          },
        ],
      });
      const result = validateGuideFromString(guide);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('strict mode', () => {
    it('should pass warnings as errors in strict mode', () => {
      const guide = JSON.stringify({
        id: 'test',
        title: 'Test',
        blocks: [{ type: 'markdown', content: 'Test', unknownField: true }],
      });
      const result = validateGuideFromString(guide, { strict: true });
      expect(result.isValid).toBe(false);
    });

    it('should allow unknown fields in non-strict mode', () => {
      const guide = JSON.stringify({
        id: 'test',
        title: 'Test',
        blocks: [{ type: 'markdown', content: 'Test', unknownField: true }],
      });
      const result = validateGuideFromString(guide);
      expect(result.isValid).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });
});
