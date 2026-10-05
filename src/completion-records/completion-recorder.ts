import { logger } from '../lib/logging';
import { completionEmittedStorage, completionReportedStorage } from '../lib/user-storage';
import { reportCompletionAnalytics } from './completion-analytics';
import { bundledGuideIdReadVariants } from './completion-identity';
import { currentCompletionQueueOwnerKey } from './completion-write-storage';

import type {
  CompletionFact,
  CompletionKind,
  CompletionListener,
  GuideCompletionFact,
  JourneyCompletionFact,
} from './types';

const listeners = new Set<CompletionListener>();
const pending = new Map<string, CompletionFact>();
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

// Only durable acceptance marks a completion emitted across reloads.
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

/**
 * Record a terminal guide completion. Covers bundled/standalone-interactive
 * guides reaching 100% and the milestone-as-guide bridge. Never blocks, never
 * throws on the completion path. Idempotent per `(kind, guideSource, guideId)`,
 * durably.
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
    const owner = synchronizePendingOwner();
    const variants = bundledGuideIdReadVariants(fact.guideId);
    const key = dedupeKey(fact.kind, fact.guideSource, variants[0]);
    const alreadyEmitted = variants.some((id) => {
      const k = dedupeKey(fact.kind, fact.guideSource, id);
      return emitted.has(k) || completionEmittedStorage.isEmitted(k);
    });
    if (alreadyEmitted) {
      pending.delete(key);
      emitted.add(key);
      return;
    }
    reportOnce(fact, key, variants);
    if (listeners.size === 0 && owner) {
      if (!pending.has(key) && pending.size >= MAX_PENDING_COMPLETIONS) {
        logger.warn('completion write: startup buffer is full');
        return;
      }
      if (!pending.has(key)) {
        pending.set(key, { ...fact });
      }
      return;
    }
    pending.delete(key);
    // Only durable acceptance closes the deduplication guard.
    if (emit(fact)) {
      emitted.add(key);
      void completionEmittedStorage.markEmitted(key);
    }
  } catch (error) {
    logger.warn('Failed to record completion', { error });
  }
}

export function onCompletionRecorded(listener: CompletionListener): () => void {
  synchronizePendingOwner();
  listeners.add(listener);
  for (const fact of [...pending.values()]) {
    record(fact);
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
  liftDurableCompletionGuard(guideSource, guideId);
  for (const key of identityKeys(guideSource, guideId)) {
    reported.delete(key);
    void completionReportedStorage.clear(key);
  }
}

export function discardPendingCompletions(): void {
  pending.clear();
}

export function invalidateAllEmittedCompletions(): void {
  discardPendingCompletions();
  emitted.clear();
  reported.clear();
  void completionEmittedStorage.clearAll();
  void completionReportedStorage.clearAll();
}

export function __resetRecorderForTests(): void {
  pending.clear();
  pendingOwner = null;
  emitted.clear();
  reported.clear();
  listeners.clear();
}
