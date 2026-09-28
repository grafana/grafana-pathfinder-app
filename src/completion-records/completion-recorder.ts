import { logger } from '../lib/logging';
import { completionEmittedStorage } from '../lib/user-storage';
import { bundledGuideIdReadVariants } from './completion-identity';

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
    // WRITE the canonical (normalized) key, but READ every legacy spelling too:
    // a package-path completion already persisted under the suffixed id (shipped
    // in 2.17.0) must be seen here, or the reload-to-100% path would mint a
    // second durable Cloud record. This is the migration read-both on the WRITE
    // path — the reset path reads both via `invalidateEmittedCompletion`.
    const variants = bundledGuideIdReadVariants(fact.guideId);
    const key = dedupeKey(fact.kind, fact.guideSource, variants[0]);
    const alreadyEmitted = variants.some((id) => {
      const k = dedupeKey(fact.kind, fact.guideSource, id);
      return emitted.has(k) || completionEmittedStorage.isEmitted(k);
    });
    if (alreadyEmitted) {
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
  const variants = bundledGuideIdReadVariants(guideId);
  const kinds: readonly CompletionKind[] = ['guide', 'journey'];
  for (const kind of kinds) {
    for (const id of variants) {
      const key = dedupeKey(kind, guideSource, id);
      emitted.delete(key);
      void completionEmittedStorage.clear(key);
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
