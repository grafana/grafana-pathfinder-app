/**
 * Tests for block conversion utilities
 *
 * Tests focus on generic behavior rather than every conversion pair.
 */

import { getAvailableConversions, getConversionWarning, convertBlockType } from './block-conversion';
import type { JsonBlock } from '../../../types/json-guide.types';

describe('getAvailableConversions', () => {
  describe('container types', () => {
    it('should return empty array for section type', () => {
      expect(getAvailableConversions('section')).toEqual([]);
    });

    it('should return empty array for conditional type', () => {
      expect(getAvailableConversions('conditional')).toEqual([]);
    });
  });

  describe('non-container types', () => {
    it('should return all non-container types except the source type', () => {
      const result = getAvailableConversions('markdown');

      // Should not include source type
      expect(result).not.toContain('markdown');

      // Should not include container types
      expect(result).not.toContain('section');
      expect(result).not.toContain('conditional');

      // Should include other non-container types
      expect(result).toContain('html');
      expect(result).toContain('image');
      expect(result).toContain('video');
      expect(result).toContain('interactive');
      expect(result).toContain('multistep');
      expect(result).toContain('guided');
      expect(result).toContain('quiz');
      expect(result).toContain('input');
    });

    it('should return 8 options for any non-container type', () => {
      // 9 non-container types minus 1 (the source type) = 8
      expect(getAvailableConversions('markdown')).toHaveLength(8);
      expect(getAvailableConversions('html')).toHaveLength(8);
      expect(getAvailableConversions('quiz')).toHaveLength(8);
      expect(getAvailableConversions('interactive')).toHaveLength(8);
    });
  });
});

describe('getConversionWarning', () => {
  describe('no data loss scenarios', () => {
    it('should return null when converting markdown to html (content maps)', () => {
      const source: JsonBlock = { type: 'markdown', content: 'hello' };
      expect(getConversionWarning(source, 'html')).toBeNull();
    });

    it('should return null when only common fields are present', () => {
      const source: JsonBlock = {
        type: 'markdown',
        content: 'hello',
      };
      expect(getConversionWarning(source, 'interactive')).toBeNull();
    });
  });

  describe('data loss scenarios', () => {
    it('should warn about lost fields when converting quiz to markdown', () => {
      const source: JsonBlock = {
        type: 'quiz',
        question: 'What is 2+2?',
        choices: [
          { id: 'a', text: '3' },
          { id: 'b', text: '4', correct: true },
        ],
        multiSelect: true,
      };
      const warning = getConversionWarning(source, 'markdown');

      expect(warning).not.toBeNull();
      expect(warning!.lostFields).toContain('choices');
      expect(warning!.lostFields).toContain('multiSelect');
    });

    it('should warn about lost fields when converting interactive to markdown', () => {
      const source: JsonBlock = {
        type: 'interactive',
        action: 'button',
        reftarget: '[data-testid="btn"]',
        content: 'Click the button',
        showMe: true,
        doIt: true,
      };
      const warning = getConversionWarning(source, 'markdown');

      expect(warning).not.toBeNull();
      expect(warning!.lostFields).toContain('action');
      expect(warning!.lostFields).toContain('reftarget');
      expect(warning!.lostFields).toContain('showMe');
      expect(warning!.lostFields).toContain('doIt');
    });

    it('should warn about lost fields when converting image to interactive', () => {
      const source: JsonBlock = {
        type: 'image',
        src: 'https://example.com/img.png',
        alt: 'Test image',
        width: 800,
        height: 600,
      };
      const warning = getConversionWarning(source, 'interactive');

      expect(warning).not.toBeNull();
      expect(warning!.lostFields).toContain('src');
      expect(warning!.lostFields).toContain('alt');
      expect(warning!.lostFields).toContain('width');
      expect(warning!.lostFields).toContain('height');
    });
  });

  describe('common fields handling', () => {
    it('should not include common fields in lost fields', () => {
      const source: JsonBlock = {
        type: 'interactive',
        action: 'button',
        reftarget: '[data-testid="btn"]',
        content: 'Test',
        requirements: ['req1', 'req2'],
        objectives: ['obj1'],
        skippable: true,
      };
      const warning = getConversionWarning(source, 'markdown');

      expect(warning).not.toBeNull();
      // Common fields should NOT be in lost fields
      expect(warning!.lostFields).not.toContain('requirements');
      expect(warning!.lostFields).not.toContain('objectives');
      expect(warning!.lostFields).not.toContain('skippable');
    });
  });
});

