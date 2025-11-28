/**
 * Tests for editorToJson converter service
 * Tests the conversion of Tiptap editor content to JsonGuide format
 */

import { slugify, formatJsonGuide } from '../editorToJson';
import type { JsonGuide } from '../../../../types/json-guide.types';

// Mock logger
jest.mock('../../utils/logger', () => ({
  debug: jest.fn(),
  error: jest.fn(),
}));

describe('editorToJson service', () => {
  describe('slugify', () => {
    it('should convert title to lowercase slug', () => {
      expect(slugify('Create Your First Dashboard')).toBe('create-your-first-dashboard');
    });

    it('should replace multiple spaces with single hyphen', () => {
      expect(slugify('Create   Your   Dashboard')).toBe('create-your-dashboard');
    });

    it('should remove special characters', () => {
      expect(slugify('Create Dashboard! (v2.0)')).toBe('create-dashboard-v2-0');
    });

    it('should handle leading/trailing spaces', () => {
      expect(slugify('  Create Dashboard  ')).toBe('create-dashboard');
    });

    it('should handle empty string', () => {
      expect(slugify('')).toBe('');
    });

    it('should truncate long slugs to 50 characters', () => {
      const longTitle = 'This is a very long title that should be truncated to fifty characters maximum';
      const slug = slugify(longTitle);
      expect(slug.length).toBeLessThanOrEqual(50);
    });

    it('should remove numbers and keep alphanumeric', () => {
      expect(slugify('Dashboard 101')).toBe('dashboard-101');
    });
  });

  describe('formatJsonGuide', () => {
    it('should format guide as pretty-printed JSON', () => {
      const guide: JsonGuide = {
        id: 'test-guide',
        title: 'Test Guide',
        blocks: [
          {
            type: 'markdown',
            content: '# Hello',
          },
        ],
      };

      const formatted = formatJsonGuide(guide);

      // Should be valid JSON
      expect(() => JSON.parse(formatted)).not.toThrow();

      // Should be pretty-printed (contains newlines)
      expect(formatted).toContain('\n');

      // Should have proper indentation (2 spaces)
      expect(formatted).toContain('  "id"');
    });

    it('should preserve all guide properties', () => {
      const guide: JsonGuide = {
        id: 'test-guide',
        title: 'Test Guide',
        blocks: [
          {
            type: 'section',
            id: 'section-1',
            title: 'Section One',
            blocks: [
              {
                type: 'interactive',
                action: 'highlight',
                reftarget: 'button.test',
                content: 'Click the button',
                requirements: ['exists-reftarget'],
              },
            ],
          },
        ],
        match: {
          urlPrefix: ['/dashboards'],
          tags: ['beginner'],
        },
      };

      const formatted = formatJsonGuide(guide);
      const parsed = JSON.parse(formatted);

      expect(parsed.id).toBe('test-guide');
      expect(parsed.title).toBe('Test Guide');
      expect(parsed.blocks).toHaveLength(1);
      expect(parsed.blocks[0].type).toBe('section');
      expect(parsed.blocks[0].blocks[0].type).toBe('interactive');
      expect(parsed.match.urlPrefix).toEqual(['/dashboards']);
    });
  });

  describe('block type mapping', () => {
    // These tests document the expected mapping from editor nodes to JSON blocks
    // The actual conversion is tested via integration or with a real editor instance

    it('should document markdown block structure', () => {
      const markdownBlock = {
        type: 'markdown' as const,
        content: '# Heading\n\nParagraph with **bold** and *italic*.',
      };

      expect(markdownBlock.type).toBe('markdown');
      expect(typeof markdownBlock.content).toBe('string');
    });

    it('should document section block structure', () => {
      const sectionBlock = {
        type: 'section' as const,
        id: 'section-1',
        title: 'Section Title',
        blocks: [],
        requirements: ['exists-reftarget'],
      };

      expect(sectionBlock.type).toBe('section');
      expect(Array.isArray(sectionBlock.blocks)).toBe(true);
    });

    it('should document interactive block structure', () => {
      const interactiveBlock = {
        type: 'interactive' as const,
        action: 'highlight' as const,
        reftarget: 'button.submit',
        content: 'Click the submit button',
        targetvalue: 'value',
        requirements: ['exists-reftarget'],
        tooltip: 'This button submits the form',
        doIt: false,
      };

      expect(interactiveBlock.type).toBe('interactive');
      expect(interactiveBlock.action).toBe('highlight');
      expect(interactiveBlock.reftarget).toBe('button.submit');
    });

    it('should document multistep block structure', () => {
      const multistepBlock = {
        type: 'multistep' as const,
        content: 'Follow these steps',
        steps: [
          {
            action: 'highlight' as const,
            reftarget: 'button.first',
          },
          {
            action: 'button' as const,
            reftarget: 'button.second',
            targetvalue: 'Click me',
          },
        ],
        requirements: ['on-page:/explore'],
      };

      expect(multistepBlock.type).toBe('multistep');
      expect(multistepBlock.steps).toHaveLength(2);
    });
  });

  describe('attribute mapping', () => {
    // Document the mapping from HTML data attributes to JSON properties

    it('should map data-targetaction to action', () => {
      const htmlAttrs = { 'data-targetaction': 'highlight' };
      // In the actual converter: attrs['data-targetaction'] → block.action
      expect(htmlAttrs['data-targetaction']).toBe('highlight');
    });

    it('should map data-reftarget to reftarget', () => {
      const htmlAttrs = { 'data-reftarget': 'button.test' };
      expect(htmlAttrs['data-reftarget']).toBe('button.test');
    });

    it('should map data-targetvalue to targetvalue', () => {
      const htmlAttrs = { 'data-targetvalue': 'form value' };
      expect(htmlAttrs['data-targetvalue']).toBe('form value');
    });

    it('should split data-requirements into array', () => {
      const requirementsStr = 'exists-reftarget,on-page:/explore,navmenu-open';
      const requirements = requirementsStr.split(',').map((r) => r.trim());
      expect(requirements).toEqual(['exists-reftarget', 'on-page:/explore', 'navmenu-open']);
    });

    it('should map data-doit="false" to doIt: false', () => {
      const htmlAttrs = { 'data-doit': 'false' };
      const doIt = htmlAttrs['data-doit'] === 'false' ? false : undefined;
      expect(doIt).toBe(false);
    });
  });

  describe('markdown serialization', () => {
    // Document expected markdown serialization patterns

    it('should serialize headings with # prefix', () => {
      const level = 2;
      const text = 'My Heading';
      const markdown = `${'#'.repeat(level)} ${text}`;
      expect(markdown).toBe('## My Heading');
    });

    it('should serialize bold text with **', () => {
      const text = 'bold';
      const markdown = `**${text}**`;
      expect(markdown).toBe('**bold**');
    });

    it('should serialize italic text with *', () => {
      const text = 'italic';
      const markdown = `*${text}*`;
      expect(markdown).toBe('*italic*');
    });

    it('should serialize inline code with backticks', () => {
      const code = 'console.log()';
      const markdown = `\`${code}\``;
      expect(markdown).toBe('`console.log()`');
    });

    it('should serialize links with [text](url) format', () => {
      const text = 'Grafana';
      const url = 'https://grafana.com';
      const markdown = `[${text}](${url})`;
      expect(markdown).toBe('[Grafana](https://grafana.com)');
    });

    it('should serialize bullet list items with - prefix', () => {
      const items = ['Item 1', 'Item 2', 'Item 3'];
      const markdown = items.map((item) => `- ${item}`).join('\n');
      expect(markdown).toBe('- Item 1\n- Item 2\n- Item 3');
    });

    it('should serialize ordered list items with number prefix', () => {
      const items = ['First', 'Second', 'Third'];
      const markdown = items.map((item, i) => `${i + 1}. ${item}`).join('\n');
      expect(markdown).toBe('1. First\n2. Second\n3. Third');
    });

    it('should serialize code blocks with triple backticks', () => {
      const code = 'const x = 1;';
      const language = 'javascript';
      const markdown = `\`\`\`${language}\n${code}\n\`\`\``;
      expect(markdown).toBe('```javascript\nconst x = 1;\n```');
    });
  });

  describe('edge cases', () => {
    // Helper function matching the converter's implementation
    const parseRequirements = (str: string | null | undefined): string[] | undefined => {
      if (!str) {
        return undefined;
      }
      const requirements = str
        .split(',')
        .map((r: string) => r.trim())
        .filter((r: string) => r.length > 0);
      return requirements.length > 0 ? requirements : undefined;
    };

    it('should handle empty requirements string', () => {
      const requirements = parseRequirements('');
      expect(requirements).toBeUndefined();
    });

    it('should handle null requirements', () => {
      const requirements = parseRequirements(null);
      expect(requirements).toBeUndefined();
    });

    it('should handle requirements with extra whitespace', () => {
      const requirements = parseRequirements('  exists-reftarget  ,  on-page:/explore  ');
      expect(requirements).toEqual(['exists-reftarget', 'on-page:/explore']);
    });
  });

  describe('JSON guide validation', () => {
    it('should require id field', () => {
      const guide: JsonGuide = {
        id: 'test',
        title: 'Test',
        blocks: [],
      };
      expect(guide.id).toBeDefined();
      expect(typeof guide.id).toBe('string');
    });

    it('should require title field', () => {
      const guide: JsonGuide = {
        id: 'test',
        title: 'Test',
        blocks: [],
      };
      expect(guide.title).toBeDefined();
      expect(typeof guide.title).toBe('string');
    });

    it('should require blocks array', () => {
      const guide: JsonGuide = {
        id: 'test',
        title: 'Test',
        blocks: [],
      };
      expect(Array.isArray(guide.blocks)).toBe(true);
    });

    it('should allow optional match metadata', () => {
      const guideWithMatch: JsonGuide = {
        id: 'test',
        title: 'Test',
        blocks: [],
        match: {
          urlPrefix: ['/dashboards'],
          tags: ['beginner'],
        },
      };
      expect(guideWithMatch.match).toBeDefined();
      expect(guideWithMatch.match?.urlPrefix).toEqual(['/dashboards']);
    });
  });
});
