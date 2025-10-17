/**
 * Tests for centralized GitHub URL validation functions
 */
import { isGitHubUrl, isGitHubRawUrl, isAnyGitHubUrl } from './url-validator';

describe('GitHub URL validators', () => {
  describe('isGitHubUrl', () => {
    it('should return true for valid github.com URLs', () => {
      expect(isGitHubUrl('https://github.com/grafana/grafana')).toBe(true);
      expect(isGitHubUrl('https://github.com/user/repo/blob/main/file.ts')).toBe(true);
    });

    it('should return false for raw.githubusercontent.com URLs', () => {
      expect(isGitHubUrl('https://raw.githubusercontent.com/grafana/grafana/main/file.ts')).toBe(false);
    });

    it('should return false for non-GitHub URLs', () => {
      expect(isGitHubUrl('https://grafana.com/docs/')).toBe(false);
      expect(isGitHubUrl('https://github.com.evil.com/fake')).toBe(false);
    });

    it('should return false for http:// URLs (must be https)', () => {
      expect(isGitHubUrl('http://github.com/grafana/grafana')).toBe(false);
    });

    it('should return false for invalid URLs', () => {
      expect(isGitHubUrl('not a url')).toBe(false);
      expect(isGitHubUrl('')).toBe(false);
    });
  });

  describe('isGitHubRawUrl', () => {
    it('should return true for valid raw.githubusercontent.com URLs', () => {
      expect(isGitHubRawUrl('https://raw.githubusercontent.com/grafana/grafana/main/file.ts')).toBe(true);
      expect(isGitHubRawUrl('https://raw.githubusercontent.com/user/repo/branch/path/file.html')).toBe(true);
    });

    it('should return false for github.com URLs', () => {
      expect(isGitHubRawUrl('https://github.com/grafana/grafana')).toBe(false);
    });

    it('should return false for non-GitHub URLs', () => {
      expect(isGitHubRawUrl('https://grafana.com/docs/')).toBe(false);
      expect(isGitHubRawUrl('https://raw.githubusercontent.com.evil.com/fake')).toBe(false);
    });

    it('should return false for http:// URLs (must be https)', () => {
      expect(isGitHubRawUrl('http://raw.githubusercontent.com/grafana/grafana/main/file.ts')).toBe(false);
    });

    it('should return false for invalid URLs', () => {
      expect(isGitHubRawUrl('not a url')).toBe(false);
      expect(isGitHubRawUrl('')).toBe(false);
    });
  });

  describe('isAnyGitHubUrl', () => {
    it('should return true for github.com URLs', () => {
      expect(isAnyGitHubUrl('https://github.com/grafana/grafana')).toBe(true);
    });

    it('should return true for raw.githubusercontent.com URLs', () => {
      expect(isAnyGitHubUrl('https://raw.githubusercontent.com/grafana/grafana/main/file.ts')).toBe(true);
    });

    it('should return false for non-GitHub URLs', () => {
      expect(isAnyGitHubUrl('https://grafana.com/docs/')).toBe(false);
    });

    it('should return false for domain hijacking attempts', () => {
      expect(isAnyGitHubUrl('https://github.com.evil.com/fake')).toBe(false);
      expect(isAnyGitHubUrl('https://raw.githubusercontent.com.evil.com/fake')).toBe(false);
    });
  });
});
