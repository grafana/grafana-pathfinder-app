import { logger } from '../lib/logging';
import { completionEmittedStorage, completionReportedStorage } from '../lib/user-storage';
import { reportCompletionAnalytics } from './completion-analytics';
import { bundledGuideIdReadVariants } from './completion-identity';
import { currentCompletionQueueOwnerKey } from './completion-write-storage';
import {
  withAttemptLock,
  clearAllAttempts,
  clearAttempt,
  closeAttempt,
  getOrMintAttempt,
  raiseHighWater,
  resolveAttemptMode,
  __resetAttemptsForTests,
  type GuideAttempt,
} from './guide-attempts';

import type {
  CompletionFact,
  CompletionKind,
  CompletionListener,
  GuideCompletionFact,
  JourneyCompletionFact,
} from './types';

const listeners = new Set<CompletionListener>();

// Facts recorded before any listener is armed, replayed on the first
// `onCompletionRecorded`. Scoped to the queue owner (user/stack): an owner
// change drops them, so one user's buffered completion never reaches another.
interface PendingCompletion {
  fact: CompletionFact;
  attemptEligible: boolean;
}
const pending = new Map<string, PendingCompletion>();
const MAX_PENDING_COMPLETIONS = 100;
let pendingOwner: string | null = null;

function synchronizePendingOwner(): string | null {
  const owner = currentCompletionQueueOwnerKey();
  if (owner !== pendingOwner) {
    pending.clear();
    pendingOwner = owner;
  }
  return owner;
}

// The write-side exactly-once guard. In-memory for a fast synchronous check;
// backed by `completionEmittedStorage` so it survives a reload — without
// that, a guide already marked complete before a reload re-dispatches its
// 100% signal into the automatic completion route on the next step write and
// mints a second durable record (there is no other guard once the module
// re-initializes). Persisting forever is correct here: once a guide is
// recorded, no legitimate second completion exists for the same identity
// until an explicit reset, which calls `invalidateEmittedCompletion` below.
//
// Both halves are set together, and only on a listener's durable acceptance
// — see `record` below.
const emitted = new Set<string>();

const reported = new Set<string>();

function dedupeKey(kind: CompletionKind, guideSource: string, guideId: string): string {
  return `${kind}:${guideSource}:${guideId}`;
}

function reportOnce(fact: CompletionFact, key: string, variants: readonly string[]): void {
  try {
    const alreadyReported = variants.some((id) => {
      const variantKey = dedupeKey(fact.kind, fact.guideSource, id);
      return reported.has(variantKey) || completionReportedStorage.isEmitted(variantKey);
    });
    if (alreadyReported) {
      return;
    }
    reported.add(key);
    void completionReportedStorage.markEmitted(key);
    reportCompletionAnalytics(fact);
  } catch (error) {
    logger.warn('Failed to report completion analytics', { error });
  }
}

/** `true` when at least one listener durably accepted the fact. */
function emit(fact: CompletionFact): boolean {
  let accepted = false;
  for (const listener of listeners) {
    try {
      accepted = listener(fact) === true || accepted;
    } catch (error) {
      // A misbehaving subscriber must never break the completion path.
      logger.warn('Completion listener threw', { error });
    }
  }
  return accepted;
}

export interface RecordGuideCompletionOptions {
  /**
   * Attach the guide's attempt to the fact, minting one when none exists.
   * Only bundled and standalone guide completions set this; a milestone or a
   * journey must never create an attempt.
   */
  attemptEligible?: boolean;
}

/**
 * Record a terminal guide completion. Covers bundled/standalone-interactive
 * guides reaching 100% and the milestone-as-guide bridge. Never blocks, never
 * throws on the completion path. Idempotent per `(kind, guideSource, guideId)`,
 * durably.
 */
export function recordGuideCompletion(fact: GuideCompletionFact, options: RecordGuideCompletionOptions = {}): void {
  record(fact, options.attemptEligible === true);
}

/**
 * Record a whole-journey terminal completion — the `journey_completed` trigger
 * that has no single home in the codebase today. Fired when the final milestone
 * crosses the all-milestones-complete threshold. Same exactly-once guarantee.
 */
export function recordJourneyCompletion(fact: JourneyCompletionFact): void {
  record(fact, false);
}

// WRITE the canonical (normalized) key, but READ every legacy spelling too:
// a package-path completion already persisted under the suffixed id (shipped
// in 2.17.0) must be seen here, or the reload-to-100% path would mint a
// second durable Cloud record. This is the migration read-both on the WRITE
// path — the reset path reads both via `invalidateEmittedCompletion`.
function isEmitted(kind: CompletionKind, guideSource: string, guideId: string): boolean {
  return bundledGuideIdReadVariants(guideId).some((id) => {
    const k = dedupeKey(kind, guideSource, id);
    return emitted.has(k) || completionEmittedStorage.isEmitted(k);
  });
}

