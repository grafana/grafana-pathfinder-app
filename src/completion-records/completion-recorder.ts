import { logger } from '../lib/logging';
import { completionEmittedStorage } from '../lib/user-storage';
import { bundledGuideIdReadVariants } from './completion-identity';
import { currentCompletionQueueOwnerKey } from './completion-write-storage';
import {
  clearAllAttempts,
  clearAttempt,
  closeAttempt,
  getOrMintAttempt,
  raiseHighWater,
  resolveAttemptMode,
  __resetAttemptsForTests,
  type GuideAttempt,
} from './guide-attempts';
import { reportGuideCompleted } from './progress-analytics';

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

function dedupeKey(kind: CompletionKind, guideSource: string, guideId: string): string {
  return `${kind}:${guideSource}:${guideId}`;
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
 * durably — see `invalidateEmittedCompletion` and `liftEmittedCompletionGuard`.
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
  try {
    const owner = synchronizePendingOwner();
    const variants = bundledGuideIdReadVariants(fact.guideId);
    const key = dedupeKey(fact.kind, fact.guideSource, variants[0]);
    if (isEmitted(fact.kind, fact.guideSource, fact.guideId)) {
      pending.delete(key);
      emitted.add(key);
      return;
    }
    // No listener armed yet: buffer the fact (attempt minting waits for the
    // replay, so a buffered fact that is never replayed mints nothing).
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
    // Minted before the listeners run, so a fact nobody accepts leaves the
    // attempt open and the re-emit reuses its id.
    const attemptKey = { guideSource: fact.guideSource, guideId: variants[0] };
    const attempt: GuideAttempt | null =
      attemptEligible && fact.kind === 'guide' ? getOrMintAttempt(attemptKey, resolveAttemptMode).attempt : null;
    const recorded: CompletionFact = attempt
      ? { ...fact, attemptId: attempt.attemptId, attemptMode: attempt.mode }
      : fact;
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
        reportGuideCompleted({ ...recorded, attemptId: attempt.attemptId });
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

/**
 * Lift the exactly-once guard for one guide identity, both kinds, and forget
 * its attempt so the next progress starts a new one. Every reset
 * path that forgets a guide's progress must call this for each guide it
 * resets — otherwise a reader who resets and re-completes gets no durable
 * record, no badge and no path progress on the second completion, because
 * `record()` above would still see the identity as already emitted.
 *
 * Clears every spelling `bundledGuideIdReadVariants` yields — the normalized key
 * AND the legacy `/content.json`-suffixed key — so a guide recorded under either
 * identity shape is fully forgotten.
 *
 * MIGRATION GUARANTEE — do not remove the legacy read: durable records written
 * under the suffixed id shipped in plugin 2.17.0 and have been live on Cloud for
 * weeks. There is no route that deletes a durable record, so this read-both
 * behaviour must stay until someone deliberately retires it after those records
 * have aged out. Reading only the normalized key would silently orphan them.
 */
export function invalidateEmittedCompletion(guideSource: string, guideId: string): void {
  liftEmittedCompletionGuard(guideSource, guideId);
  clearAttempt({ guideSource, guideId });
}

/**
 * Lift the exactly-once guard alone, leaving the guide's attempt in place.
 * For a queued record lost before it was sent: the completion has to be
 * recordable again, and under the same attempt.
 */
export function liftEmittedCompletionGuard(guideSource: string, guideId: string): void {
  const variants = bundledGuideIdReadVariants(guideId);
  const kinds: readonly CompletionKind[] = ['guide', 'journey'];
  for (const kind of kinds) {
    for (const id of variants) {
      const key = dedupeKey(kind, guideSource, id);
      pending.delete(key);
      emitted.delete(key);
      void completionEmittedStorage.clear(key);
    }
  }
}

export function discardPendingCompletions(): void {
  pending.clear();
}

/** Lifts the guard for every guide identity. Backs "Reset all learning progress". */
export function invalidateAllEmittedCompletions(): void {
  discardPendingCompletions();
  emitted.clear();
  void completionEmittedStorage.clearAll();
  clearAllAttempts();
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
  listeners.clear();
  __resetAttemptsForTests();
}
