
import { validateGuide } from '../index';
import { createDeeplyNestedGuide, createWideGuide } from './test-utils';

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
        // Nested level 6 means: Section -> Section -> ... (6 times) -> Markdown
        // The schema allows 5 levels of recursion.
        // Level 0 (Root blocks) -> Section (contains Level 1)
        // Level 1 -> Section (contains Level 2)
        // ...
        // Level 4 -> Section (contains Level 5)
        // Level 5 -> CANNOT contain Section (must be NonRecursive)
        
        // If we createDeeplyNestedGuide(6), we have 6 sections nested.
        // The innermost section (the 6th one) will be at Level 5.
        // But it contains 'blocks'.
        // Wait, createDeeplyNestedGuide(1) returns { blocks: [{ type: 'section', blocks: [markdown] }] }
        // This is 1 level of nesting.
        
        // Let's trace createBlockSchemaWithDepth:
        // depth(0) -> allows Section(blocks: depth(1))
        // depth(1) -> allows Section(blocks: depth(2))
        // ...
        // depth(4) -> allows Section(blocks: depth(5))
        // depth(5) -> returns NonRecursiveBlockSchema (NO Section)
        
        // So valid structure:
        // Guide -> Section (from depth 0) -> Section (from depth 1) -> ... -> Section (from depth 4) -> Markdown (from depth 5)
        // Total sections: 5.
        
        // createDeeplyNestedGuide(5) creates 5 sections. This should be VALID.
        // createDeeplyNestedGuide(6) creates 6 sections. The 6th section (innermost) is inside the 5th section.
        // The 5th section is validated by depth(4), which expects blocks of depth(5).
        // Depth(5) does NOT allow Section.
        // So the 6th section (which is a Section) will fail validation against Depth(5) schema.
        
      const guide = createDeeplyNestedGuide(6);
      const result = validateGuide(guide);
      expect(result.isValid).toBe(false);
      // It might fail with "invalid_union" or specific type error
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

