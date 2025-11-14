/**
 * Logging utility with environment-based log levels
 * In production, debug logs are no-op for performance
 */

const IS_DEV = process.env.NODE_ENV !== 'production';

/**
 * Debug-level logging (only in development)
 * Use for detailed debugging information
 */
export const debug = IS_DEV ? (...args: any[]) => console.log(...args) : () => {};

/**
 * Info-level logging
 * Use for general informational messages
 */
export const info = (...args: any[]) => console.info(...args);

/**
 * Warning-level logging
 * Use for warnings that don't prevent functionality
 */
export const warn = (...args: any[]) => console.warn(...args);

/**
 * Error-level logging
 * Use for errors and exceptions
 */
export const error = (...args: any[]) => console.error(...args);

/**
 * Logger object for structured import
 */
export const logger = {
  debug,
  info,
  warn,
  error,
};