/** `true` once a guide-kind completion for this identity was durably accepted (and not since reset). */
export function hasEmittedGuideCompletion(guideSource: string, guideId: string): boolean {
  return isEmitted('guide', guideSource, guideId);
}

function record(fact: CompletionFact, attemptEligible: boolean): void {
  const owner = currentCompletionQueueOwnerKey();
  withAttemptLock(() => {
    if (owner === currentCompletionQueueOwnerKey()) {
      recordLocked(fact, attemptEligible);
    }
  });
}

function recordLocked(fact: CompletionFact, attemptEligible: boolean): void {
  try {
    const owner = synchronizePendingOwner();
    const variants = bundledGuideIdReadVariants(fact.guideId);
    const key = dedupeKey(fact.kind, fact.guideSource, variants[0]);
    if (isEmitted(fact.kind, fact.guideSource, fact.guideId)) {
      pending.delete(key);
      emitted.add(key);
      return;
    }
    const attemptKey = { guideSource: fact.guideSource, guideId: variants[0] };
    const attempt: GuideAttempt | null =
      attemptEligible && fact.kind === 'guide' ? getOrMintAttempt(attemptKey, resolveAttemptMode).attempt : null;
    const recorded: CompletionFact = attempt
      ? { ...fact, attemptId: attempt.attemptId, attemptMode: attempt.mode, attemptStartedAt: attempt.startedAt }
      : fact;
    reportOnce(recorded, key, variants);
    if (listeners.size === 0 && owner) {
      if (!pending.has(key) && pending.size >= MAX_PENDING_COMPLETIONS) {
        logger.warn('completion write: startup buffer is full');
        return;
      }
      if (!pending.has(key)) {
        pending.set(key, { fact: { ...fact }, attemptEligible });
      }
      return;
    }
    pending.delete(key);
    // Set the guard only once someone durably accepted the fact. Between the
    // two risks here: a duplicate is recoverable — the record is true, and
    // downstream dedup can collapse it — while a lost completion is not,
    // because nobody will try again. So this accepts the duplicate and
    // refuses the loss. Nothing accepted (no subscriber armed yet, no
    // identity, a failed persist) leaves the identity eligible for a later
    // attempt, including on a later session.
    if (emit(recorded)) {
      emitted.add(key);
      void completionEmittedStorage.markEmitted(key);
      if (attempt) {
        closeAttempt(attemptKey, attempt.attemptId);
        raiseHighWater(attemptKey, 100);
      }
    }
  } catch (error) {
    logger.warn('Failed to record completion', { error });
  }
}

export function onCompletionRecorded(listener: CompletionListener): () => void {
  synchronizePendingOwner();
  listeners.add(listener);
  for (const { fact, attemptEligible } of [...pending.values()]) {
    record(fact, attemptEligible);
  }
  return () => {
    listeners.delete(listener);
  };
}

// Legacy /content.json identities remain valid until their durable records are retired.
function identityKeys(guideSource: string, guideId: string): string[] {
  const kinds: readonly CompletionKind[] = ['guide', 'journey'];
  return kinds.flatMap((kind) => bundledGuideIdReadVariants(guideId).map((id) => dedupeKey(kind, guideSource, id)));
}

export function liftDurableCompletionGuard(guideSource: string, guideId: string): void {
  for (const key of identityKeys(guideSource, guideId)) {
    pending.delete(key);
    emitted.delete(key);
    void completionEmittedStorage.clear(key);
  }
}

export function invalidateEmittedCompletion(guideSource: string, guideId: string): void {
  withAttemptLock(() => {
    liftDurableCompletionGuard(guideSource, guideId);
    for (const key of identityKeys(guideSource, guideId)) {
      reported.delete(key);
      void completionReportedStorage.clear(key);
    }
    clearAttempt({ guideSource, guideId });
  });
}

export function discardPendingCompletions(): void {
  pending.clear();
}

/** Lifts the guard for every guide identity. Backs "Reset all learning progress". */
export function invalidateAllEmittedCompletions(): void {
  withAttemptLock(() => {
    discardPendingCompletions();
    emitted.clear();
    reported.clear();
    void completionEmittedStorage.clearAll();
    void completionReportedStorage.clearAll();
    clearAllAttempts();
  });
}

/**
 * Test-only reset of the in-memory dedupe guard and subscriber set so suites
 * can exercise the exactly-once contract deterministically. Does not touch
 * `completionEmittedStorage` — tests that need the persisted half cleared use
 * `invalidateEmittedCompletion`/`invalidateAllEmittedCompletions` directly.
 */
export function __resetRecorderForTests(): void {
  pending.clear();
  pendingOwner = null;
  emitted.clear();
  reported.clear();
  listeners.clear();
  __resetAttemptsForTests();
}
