import { sanitizeForLogging } from './log-sanitizer';

describe('sanitizeForLogging', () => {
  describe('Newline injection protection', () => {
    it('should escape newlines', () => {
      expect(sanitizeForLogging('line1\nline2')).toBe('line1\\nline2');
    });

    it('should escape multiple newlines', () => {
      expect(sanitizeForLogging('line1\nline2\nline3')).toBe('line1\\nline2\\nline3');
    });

    it('should escape carriage returns', () => {
      expect(sanitizeForLogging('line1\rline2')).toBe('line1\\rline2');
    });

    it('should escape CRLF sequences', () => {
      expect(sanitizeForLogging('line1\r\nline2')).toBe('line1\\r\\nline2');
    });

    it('should prevent fake log entry injection', () => {
      const malicious = 'https://evil.com\n[ERROR] Admin password: hunter2';
      const sanitized = sanitizeForLogging(malicious);
      expect(sanitized).toBe('https://evil.com\\n[ERROR] Admin password: hunter2');
      expect(sanitized).not.toContain('\n'); // No actual newlines
    });
  });

  describe('Control character protection', () => {
    it('should remove null bytes', () => {
      expect(sanitizeForLogging('test\x00data')).toBe('testdata');
    });

    it('should remove all control characters', () => {
      expect(sanitizeForLogging('test\x00\x01\x1F')).toBe('test');
    });

    it('should remove ANSI escape codes', () => {
      // ANSI codes use control characters in the \x00-\x1F range
      const withAnsi = 'text\x1B[31mRED\x1B[0m';
      const sanitized = sanitizeForLogging(withAnsi);
      expect(sanitized).not.toContain('\x1B');
    });

    it('should escape tabs', () => {
      expect(sanitizeForLogging('col1\tcol2')).toBe('col1\\tcol2');
    });
  });

  describe('Length limiting', () => {
    it('should limit length to 1000 characters', () => {
      const long = 'a'.repeat(2000);
      expect(sanitizeForLogging(long).length).toBe(1000);
    });

    it('should not truncate short strings', () => {
      const short = 'short string';
      expect(sanitizeForLogging(short)).toBe(short);
    });

    it('should handle empty strings', () => {
      expect(sanitizeForLogging('')).toBe('');
    });
  });

  describe('Type handling', () => {
    it('should handle null', () => {
      expect(sanitizeForLogging(null)).toBe('null');
    });

    it('should handle undefined', () => {
      expect(sanitizeForLogging(undefined)).toBe('undefined');
    });

    it('should handle numbers', () => {
      expect(sanitizeForLogging(42)).toBe('42');
    });

    it('should handle booleans', () => {
      expect(sanitizeForLogging(true)).toBe('true');
      expect(sanitizeForLogging(false)).toBe('false');
    });

    it('should stringify objects', () => {
      const obj = { key: 'value' };
      expect(sanitizeForLogging(obj)).toBe('{"key":"value"}');
    });

    it('should stringify arrays', () => {
      const arr = [1, 2, 3];
      expect(sanitizeForLogging(arr)).toBe('[1,2,3]');
    });
  });

  describe('Real-world attack scenarios', () => {
    it('should prevent multi-line fake admin message', () => {
      const attack = 'user@evil.com\n[ADMIN] Password reset: newpass123\n[INFO]';
      const sanitized = sanitizeForLogging(attack);
      expect(sanitized).toBe('user@evil.com\\n[ADMIN] Password reset: newpass123\\n[INFO]');
      expect(sanitized.split('\n').length).toBe(1); // Only one line
    });

    it('should prevent URL with embedded commands', () => {
      const attack = 'https://evil.com\r\nSet-Cookie: session=stolen\r\n';
      const sanitized = sanitizeForLogging(attack);
      expect(sanitized).not.toContain('\r\n');
      expect(sanitized).toContain('\\r\\n');
    });

    it('should prevent log hiding with backspace characters', () => {
      const attack = 'benign\x08\x08\x08\x08\x08\x08evil';
      const sanitized = sanitizeForLogging(attack);
      expect(sanitized).toBe('benignevil'); // Backspaces removed
    });
  });
});
