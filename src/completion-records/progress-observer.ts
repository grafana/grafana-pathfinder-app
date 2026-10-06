/**
 * Turns a guide's live percentage into attempt lifecycle and analytics.
 *
 * Listens to `pathfinder:progress` and acts only on a real change: an event
 * whose `origin` is `'change'`, for a non-preview content key a surface has
 * registered an identity for, at a partial percentage. Loads, replays and
 * resets carry another origin or none, and can never start an attempt — so a
 * guide reopened after it was completed, or after an upgrade, mints nothing.
 */

import { logger } from '../lib/logging';
import { isPreviewContentKey } from '../global-state/completion-store';
import { subscribeProgressEvent, type ProgressEventDetail } from '../global-state/progress-events';

import { hasEmittedGuideCompletion } from './completion-recorder';
import { getOrMintAttempt, raiseHighWater, readAttempt, resolveAttemptMode } from './guide-attempts';
import { lookupGuideIdentity, type RegisteredGuideIdentity } from './guide-identity-registry';
import { reportGuideProgress, thresholdToReport } from './progress-analytics';

let unsubscribe: (() => void) | null = null;

/** Receives each raised partial of a `records`-mode attempt (the durable write queue). */
export type AttemptProgressSink = (identity: RegisteredGuideIdentity, attemptId: string, percent: number) => void;
let progressSink: AttemptProgressSink | null = null;

function onProgress(detail: ProgressEventDetail): void {
  try {
    if (detail.kind !== 'guide' || detail.origin !== 'change') {
      return;
    }
    const { contentKey, percentage } = detail;
    if (!Number.isFinite(percentage) || percentage < 1 || percentage > 99 || isPreviewContentKey(contentKey)) {
      return;
    }
    const identity = lookupGuideIdentity(contentKey);
    if (!identity) {
      logger.debug('progress observer: no guide identity registered for content key', { contentKey });
      return;
    }
    // A guide whose completion is already recorded has nothing left to attempt.
    if (hasEmittedGuideCompletion(identity.guideSource, identity.guideId)) {
      return;
    }
    const key = { guideSource: identity.guideSource, guideId: identity.guideId };
    const existing = readAttempt(key);
    if (existing?.closed) {
      return;
    }
    const { attempt, minted } = existing
      ? { attempt: existing, minted: false }
      : getOrMintAttempt(key, resolveAttemptMode);
    if (attempt.closed) {
      return;
    }
    const { raised, previous } = raiseHighWater(key, percentage);
    if (!minted && !raised) {
      return;
    }
    // Only a real increase is written; the mode was fixed when the attempt was minted.
    if (raised && attempt.mode === 'records') {
      progressSink?.(identity, attempt.attemptId, percentage);
    }
    const threshold = thresholdToReport(previous, percentage, minted);
    if (threshold !== null) {
      reportGuideProgress(identity, attempt.attemptId, percentage, threshold);
    }
  } catch (error) {
    logger.warn('progress observer: failed to track guide progress (ignored)', { error: String(error) });
  }
}

/**
 * Idempotent. Installed by `armCompletionWriteHook`, before any of its early
 * returns. `sink` receives partials of `records`-mode attempts; the latest one
 * passed wins.
 */
export function installProgressObserver(sink?: AttemptProgressSink): void {
  if (sink) {
    progressSink = sink;
  }
  if (unsubscribe) {
    return;
  }
  unsubscribe = subscribeProgressEvent(onProgress);
}

export function __resetProgressObserverForTests(): void {
  unsubscribe?.();
  unsubscribe = null;
  progressSink = null;
}
