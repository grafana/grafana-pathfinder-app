/**
 * Log Sanitization Utilities
 *
 * Prevents log injection attacks via control characters, newlines, and ANSI codes.
 * All user-controlled data should be sanitized before logging to prevent:
 * - Log poisoning (injecting fake log entries)
 * - ANSI escape code attacks (hiding malicious activity)
 * - Log flooding (overwhelming log systems)
 *
 * @module log-sanitizer
 */

/**
 * Sanitize values for safe logging
 * Prevents log injection attacks via control characters, newlines, and ANSI codes
 *
 * @param value - Any value to be logged (string, number, object, etc.)
 * @returns Sanitized string safe for logging
 *
 * @example
 * ```typescript
 * const userUrl = "https://evil.com\nFAKE LOG ENTRY";
 * console.log('URL:', sanitizeForLogging(userUrl));
 * // Logs: URL: https://evil.com\nFAKE LOG ENTRY (newline is escaped)
 * ```
 */
export function sanitizeForLogging(value: unknown): string {
  if (value === null || value === undefined) {
    return String(value);
  }

  const str = typeof value === 'string' ? value : JSON.stringify(value);

  // IMPORTANT: Escape newlines/tabs/cr FIRST, then remove other control chars
  // Otherwise they get removed before we can escape them
  return str
    .replace(/\n/g, '\\n') // Escape newlines to prevent fake log entries
    .replace(/\r/g, '\\r') // Escape carriage returns
    .replace(/\t/g, '\\t') // Escape tabs
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '') // Remove other control chars (exclude \t\n\r)
    .substring(0, 1000); // Limit length to prevent log flooding
}

/**
 * Sanitize objects for logging (useful for data structures)
 *
 * @param obj - Any object to be logged
 * @returns Sanitized JSON string safe for logging
 *
 * @example
 * ```typescript
 * const userData = { name: "Alice\nADMIN", role: "user" };
 * console.log('Data:', sanitizeObjectForLogging(userData));
 * // Logs: Data: {"name":"Alice\\nADMIN","role":"user"}
 * ```
 */
export function sanitizeObjectForLogging(obj: unknown): string {
  if (obj === null || obj === undefined) {
    return String(obj);
  }

  try {
    // For objects, stringify first then sanitize
    const str = typeof obj === 'object' ? JSON.stringify(obj) : String(obj);
    return sanitizeForLogging(str);
  } catch (error) {
    return '[Unable to serialize object]';
  }
}
