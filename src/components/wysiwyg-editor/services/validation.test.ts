/**
 * Security-focused tests for WYSIWYG editor validation functions
 * Tests XSS vectors, URL injection, and other security vulnerabilities
 */

import {
  validateCssSelector,
  validateNavigationUrl,
  validateText,
  sanitizeAttributeValue,
  validateSectionId,
  validateRequirement,
  validateFormField,
} from './validation';
import { ACTION_TYPES } from '../../../constants/interactive-config';

// Mock the security module
jest.mock('../../../security', () => ({
  parseUrlSafely: (url: string) => {
    try {
      return new URL(url);
    } catch {
      return null;
    }
  },
  sanitizeTextForDisplay: (text: string) => {
    // Simulate DOMPurify behavior - strip all HTML tags
    return text.replace(/<[^>]*>/g, '');
  },
}));

describe('WYSIWYG Editor Validation - Security Tests', () => {
  describe('validateNavigationUrl - URL injection protection', () => {
    describe('dangerous URL schemes (XSS vectors)', () => {
      it('should reject javascript: URLs', () => {
        const result = validateNavigationUrl('javascript:alert(1)');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('javascript:');
      });

      it('should reject javascript: URLs with mixed case', () => {
        const result = validateNavigationUrl('JaVaScRiPt:alert(1)');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('javascript:');
      });

      it('should reject data: URLs', () => {
        const result = validateNavigationUrl('data:text/html,<script>alert(1)</script>');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('data:');
      });

      it('should reject file: URLs', () => {
        const result = validateNavigationUrl('file:///etc/passwd');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('file:');
      });

      it('should reject vbscript: URLs', () => {
        const result = validateNavigationUrl('vbscript:msgbox(1)');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('vbscript:');
      });

      it('should reject blob: URLs', () => {
        const result = validateNavigationUrl('blob:https://example.com/abc-123');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('blob:');
      });
    });

    describe('safe relative paths', () => {
      it('should accept paths starting with /', () => {
        expect(validateNavigationUrl('/dashboard').valid).toBe(true);
        expect(validateNavigationUrl('/datasources/new').valid).toBe(true);
        expect(validateNavigationUrl('/d/abc123').valid).toBe(true);
      });

      it('should accept paths with query parameters', () => {
        expect(validateNavigationUrl('/dashboard?id=123').valid).toBe(true);
      });

      it('should accept paths with hash fragments', () => {
        expect(validateNavigationUrl('/dashboard#section').valid).toBe(true);
      });
    });

    describe('safe absolute URLs', () => {
      it('should accept http URLs', () => {
        expect(validateNavigationUrl('http://example.com/path').valid).toBe(true);
      });

      it('should accept https URLs', () => {
        expect(validateNavigationUrl('https://grafana.com/docs').valid).toBe(true);
      });

      it('should reject URLs with non-http(s) protocols', () => {
        const result = validateNavigationUrl('ftp://example.com/file');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('http and https');
      });
    });

    describe('edge cases', () => {
      it('should reject empty URLs', () => {
        const result = validateNavigationUrl('');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('empty');
      });

      it('should reject whitespace-only URLs', () => {
        const result = validateNavigationUrl('   ');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('empty');
      });

      it('should reject malformed URLs', () => {
        const result = validateNavigationUrl('not a url at all');
        expect(result.valid).toBe(false);
      });
    });
  });

  describe('validateCssSelector - XSS injection protection', () => {
    describe('dangerous patterns (XSS vectors)', () => {
      it('should reject selectors with <script> tags', () => {
        const result = validateCssSelector('div<script>alert(1)</script>');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('dangerous');
      });

      it('should reject selectors with javascript: protocol', () => {
        const result = validateCssSelector('a[href="javascript:alert(1)"]');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('dangerous');
      });

      it('should reject selectors with onclick handlers', () => {
        const result = validateCssSelector('div[onclick="alert(1)"]');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('dangerous');
      });

      it('should reject selectors with onerror handlers', () => {
        const result = validateCssSelector('img[onerror="alert(1)"]');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('dangerous');
      });

      it('should reject selectors with onload handlers', () => {
        const result = validateCssSelector('body[onload="alert(1)"]');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('dangerous');
      });

      it('should reject selectors with <iframe> tags', () => {
        const result = validateCssSelector('<iframe src="evil.com">');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('dangerous');
      });

      it('should reject selectors with <object> tags', () => {
        const result = validateCssSelector('<object data="evil.swf">');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('dangerous');
      });

      it('should reject selectors with <embed> tags', () => {
        const result = validateCssSelector('<embed src="evil.swf">');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('dangerous');
      });

      it('should reject selectors with data: URIs', () => {
        const result = validateCssSelector('a[href="data:text/html,<script>"]');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('dangerous');
      });

      it('should reject selectors with vbscript: protocol', () => {
        const result = validateCssSelector('a[href="vbscript:msgbox"]');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('dangerous');
      });

      it('should reject selectors with CSS expressions (IE)', () => {
        const result = validateCssSelector('div[style="width:expression(alert(1))"]');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('dangerous');
      });
    });

    describe('safe CSS selectors', () => {
      it('should accept basic element selectors', () => {
        expect(validateCssSelector('button').valid).toBe(true);
        expect(validateCssSelector('div').valid).toBe(true);
        expect(validateCssSelector('input').valid).toBe(true);
      });

      it('should accept class selectors', () => {
        expect(validateCssSelector('.btn-primary').valid).toBe(true);
        expect(validateCssSelector('button.submit').valid).toBe(true);
      });

      it('should accept id selectors', () => {
        expect(validateCssSelector('#submit-btn').valid).toBe(true);
        expect(validateCssSelector('button#submit').valid).toBe(true);
      });

      it('should accept attribute selectors with safe attributes', () => {
        expect(validateCssSelector('button[type="submit"]').valid).toBe(true);
        expect(validateCssSelector('input[name="username"]').valid).toBe(true);
      });

      it('should accept pseudo-classes', () => {
        expect(validateCssSelector('button:hover').valid).toBe(true);
        expect(validateCssSelector('li:first-child').valid).toBe(true);
      });

      it('should accept descendant selectors', () => {
        expect(validateCssSelector('div button').valid).toBe(true);
        expect(validateCssSelector('.container .btn').valid).toBe(true);
      });

      it('should accept child selectors', () => {
        expect(validateCssSelector('div > button').valid).toBe(true);
      });
    });

    describe('edge cases', () => {
      it('should reject empty selectors', () => {
        const result = validateCssSelector('');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('empty');
      });

      it('should reject whitespace-only selectors', () => {
        const result = validateCssSelector('   ');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('empty');
      });

      it('should reject invalid CSS syntax', () => {
        const result = validateCssSelector('button[[[invalid');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('syntax');
      });
    });

    describe(':has() selector support (enhanced selector)', () => {
      it('should accept standalone :has() selectors', () => {
        expect(validateCssSelector('div:has(p)').valid).toBe(true);
        expect(validateCssSelector('button:has(span)').valid).toBe(true);
        expect(validateCssSelector('.card:has(.title)').valid).toBe(true);
      });

      it('should accept :has() with nested :contains()', () => {
        expect(validateCssSelector('div:has(p:contains("text"))').valid).toBe(true);
        expect(validateCssSelector('li:has(span:contains("name"))').valid).toBe(true);
      });

      it('should accept chained :has() selectors', () => {
        expect(validateCssSelector('div:has(a):has(span)').valid).toBe(true);
        expect(validateCssSelector('div:has(p):has(button)').valid).toBe(true);
      });

      it('should accept :has() with attribute selectors', () => {
        expect(validateCssSelector('div:has([data-testid="item"])').valid).toBe(true);
        expect(validateCssSelector('form:has(input[type="submit"])').valid).toBe(true);
      });

      it('should reject empty :has() selectors', () => {
        const result = validateCssSelector('div:has()');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('empty');
      });

      it('should reject :has() with unbalanced parentheses', () => {
        const result = validateCssSelector('div:has(p');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Unbalanced');
      });

      it('should reject :has() with nested unbalanced parentheses', () => {
        const result = validateCssSelector('div:has(p:contains("text")');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Unbalanced');
      });

      it('should accept complex :has() with :nth-match()', () => {
        expect(validateCssSelector('div:has(p:nth-match(1))').valid).toBe(true);
        expect(validateCssSelector('li:has(span:contains("text")):nth-match(2)').valid).toBe(true);
      });
    });
  });

  describe('validateText - XSS protection in text fields', () => {
    it('should reject text with <script> tags', () => {
      const result = validateText('<script>alert(1)</script>');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('dangerous');
    });

    it('should reject text with javascript: protocol', () => {
      const result = validateText('javascript:alert(1)');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('dangerous');
    });

    it('should reject text with mixed case <SCRIPT> tags', () => {
      const result = validateText('<SCRIPT>alert(1)</SCRIPT>');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('dangerous');
    });

    it('should accept safe text', () => {
      expect(validateText('Click the Submit button').valid).toBe(true);
      expect(validateText('Navigate to /dashboard').valid).toBe(true);
      expect(validateText('Button text: Save & Continue').valid).toBe(true);
    });

    it('should reject empty text', () => {
      const result = validateText('');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('should use custom field name in error messages', () => {
      const result = validateText('', 'Button Label');
      expect(result.error).toContain('Button Label');
    });
  });

  describe('sanitizeAttributeValue - DOMPurify integration', () => {
    it('should sanitize text using DOMPurify', () => {
      const result = sanitizeAttributeValue('Hello <b>world</b>');
      expect(result).toBe('Hello world'); // HTML tags stripped
    });

    it('should handle empty values', () => {
      expect(sanitizeAttributeValue('')).toBe('');
    });

    it('should strip script tags', () => {
      const result = sanitizeAttributeValue('test<script>alert(1)</script>');
      expect(result).toBe('testalert(1)'); // Script tags removed, content kept
    });

    it('should handle values with multiple tags', () => {
      const result = sanitizeAttributeValue('<div><span>nested</span></div>');
      expect(result).toBe('nested'); // All tags stripped
    });
  });

  describe('validateSectionId - HTML ID validation', () => {
    it('should accept valid IDs', () => {
      expect(validateSectionId('section-1').valid).toBe(true);
      expect(validateSectionId('my_section').valid).toBe(true);
      expect(validateSectionId('step123').valid).toBe(true);
    });

    it('should reject IDs starting with numbers', () => {
      const result = validateSectionId('123-section');
      expect(result.valid).toBe(false);
    });

    it('should reject IDs with special characters', () => {
      const result = validateSectionId('section@123');
      expect(result.valid).toBe(false);
    });

    it('should reject empty IDs', () => {
      const result = validateSectionId('');
      expect(result.valid).toBe(false);
    });
  });

  describe('validateRequirement - requirement format validation', () => {
    it('should accept valid requirement patterns', () => {
      expect(validateRequirement('exists-reftarget').valid).toBe(true);
      expect(validateRequirement('on-page:/dashboard').valid).toBe(true);
      expect(validateRequirement('has-datasource:prometheus').valid).toBe(true);
    });

    it('should accept empty requirements (optional field)', () => {
      expect(validateRequirement('').valid).toBe(true);
    });

    it('should reject invalid requirement formats', () => {
      const result = validateRequirement('invalid-requirement');
      expect(result.valid).toBe(false);
    });
  });

  describe('validateFormField - sequence ID validation', () => {
    it('should validate sequence section IDs through form field validation', () => {
      const field = {
        id: 'id',
        label: 'Section ID:',
        type: 'text' as const,
        required: true,
      };

      // Valid IDs
      expect(validateFormField(field, 'section-1', ACTION_TYPES.SEQUENCE)).toBeNull();
      expect(validateFormField(field, 'my_section', ACTION_TYPES.SEQUENCE)).toBeNull();
      expect(validateFormField(field, 'step123', ACTION_TYPES.SEQUENCE)).toBeNull();
      expect(validateFormField(field, 'section', ACTION_TYPES.SEQUENCE)).toBeNull();

      // Invalid IDs - check for validation error (error message comes from validateSectionId)
      const invalidId1 = validateFormField(field, '123-section', ACTION_TYPES.SEQUENCE);
      expect(invalidId1).not.toBeNull();
      expect(invalidId1).toContain('start with letter');

      const invalidId2 = validateFormField(field, 'section@123', ACTION_TYPES.SEQUENCE);
      expect(invalidId2).not.toBeNull();
      expect(invalidId2).toContain('letters, numbers');

      expect(validateFormField(field, '', ACTION_TYPES.SEQUENCE)).toContain('required');
    });

    it('should validate auto-generated IDs from generateUniqueSequenceId', () => {
      const field = {
        id: 'id',
        label: 'Section ID:',
        type: 'text' as const,
        required: true,
      };

      // These are the patterns generated by generateUniqueSequenceId
      expect(validateFormField(field, 'section', ACTION_TYPES.SEQUENCE)).toBeNull();
      expect(validateFormField(field, 'section-1', ACTION_TYPES.SEQUENCE)).toBeNull();
      expect(validateFormField(field, 'section-2', ACTION_TYPES.SEQUENCE)).toBeNull();
      expect(validateFormField(field, 'section-10', ACTION_TYPES.SEQUENCE)).toBeNull();
    });

    it('should not validate id field for non-sequence actions', () => {
      const field = {
        id: 'id',
        label: 'ID:',
        type: 'text' as const,
        required: false,
      };

      // Should pass validation for non-sequence actions (id field not used)
      expect(validateFormField(field, 'any-id', ACTION_TYPES.BUTTON)).toBeNull();
      expect(validateFormField(field, '123-invalid', ACTION_TYPES.HIGHLIGHT)).toBeNull();
    });
  });
});
