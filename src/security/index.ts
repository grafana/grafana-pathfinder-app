/**
 * Security utilities barrel export
 *
 * Centralizes exports for all security-related utilities including:
 * - URL validation and sanitization
 * - HTML sanitization (XSS protection)
 * - Log sanitization (injection protection)
 * - Regex safety (ReDoS protection)
 */

// URL validation and sanitization
export {
  parseUrlSafely,
  isGrafanaDomain,
  isGrafanaDocsUrl,
  isGitHubUrl,
  isGitHubRawUrl,
  isAnyGitHubUrl,
  isLocalhostUrl,
  isAllowedContentUrl,
  isAllowedGitHubRawUrl,
  validateGitHubUrl,
  validateTutorialUrl,
  isYouTubeDomain,
  isVimeoDomain,
  isTrustedDomain,
  type URLValidation,
} from './url-validator';

// HTML sanitization
export { sanitizeDocumentationHTML, sanitizeTextForDisplay } from './html-sanitizer';

// Log sanitization
export { sanitizeForLogging, sanitizeObjectForLogging } from './log-sanitizer';

// Regex safety
export { safeRegexMatch, safeRegexTest, validateRegexPattern } from './regex-safe';
