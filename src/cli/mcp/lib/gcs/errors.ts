/**
 * GCS error classifiers and the typed-error pass-through wrapper.
 *
 * GCS errors arrive as plain objects with a `code` field and an optional
 * `errors[].reason` array. We branch on those rather than on instanceof
 * because the SDK does not export error subclasses. `wrapStorageErrors`
 * is the outer guard at every public `SessionStore` method: typed errors
 * propagate (so the dispatch layer can map them to specific CommandOutcome
 * codes), everything else gets normalized into `SessionStoreUnavailableError`
 * so the wire response stays a well-formed CommandOutcome.
 */

import {
  SessionPreconditionFailedError,
  SessionStoreCorruptedError,
  SessionStoreUnavailableError,
} from '../session-store';

export interface GcsErrorLike {
  code?: number | string;
  errors?: Array<{ reason?: string }>;
}

export function isNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== 'object') {
    return false;
  }
  const e = err as GcsErrorLike;
  return e.code === 404 || e.code === '404';
}

export function isPreconditionFailedError(err: unknown): boolean {
  if (!err || typeof err !== 'object') {
    return false;
  }
  const e = err as GcsErrorLike;
  if (e.code === 412 || e.code === '412') {
    return true;
  }
  if (Array.isArray(e.errors)) {
    for (const inner of e.errors) {
      if (inner?.reason === 'conditionNotMet') {
        return true;
      }
    }
  }
  return false;
}

/**
 * GCS imposes a per-object write rate limit of ~1 mutation per second
 * (https://cloud.google.com/storage/docs/gcs429). Real agent flows are
 * LLM-paced and never approach this, but bursty smoke tests / racing
 * replicas can. Surface as 429 with reason `rateLimitExceeded`.
 */
export function isRateLimitedError(err: unknown): boolean {
  if (!err || typeof err !== 'object') {
    return false;
  }
  const e = err as GcsErrorLike;
  if (e.code === 429 || e.code === '429') {
    return true;
  }
  if (Array.isArray(e.errors)) {
    for (const inner of e.errors) {
      if (inner?.reason === 'rateLimitExceeded') {
        return true;
      }
    }
  }
  return false;
}

/**
 * Run `fn` and normalize any unknown error into `SessionStoreUnavailableError`.
 * Typed errors (`SessionPreconditionFailedError`, `SessionStoreCorruptedError`,
 * `SessionStoreUnavailableError`) propagate as-is so the dispatch layer can
 * map them to their specific CommandOutcome codes. Everything else (raw GCS
 * errors, auth failures, network blips) gets wrapped so the wire response
 * stays a well-formed CommandOutcome; the original error is preserved via
 * `cause` for server-side logs.
 */
export async function wrapStorageErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (
      err instanceof SessionPreconditionFailedError ||
      err instanceof SessionStoreCorruptedError ||
      err instanceof SessionStoreUnavailableError
    ) {
      throw err;
    }
    throw new SessionStoreUnavailableError('transient', 'session storage temporarily unavailable; retry the request', {
      cause: err,
    });
  }
}
