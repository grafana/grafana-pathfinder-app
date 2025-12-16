/**
 * Tests for block import utilities
 *
 * Tests focus on behavior (pass/fail) rather than specific error message wording.
 */

import { validateFile, parseAndValidateGuide, MAX_FILE_SIZE } from './block-import';

describe('validateFile', () => {
  const createMockFile = (name: string, size: number, type = 'application/json'): File => {
    const content = new Array(size).fill('x').join('');
    const blob = new Blob([content], { type });
    return new File([blob], name, { type });
  };

  describe('file size validation', () => {
    it('should accept files under 1MB', () => {
      const file = createMockFile('guide.json', 1000);
      const result = validateFile(file);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept files exactly at 1MB', () => {
      const file = createMockFile('guide.json', MAX_FILE_SIZE);
      const result = validateFile(file);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject files over 1MB', () => {
      const file = createMockFile('guide.json', MAX_FILE_SIZE + 1);
      const result = validateFile(file);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('file type validation', () => {
    it('should accept .json files', () => {
      const file = createMockFile('guide.json', 100);
      const result = validateFile(file);
      expect(result.isValid).toBe(true);
    });

    it('should accept files with application/json MIME type', () => {
      const file = createMockFile('guide', 100, 'application/json');
      const result = validateFile(file);
      expect(result.isValid).toBe(true);
    });

    it('should reject non-JSON files', () => {
      const file = createMockFile('guide.txt', 100, 'text/plain');
      const result = validateFile(file);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});

describe('parseAndValidateGuide', () => {
  describe('JSON parsing', () => {
    it('should reject invalid JSON syntax', () => {
      const result = parseAndValidateGuide('{ invalid json }');
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should reject empty string', () => {
      const result = parseAndValidateGuide('');
      expect(result.isValid).toBe(false);
    });

    it('should reject non-object JSON', () => {
      const result = parseAndValidateGuide('["array"]');
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should reject null', () => {
      const result = parseAndValidateGuide('null');
      expect(result.isValid).toBe(false);
    });
  });

  describe('required top-level fields', () => {
    it('should reject guide without id', () => {
      const guide = JSON.stringify({ title: 'Test', blocks: [] });
      const result = parseAndValidateGuide(guide);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should reject guide without title', () => {
      const guide = JSON.stringify({ id: 'test', blocks: [] });
      const result = parseAndValidateGuide(guide);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should reject guide without blocks', () => {
      const guide = JSON.stringify({ id: 'test', title: 'Test' });
      const result = parseAndValidateGuide(guide);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should accept valid minimal guide', () => {
      const guide = JSON.stringify({ id: 'test', title: 'Test', blocks: [] });
      const result = parseAndValidateGuide(guide);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.guide).toEqual({ id: 'test', title: 'Test', blocks: [] });
    });
  });

  describe('block type validation', () => {
    it('should accept known block types', () => {
      const guide = JSON.stringify({
        id: 'test',
        title: 'Test',
        blocks: [
          { type: 'markdown', content: '# Hello' },
          { type: 'html', content: '<p>Hello</p>' },
          { type: 'image', src: 'https://example.com/img.png' },
          { type: 'video', src: 'https://youtube.com/watch?v=123' },
        ],
      });
      const result = parseAndValidateGuide(guide);
      expect(result.isValid).toBe(true);
    });

    it('should reject unknown block types', () => {
      const guide = JSON.stringify({
        id: 'test',
        title: 'Test',
        blocks: [{ type: 'unknown-type', content: 'test' }],
      });
      const result = parseAndValidateGuide(guide);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should reject blocks without type', () => {
      const guide = JSON.stringify({
        id: 'test',
        title: 'Test',
        blocks: [{ content: 'no type here' }],
      });
      const result = parseAndValidateGuide(guide);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('markdown block validation', () => {
    it('should accept valid markdown block', () => {
      const guide = JSON.stringify({
        id: 'test',
        title: 'Test',
        blocks: [{ type: 'markdown', content: '# Hello World' }],
      });
      const result = parseAndValidateGuide(guide);
      expect(result.isValid).toBe(true);
    });

    it('should reject markdown block without content', () => {
      const guide = JSON.stringify({
        id: 'test',
        title: 'Test',
        blocks: [{ type: 'markdown' }],
      });
      const result = parseAndValidateGuide(guide);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('html block validation', () => {
    it('should accept valid html block', () => {
      const guide = JSON.stringify({
        id: 'test',
        title: 'Test',
        blocks: [{ type: 'html', content: '<p>Hello</p>' }],
      });
      const result = parseAndValidateGuide(guide);
      expect(result.isValid).toBe(true);
    });

    it('should reject html block without content', () => {
      const guide = JSON.stringify({
        id: 'test',
        title: 'Test',
        blocks: [{ type: 'html' }],
      });
      const result = parseAndValidateGuide(guide);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('image block validation', () => {
    it('should accept valid image block', () => {
      const guide = JSON.stringify({
        id: 'test',
        title: 'Test',
        blocks: [{ type: 'image', src: 'https://example.com/img.png' }],
      });
      const result = parseAndValidateGuide(guide);
      expect(result.isValid).toBe(true);
    });

    it('should reject image block without src', () => {
      const guide = JSON.stringify({
        id: 'test',
        title: 'Test',
        blocks: [{ type: 'image' }],
      });
      const result = parseAndValidateGuide(guide);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('video block validation', () => {
    it('should accept valid video block', () => {
      const guide = JSON.stringify({
        id: 'test',
        title: 'Test',
        blocks: [{ type: 'video', src: 'https://youtube.com/watch?v=abc' }],
      });
      const result = parseAndValidateGuide(guide);
      expect(result.isValid).toBe(true);
    });

    it('should reject video block without src', () => {
      const guide = JSON.stringify({
        id: 'test',
        title: 'Test',
        blocks: [{ type: 'video' }],
      });
      const result = parseAndValidateGuide(guide);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('interactive block validation', () => {
    it('should accept valid interactive block', () => {
      const guide = JSON.stringify({
        id: 'test',
        title: 'Test',
        blocks: [
          {
            type: 'interactive',
            action: 'highlight',
            reftarget: '[data-testid="sidebar"]',
            content: 'Click here',
          },
        ],
      });
      const result = parseAndValidateGuide(guide);
      expect(result.isValid).toBe(true);
    });

    it('should reject interactive block without action', () => {
      const guide = JSON.stringify({
        id: 'test',
        title: 'Test',
        blocks: [
          {
            type: 'interactive',
            reftarget: '[data-testid="sidebar"]',
            content: 'Click here',
          },
        ],
      });
      const result = parseAndValidateGuide(guide);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should reject interactive block with unknown action', () => {
      const guide = JSON.stringify({
        id: 'test',
        title: 'Test',
        blocks: [
          {
            type: 'interactive',
            action: 'unknown-action',
            reftarget: '[data-testid="sidebar"]',
            content: 'Click here',
          },
        ],
      });
      const result = parseAndValidateGuide(guide);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should reject interactive block without reftarget', () => {
      const guide = JSON.stringify({
        id: 'test',
        title: 'Test',
        blocks: [
          {
            type: 'interactive',
            action: 'highlight',
            content: 'Click here',
          },
        ],
      });
      const result = parseAndValidateGuide(guide);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should reject interactive block without content', () => {
      const guide = JSON.stringify({
        id: 'test',
        title: 'Test',
        blocks: [
          {
            type: 'interactive',
            action: 'highlight',
            reftarget: '[data-testid="sidebar"]',
          },
        ],
      });
      const result = parseAndValidateGuide(guide);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should accept formfill action without targetvalue when validateInput is not set', () => {
      // With validateInput toggle, formfill without targetvalue is now valid
      // (any non-empty input will complete the step)
      const guide = JSON.stringify({
        id: 'test',
        title: 'Test',
        blocks: [
          {
            type: 'interactive',
            action: 'formfill',
            reftarget: '[data-testid="input"]',
            content: 'Fill this input',
          },
        ],
      });
      const result = parseAndValidateGuide(guide);
      expect(result.isValid).toBe(true);
    });

    it('should reject formfill action with validateInput: true but no targetvalue', () => {
      const guide = JSON.stringify({
        id: 'test',
        title: 'Test',
        blocks: [
          {
            type: 'interactive',
            action: 'formfill',
            reftarget: '[data-testid="input"]',
            content: 'Fill this input',
            validateInput: true,
          },
        ],
      });
      const result = parseAndValidateGuide(guide);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should accept formfill action with targetvalue', () => {
      const guide = JSON.stringify({
        id: 'test',
        title: 'Test',
        blocks: [
          {
            type: 'interactive',
            action: 'formfill',
            reftarget: '[data-testid="input"]',
            targetvalue: 'Hello World',
            content: 'Fill this input',
          },
        ],
      });
      const result = parseAndValidateGuide(guide);
      expect(result.isValid).toBe(true);
    });
  });

  describe('multistep block validation', () => {
    it('should accept valid multistep block', () => {
      const guide = JSON.stringify({
        id: 'test',
        title: 'Test',
        blocks: [
          {
            type: 'multistep',
            content: 'Follow these steps',
            steps: [{ action: 'highlight', reftarget: '[data-testid="btn"]' }],
          },
        ],
      });
      const result = parseAndValidateGuide(guide);
      expect(result.isValid).toBe(true);
    });

    it('should reject multistep block without content', () => {
      const guide = JSON.stringify({
        id: 'test',
        title: 'Test',
        blocks: [
          {
            type: 'multistep',
            steps: [{ action: 'highlight', reftarget: '[data-testid="btn"]' }],
          },
        ],
      });
      const result = parseAndValidateGuide(guide);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should reject multistep block without steps', () => {
      const guide = JSON.stringify({
        id: 'test',
        title: 'Test',
        blocks: [
          {
            type: 'multistep',
            content: 'Follow these steps',
          },
        ],
      });
      const result = parseAndValidateGuide(guide);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should validate steps within multistep block', () => {
      const guide = JSON.stringify({
        id: 'test',
        title: 'Test',
        blocks: [
          {
            type: 'multistep',
            content: 'Follow these steps',
            steps: [{ action: 'highlight' }], // missing reftarget
          },
        ],
      });
      const result = parseAndValidateGuide(guide);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('guided block validation', () => {
    it('should accept valid guided block', () => {
      const guide = JSON.stringify({
        id: 'test',
        title: 'Test',
        blocks: [
          {
            type: 'guided',
            content: 'Follow along',
            steps: [{ action: 'button', reftarget: '[data-testid="submit"]' }],
          },
        ],
      });
      const result = parseAndValidateGuide(guide);
      expect(result.isValid).toBe(true);
    });

    it('should reject guided block without content', () => {
      const guide = JSON.stringify({
        id: 'test',
        title: 'Test',
        blocks: [
          {
            type: 'guided',
            steps: [{ action: 'button', reftarget: '[data-testid="submit"]' }],
          },
        ],
      });
      const result = parseAndValidateGuide(guide);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should reject guided block without steps', () => {
      const guide = JSON.stringify({
        id: 'test',
        title: 'Test',
        blocks: [
          {
            type: 'guided',
            content: 'Follow along',
          },
        ],
      });
      const result = parseAndValidateGuide(guide);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('section block validation', () => {
    it('should accept valid section block', () => {
      const guide = JSON.stringify({
        id: 'test',
        title: 'Test',
        blocks: [
          {
            type: 'section',
            title: 'Section 1',
            blocks: [{ type: 'markdown', content: '# Hello' }],
          },
        ],
      });
      const result = parseAndValidateGuide(guide);
      expect(result.isValid).toBe(true);
    });

    it('should reject section block without blocks array', () => {
      const guide = JSON.stringify({
        id: 'test',
        title: 'Test',
        blocks: [
          {
            type: 'section',
            title: 'Section 1',
          },
        ],
      });
      const result = parseAndValidateGuide(guide);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should validate nested blocks within section', () => {
      const guide = JSON.stringify({
        id: 'test',
        title: 'Test',
        blocks: [
          {
            type: 'section',
            title: 'Section 1',
            blocks: [{ type: 'markdown' }], // missing content
          },
        ],
      });
      const result = parseAndValidateGuide(guide);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('match metadata validation', () => {
    it('should accept valid match metadata', () => {
      const guide = JSON.stringify({
        id: 'test',
        title: 'Test',
        blocks: [],
        match: {
          urlPrefix: ['/dashboards', '/explore'],
          tags: ['beginner', 'tutorial'],
        },
      });
      const result = parseAndValidateGuide(guide);
      expect(result.isValid).toBe(true);
    });

    it('should reject non-array urlPrefix', () => {
      const guide = JSON.stringify({
        id: 'test',
        title: 'Test',
        blocks: [],
        match: {
          urlPrefix: '/dashboards', // should be array
        },
      });
      const result = parseAndValidateGuide(guide);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should reject non-array tags', () => {
      const guide = JSON.stringify({
        id: 'test',
        title: 'Test',
        blocks: [],
        match: {
          tags: 'beginner', // should be array
        },
      });
      const result = parseAndValidateGuide(guide);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('warnings', () => {
    it('should warn about empty blocks array', () => {
      const guide = JSON.stringify({
        id: 'test',
        title: 'Test',
        blocks: [],
      });
      const result = parseAndValidateGuide(guide);
      expect(result.isValid).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('multiple errors', () => {
    it('should collect all validation errors', () => {
      const guide = JSON.stringify({
        id: 'test',
        title: 'Test',
        blocks: [
          { type: 'markdown' }, // missing content
          { type: 'image' }, // missing src
          { type: 'unknown' }, // unknown type
        ],
      });
      const result = parseAndValidateGuide(guide);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    });
  });
});
