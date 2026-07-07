import { sanitizeForLogging } from '../security/log-sanitizer';
import { pushFaroError, pushFaroLog } from './faro';

function sanitizeContext(context?: Record<string, unknown>): Record<string, string> | undefined {
  if (!context) {
    return undefined;
  }
  return Object.fromEntries(Object.entries(context).map(([key, value]) => [key, sanitizeForLogging(value)]));
}

export const logger = {
  debug(message: string, context?: Record<string, unknown>): void {
    console.log(message, context ?? '');
  },

  info(message: string, context?: Record<string, unknown>): void {
    const sanitized = sanitizeForLogging(message);
    console.info(sanitized, context ?? '');
    pushFaroLog('info', sanitized, sanitizeContext(context));
  },

  warn(message: string, context?: Record<string, unknown>): void {
    const sanitized = sanitizeForLogging(message);
    console.warn(sanitized, context ?? '');
    pushFaroLog('warn', sanitized, sanitizeContext(context));
  },

  error(message: string, context?: Record<string, unknown>): void {
    const sanitized = sanitizeForLogging(message);
    console.error(sanitized, context ?? '');
    pushFaroLog('error', sanitized, sanitizeContext(context));
  },

  exception(error: unknown, context?: Record<string, unknown>): void {
    const normalizedError = error instanceof Error ? error : new Error(sanitizeForLogging(error));
    console.error(normalizedError, context ?? '');
    pushFaroError(normalizedError, sanitizeContext(context));
  },
};
