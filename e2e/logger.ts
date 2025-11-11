/**
 * Logging utility for e2e tests
 * Provides timestamped, context-aware logging
 */

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface LogContext {
  context?: string;
  selector?: string;
  timeout?: number;
  elementCount?: number;
  [key: string]: unknown;
}

/**
 * Format timestamp for logs
 */
function formatTimestamp(): string {
  const now = new Date();
  return now.toISOString().split('T')[1].replace('Z', '');
}

/**
 * Format log message with context
 */
function formatMessage(level: LogLevel, message: string, context?: LogContext): string {
  const timestamp = formatTimestamp();
  const levelPrefix = level.toUpperCase().padEnd(5);
  const contextStr = context?.context ? `[${context.context}]` : '';
  
  let msg = `[${timestamp}] ${levelPrefix} ${contextStr} ${message}`;
  
  if (context) {
    const details: string[] = [];
    if (context.selector) {
      details.push(`selector: ${context.selector}`);
    }
    if (context.timeout !== undefined) {
      details.push(`timeout: ${context.timeout}ms`);
    }
    if (context.elementCount !== undefined) {
      details.push(`found: ${context.elementCount} element(s)`);
    }
    if (details.length > 0) {
      msg += ` (${details.join(', ')})`;
    }
  }
  
  return msg;
}

/**
 * Log an info message
 */
export function logInfo(message: string, context?: LogContext): void {
  console.log(formatMessage('info', message, context));
}

/**
 * Log a warning message
 */
export function logWarn(message: string, context?: LogContext): void {
  console.warn(formatMessage('warn', message, context));
}

/**
 * Log an error message
 */
export function logError(message: string, context?: LogContext): void {
  console.error(formatMessage('error', message, context));
}

/**
 * Log a debug message (verbose)
 */
export function logDebug(message: string, context?: LogContext): void {
  console.log(formatMessage('debug', message, context));
}

/**
 * Log selector lookup attempt
 */
export function logSelectorLookup(selector: string, context?: string): void {
  logDebug(`Looking for selector: ${selector}`, { context, selector });
}

/**
 * Log selector found
 */
export function logSelectorFound(selector: string, count: number, context?: string): void {
  logInfo(`Found selector: ${selector}`, { context, selector, elementCount: count });
}

/**
 * Log selector not found
 */
export function logSelectorNotFound(selector: string, timeout: number, context?: string): void {
  logWarn(`Selector not found: ${selector}`, { context, selector, timeout });
}

/**
 * Log element interaction
 */
export function logInteraction(action: string, selector: string, context?: string): void {
  logInfo(`${action}: ${selector}`, { context, selector });
}

/**
 * Log wait operation
 */
export function logWait(what: string, timeout: number, context?: string): void {
  logDebug(`Waiting for: ${what}`, { context, timeout });
}

/**
 * Log wait complete
 */
export function logWaitComplete(what: string, duration: number, context?: string): void {
  logInfo(`Wait complete: ${what} (${duration}ms)`, { context });
}

