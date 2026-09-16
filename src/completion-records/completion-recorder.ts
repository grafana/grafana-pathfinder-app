import { logger } from '../lib/logging';
import { completionEmittedStorage } from '../lib/user-storage';
import { normalizeGuideId } from './completion-identity';

import type {
  CompletionFact,
  CompletionKind,
  CompletionListener,
  GuideCompletionFact,
  JourneyCompletionFact,
} from './types';

const listeners = new Set<CompletionListener>();

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

/**
 * Record a terminal guide completion. Covers bundled/standalone-interactive
 * guides reaching 100% and the milestone-as-guide bridge. Never blocks, never
 * throws on the completion path. Idempotent per `(kind, guideSource, guideId)`,
 * durably — see `invalidateEmittedCompletion` for the only way to lift it.
 */
export function recordGuideCompletion(fact: GuideCompletionFact): void {
  record(fact);
}

/**
 * Record a whole-journey terminal completion — the `journey_completed` trigger
 * that has no single home in the codebase today. Fired when the final milestone
 * crosses the all-milestones-complete threshold. Same exactly-once guarantee.
 */
export function recordJourneyCompletion(fact: JourneyCompletionFact): void {
  record(fact);
}

function record(fact: CompletionFact): void {
  try {
    const key = dedupeKey(fact.kind, fact.guideSource, fact.guideId);
    if (emitted.has(key) || completionEmittedStorage.isEmitted(key)) {
      emitted.add(key);
      return;
    }
    // Set the guard only once someone durably accepted the fact. Between the
    // two risks here: a duplicate is recoverable — the record is true, and
    // downstream dedup can collapse it — while a lost completion is not,
    // because nobody will try again. So this accepts the duplicate and
    // refuses the loss. Nothing accepted (no subscriber armed yet, no
    // identity, a failed persist) leaves the identity eligible for a later
    // attempt, including on a later session.
    if (emit(fact)) {
      emitted.add(key);
      void completionEmittedStorage.markEmitted(key);
    }
  } catch (error) {
    logger.warn('Failed to record completion', { error });
  }
}

export function onCompletionRecorded(listener: CompletionListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Lift the exactly-once guard for one guide identity, both kinds. Every reset
 * path that forgets a guide's progress must call this for each guide it
 * resets — otherwise a reader who resets and re-completes gets no durable
 * record, no badge and no path progress on the second completion, because
 * `record()` above would still see the identity as already emitted.
 *
 * Clears both the normalized key (guideId after normalizeGuideId) AND the
 * legacy suffixed key (guideId + '/content.json' if not already present) to
 * handle guides that may have been recorded under either identity shape.
 *
 * MIGRATION GUARANTEE — do not remove the legacy read: durable records written
 * under the suffixed id shipped in plugin 2.17.0 and have been live on Cloud for
 * weeks. There is no route that deletes a durable record, so this read-both
 * behaviour must stay until someone deliberately retires it after those records
 * have aged out. Reading only the normalized key would silently orphan them.
 */
export function invalidateEmittedCompletion(guideSource: string, guideId: string): void {
  const normalizedId = normalizeGuideId(guideId);
  const legacySuffixedId = normalizedId.endsWith('/content.json') ? normalizedId : `${normalizedId}/content.json`;

  const kinds: readonly CompletionKind[] = ['guide', 'journey'];
  for (const kind of kinds) {
    // Clear the normalized key
    const normalizedKey = dedupeKey(kind, guideSource, normalizedId);
    emitted.delete(normalizedKey);
    void completionEmittedStorage.clear(normalizedKey);

    // Clear the legacy suffixed key if different from normalized
    if (legacySuffixedId !== normalizedId) {
      const legacyKey = dedupeKey(kind, guideSource, legacySuffixedId);
      emitted.delete(legacyKey);
      void completionEmittedStorage.clear(legacyKey);
    }
  }
}

/** Lifts the guard for every guide identity. Backs "Reset all learning progress". */
export function invalidateAllEmittedCompletions(): void {
  emitted.clear();
  void completionEmittedStorage.clearAll();
}

/**
 * Test-only reset of the in-memory dedupe guard and subscriber set so suites
 * can exercise the exactly-once contract deterministically. Does not touch
 * `completionEmittedStorage` — tests that need the persisted half cleared use
 * `invalidateEmittedCompletion`/`invalidateAllEmittedCompletions` directly.
 */
export function __resetRecorderForTests(): void {
  emitted.clear();
  listeners.clear();
}