describe('convertBlockType', () => {
  describe('same type conversion', () => {
    it('should return the same block when types match', () => {
      const source: JsonBlock = { type: 'markdown', content: 'hello' };
      const result = convertBlockType(source, 'markdown');
      expect(result).toBe(source);
    });
  });

  describe('container block restrictions', () => {
    it('should throw when trying to convert from section', () => {
      const source: JsonBlock = { type: 'section', blocks: [] };
      expect(() => convertBlockType(source, 'markdown')).toThrow(/container blocks/i);
    });

    it('should throw when trying to convert from conditional', () => {
      const source: JsonBlock = { type: 'conditional', conditions: ['test'], whenTrue: [], whenFalse: [] };
      expect(() => convertBlockType(source, 'markdown')).toThrow(/container blocks/i);
    });

    it('should throw when trying to convert to section', () => {
      const source: JsonBlock = { type: 'markdown', content: 'hello' };
      expect(() => convertBlockType(source, 'section')).toThrow(/container blocks/i);
    });

    it('should throw when trying to convert to conditional', () => {
      const source: JsonBlock = { type: 'markdown', content: 'hello' };
      expect(() => convertBlockType(source, 'conditional')).toThrow(/container blocks/i);
    });
  });

  describe('content field mapping', () => {
    it('should map content from markdown to html', () => {
      const source: JsonBlock = { type: 'markdown', content: 'Hello world' };
      const result = convertBlockType(source, 'html');
      expect(result.type).toBe('html');
      expect((result as { content: string }).content).toBe('Hello world');
    });

    it('should map content from markdown to interactive', () => {
      const source: JsonBlock = { type: 'markdown', content: 'Click the button' };
      const result = convertBlockType(source, 'interactive');
      expect(result.type).toBe('interactive');
      expect((result as { content: string }).content).toBe('Click the button');
    });

    it('should map content to question when converting to quiz', () => {
      const source: JsonBlock = { type: 'markdown', content: 'What is 2+2?' };
      const result = convertBlockType(source, 'quiz');
      expect(result.type).toBe('quiz');
      expect((result as { question: string }).question).toBe('What is 2+2?');
    });

    it('should map question to prompt when converting quiz to input', () => {
      const source: JsonBlock = {
        type: 'quiz',
        question: 'Enter your name',
        choices: [{ id: 'a', text: 'A', correct: true }],
      };
      const result = convertBlockType(source, 'input');
      expect(result.type).toBe('input');
      expect((result as { prompt: string }).prompt).toBe('Enter your name');
    });
  });

  describe('common fields preservation', () => {
    it('should preserve requirements field', () => {
      // Using interactive -> multistep since both support requirements
      const source: JsonBlock = {
        type: 'interactive',
        action: 'noop',
        content: 'Test',
        requirements: ['req1', 'req2'],
      };
      const result = convertBlockType(source, 'multistep');
      expect((result as { requirements?: string[] }).requirements).toEqual(['req1', 'req2']);
    });

    it('should preserve objectives field', () => {
      const source: JsonBlock = {
        type: 'interactive',
        action: 'noop',
        content: 'Test',
        objectives: ['obj1'],
      };
      const result = convertBlockType(source, 'guided');
      expect((result as { objectives?: string[] }).objectives).toEqual(['obj1']);
    });

    it('should preserve skippable field', () => {
      const source: JsonBlock = {
        type: 'interactive',
        action: 'noop',
        content: 'Test',
        skippable: true,
      };
      const result = convertBlockType(source, 'multistep');
      expect((result as { skippable?: boolean }).skippable).toBe(true);
    });
  });

  describe('required defaults', () => {
    it('should apply default choices when converting to quiz', () => {
      const source: JsonBlock = { type: 'markdown', content: 'Question?' };
      const result = convertBlockType(source, 'quiz');
      const quizResult = result as { choices: Array<{ id: string; text: string; correct?: boolean }> };
      expect(quizResult.choices).toBeDefined();
      expect(quizResult.choices.length).toBeGreaterThan(0);
    });

    it('should apply default inputType and variableName when converting to input', () => {
      const source: JsonBlock = { type: 'markdown', content: 'Enter value' };
      const result = convertBlockType(source, 'input');
      const inputResult = result as { inputType: string; variableName: string };
      expect(inputResult.inputType).toBe('text');
      expect(inputResult.variableName).toBe('userInput');
    });

    it('should apply placeholder URL when converting to image', () => {
      const source: JsonBlock = { type: 'markdown', content: 'Test' };
      const result = convertBlockType(source, 'image');
      const imageResult = result as { src: string; alt?: string };
      expect(imageResult.src).toBe('https://placeholder.invalid/replace-me');
      expect(imageResult.alt).toBe('');
    });

    it('should apply placeholder URL when converting to video', () => {
      const source: JsonBlock = { type: 'markdown', content: 'Test' };
      const result = convertBlockType(source, 'video');
      const videoResult = result as { src: string };
      expect(videoResult.src).toBe('https://placeholder.invalid/replace-me');
    });

    it('should apply default action when converting to interactive', () => {
      const source: JsonBlock = { type: 'markdown', content: 'Test' };
      const result = convertBlockType(source, 'interactive');
      const interactiveResult = result as { action: string };
      expect(interactiveResult.action).toBe('noop');
    });

    it('should apply default steps when converting to multistep', () => {
      const source: JsonBlock = { type: 'markdown', content: 'Test' };
      const result = convertBlockType(source, 'multistep');
      const multistepResult = result as { steps: Array<{ action: string }> };
      expect(multistepResult.steps).toBeDefined();
      expect(multistepResult.steps.length).toBeGreaterThan(0);
      expect(multistepResult.steps[0]!.action).toBe('noop');
    });

    it('should apply default steps when converting to guided', () => {
      const source: JsonBlock = { type: 'markdown', content: 'Test' };
      const result = convertBlockType(source, 'guided');
      const guidedResult = result as { steps: Array<{ action: string }> };
      expect(guidedResult.steps).toBeDefined();
      expect(guidedResult.steps.length).toBeGreaterThan(0);
      expect(guidedResult.steps[0]!.action).toBe('noop');
    });
  });

  describe('shared field copying', () => {
    it('should copy fields that exist in both source and target schemas', () => {
      // Both interactive and guided support completeEarly
      const source: JsonBlock = {
        type: 'interactive',
        action: 'noop',
        content: 'Test',
        completeEarly: true,
      };
      const result = convertBlockType(source, 'guided');
      expect((result as { completeEarly?: boolean }).completeEarly).toBe(true);
    });

    it('should not copy fields that only exist in source schema', () => {
      // showMe/doIt only exist on interactive, not on html
      const source: JsonBlock = {
        type: 'interactive',
        action: 'noop',
        content: 'Test',
        showMe: true,
        doIt: true,
      };
      const result = convertBlockType(source, 'html');
      expect((result as unknown as Record<string, unknown>).showMe).toBeUndefined();
      expect((result as unknown as Record<string, unknown>).doIt).toBeUndefined();
    });
  });

  describe('schema validation', () => {
    it('should produce valid blocks that pass schema validation for all types', () => {
      const source: JsonBlock = { type: 'markdown', content: 'Test content' };

      // All conversions should produce valid blocks (image/video use placeholder URLs)
      expect(() => convertBlockType(source, 'html')).not.toThrow();
      expect(() => convertBlockType(source, 'interactive')).not.toThrow();
      expect(() => convertBlockType(source, 'multistep')).not.toThrow();
      expect(() => convertBlockType(source, 'guided')).not.toThrow();
      expect(() => convertBlockType(source, 'quiz')).not.toThrow();
      expect(() => convertBlockType(source, 'input')).not.toThrow();
      expect(() => convertBlockType(source, 'image')).not.toThrow();
      expect(() => convertBlockType(source, 'video')).not.toThrow();
    });
  });
});
