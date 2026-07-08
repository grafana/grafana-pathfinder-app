import { sanitizeForLogging } from '../security/log-sanitizer';
import { pushFaroError, pushFaroLog } from './faro';

function sanitizeContext(context?: Record<string, unknown>): Record<string, string> | undefined {
  if (!context) {
    return undefined;
  }
  return Object.fromEntries(Object.entries(context).map(([key, value]) => [key, sanitizeForLogging(value)]));
}

function splitThrowable(
  errorOrContext?: Error | Record<string, unknown>,
  context?: Record<string, unknown>
): { error?: Error; context?: Record<string, unknown> } {
  if (errorOrContext instanceof Error) {
    return { error: errorOrContext, context };
  }
  if (errorOrContext && errorOrContext.error instanceof Error) {
    const { error, ...rest } = errorOrContext;
    return { error, context: Object.keys(rest).length > 0 ? rest : undefined };
  }
  return { context: errorOrContext };
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

  // A throwable (second arg, or an `error` context key) becomes a Faro
  // *exception* signal — error-level logs never reach Error Tracking.
  error(message: string, errorOrContext?: Error | Record<string, unknown>, context?: Record<string, unknown>): void {
    const sanitized = sanitizeForLogging(message);
    const split = splitThrowable(errorOrContext, context);
    if (split.error) {
      console.error(sanitized, split.error, split.context ?? '');
      pushFaroError(split.error, sanitizeContext({ ...split.context, message: sanitized }));
      return;
    }
    console.error(sanitized, split.context ?? '');
    pushFaroLog('error', sanitized, sanitizeContext(split.context));
  },

  exception(error: unknown, context?: Record<string, unknown>): void {
    const normalizedError = error instanceof Error ? error : new Error(sanitizeForLogging(error));
    console.error(normalizedError, context ?? '');
    pushFaroError(normalizedError, sanitizeContext(context));
  },
};
