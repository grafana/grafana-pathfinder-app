import { validateGuide } from './index';
import { createDeeplyNestedGuide, createWideGuide } from './test-helpers';
import { parseJsonGuide } from '../docs-retrieval/json-parser';

describe('Security Validation', () => {
  describe('XSS Prevention', () => {
    const xssPayloads = [
      '<script>alert("xss")</script>',
      '<img src=x onerror=alert("xss")>',
      'javascript:alert("xss")',
    ];

    xssPayloads.forEach((payload) => {
      it(`should accept payload in markdown content (sanitized at render): ${payload.slice(0, 20)}...`, () => {
        const result = validateGuide({
          id: 'xss-test',
          title: 'Test',
          blocks: [{ type: 'markdown', content: payload }],
        });
        // Content validation itself is loose (string), sanitization happens during rendering
        // But we ensure it doesn't break the parser
        expect(result.isValid).toBe(true);
      });
    });

    describe('Markdown sanitization', () => {
      it('should strip HTML tags from markdown content before parsing', () => {
        const guide = {
          id: 'xss-test',
          title: 'Test',
          blocks: [
            {
              type: 'markdown' as const,
              content: '# Heading\n\n<script>alert("xss")</script>\n\nNormal text here.',
            },
          ],
        };

        const parseResult = parseJsonGuide(guide);
        expect(parseResult.isValid).toBe(true);
        expect(parseResult.data).toBeTruthy();

        // The HTML tags should be stripped, but text content preserved
        const elements = parseResult.data!.elements;
        const textContent = JSON.stringify(elements);
        // Script tag should be removed
        expect(textContent).not.toContain('<script>');
        expect(textContent).not.toContain('alert("xss")');
        // But markdown syntax and normal text should be preserved
        expect(textContent).toContain('Heading');
        expect(textContent).toContain('Normal text here');
      });

      it('should sanitize markdownToHtml output for targetComment', () => {
        const guide = {
          id: 'xss-test',
          title: 'Test',
          blocks: [
            {
              type: 'interactive' as const,
              action: 'highlight' as const,
              reftarget: '.test',
              content: 'Click here',
              tooltip: '**Bold text** <script>alert("xss")</script>',
            },
          ],
        };

        const parseResult = parseJsonGuide(guide);
        expect(parseResult.isValid).toBe(true);
        expect(parseResult.data).toBeTruthy();

        // Find the interactive step element
        const stepElement = parseResult.data!.elements.find((el: any) => el.type === 'interactive-step');
        expect(stepElement).toBeTruthy();

        // targetComment should be sanitized HTML (script tag removed)
        const targetComment = stepElement?.props.targetComment;
        expect(targetComment).toBeTruthy();
        // Script tag should be removed by DOMPurify
        expect(targetComment).not.toContain('<script>');
        expect(targetComment).not.toContain('alert("xss")');
        // But markdown formatting should be preserved (converted to HTML)
        expect(targetComment).toContain('<strong>');
        expect(targetComment).toContain('Bold text');
      });

      it('should preserve legitimate markdown syntax after sanitization', () => {
        const guide = {
          id: 'markdown-test',
          title: 'Test',
          blocks: [
            {
              type: 'markdown' as const,
              content: `# Heading 1

## Heading 2

**Bold text** and *italic text*

- List item 1
- List item 2

\`inline code\`

[Link text](https://example.com)

\`\`\`javascript
const code = "block";
\`\`\`
`,
            },
          ],
        };

        const parseResult = parseJsonGuide(guide);
        expect(parseResult.isValid).toBe(true);
        expect(parseResult.data).toBeTruthy();

        // All markdown elements should be parsed correctly
        const elements = parseResult.data!.elements;
        expect(elements.length).toBeGreaterThan(0);

        // Helper to recursively search for element types (handles div wrappers)
        const findElementType = (els: any[], type: string | string[]): boolean => {
          const types = Array.isArray(type) ? type : [type];
          for (const el of els) {
            if (types.includes(el.type)) {
              return true;
            }
            if (el.children && Array.isArray(el.children)) {
              if (findElementType(el.children, type)) {
                return true;
              }
            }
          }
          return false;
        };

        // Verify headings are parsed (check recursively for div wrappers)
        const hasHeading = findElementType(elements, ['h1', 'h2']);
        expect(hasHeading).toBe(true);

        // Verify lists are parsed
        const hasList = findElementType(elements, ['ul', 'ol']);
        expect(hasList).toBe(true);

        // Verify code blocks are parsed
        const hasCodeBlock = findElementType(elements, 'code-block');
        expect(hasCodeBlock).toBe(true);
      });
    });
  });

  describe('URL Validation', () => {
    const dangerousUrls = [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'ftp://example.com',
    ];

    dangerousUrls.forEach((url) => {
      it(`should reject dangerous image URL: ${url}`, () => {
        const result = validateGuide({
          id: 'url-test',
          title: 'Test',
          blocks: [{ type: 'image', src: url }],
        });
        expect(result.isValid).toBe(false);
        expect(result.errors.some((e) => e.message.includes('http or https'))).toBe(true);
      });

      it(`should reject dangerous video URL: ${url}`, () => {
        const result = validateGuide({
          id: 'url-test',
          title: 'Test',
          blocks: [{ type: 'video', src: url }],
        });
        expect(result.isValid).toBe(false);
      });
    });

    it('should accept https URLs', () => {
      const result = validateGuide({
        id: 'test',
        title: 'Test',
        blocks: [{ type: 'image', src: 'https://example.com/img.png' }],
      });
      expect(result.isValid).toBe(true);
    });

    it('should accept http URLs', () => {
      const result = validateGuide({
        id: 'test',
        title: 'Test',
        blocks: [{ type: 'image', src: 'http://example.com/img.png' }],
      });
      expect(result.isValid).toBe(true);
    });
  });

  describe('Nesting Limits', () => {
    it('should accept 5-level nesting', () => {
      const guide = createDeeplyNestedGuide(5);
      const result = validateGuide(guide);
      expect(result.isValid).toBe(true);
    });

    it('should reject 6-level nesting', () => {
      const result = validateGuide(createDeeplyNestedGuide(6));
      expect(result.isValid).toBe(false);
    });

    it('should handle wide sections (100 blocks)', () => {
      const guide = createWideGuide(100);
      const result = validateGuide(guide);
      expect(result.isValid).toBe(true);
    });
  });

  describe('Boundary Values', () => {
    it('should reject empty id', () => {
      const result = validateGuide({ id: '', title: 'Test', blocks: [] });
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.path.includes('id'))).toBe(true);
    });

    it('should accept 10KB content', () => {
      const result = validateGuide({
        id: 'test',
        title: 'Test',
        blocks: [{ type: 'markdown', content: 'x'.repeat(10240) }],
      });
      expect(result.isValid).toBe(true);
    });

    it('should handle unicode', () => {
      const result = validateGuide({
        id: 'test',
        title: '日本語',
        blocks: [{ type: 'markdown', content: '🎉 中文' }],
      });
      expect(result.isValid).toBe(true);
    });
  });
});
