/**
 * Pathfinder Console Logger
 *
 * Provides prefixed logging functions for the Pathfinder plugin.
 * All logs are prefixed with [pathfinder] to enable easy filtering
 * in Faro's beforeSend hook.
 *
 * Usage:
 *   log('message');
 *   error('something failed:', err);
 *
 *   // Or import as namespace:
 *   logger.log('message');
 */

const PREFIX = '[pathfinder]';

/**
 * Log a message with [pathfinder] prefix.
 */
export const log = (...args: unknown[]): void => {
  console.log(PREFIX, ...args);
};

/**
 * Log a warning with [pathfinder] prefix.
 */
export const warn = (...args: unknown[]): void => {
  console.warn(PREFIX, ...args);
};

/**
 * Log an error with [pathfinder] prefix.
 */
export const error = (...args: unknown[]): void => {
  console.error(PREFIX, ...args);
};

/**
 * Log an info message with [pathfinder] prefix.
 */
export const info = (...args: unknown[]): void => {
  console.info(PREFIX, ...args);
};

/**
 * Logger namespace for cleaner imports when using multiple methods.
 */
export const logger = { log, warn, error, info };
