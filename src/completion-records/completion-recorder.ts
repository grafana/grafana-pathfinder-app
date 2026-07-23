import { logger } from '../lib/logging';

import type { CompletionFact, CompletionListener, GuideCompletionFact, JourneyCompletionFact } from './types';

const listeners = new Set<CompletionListener>();

// Prevents re-entrant completion paths from emitting the same fact twice per app load.
const emitted = new Set<string>();

function dedupeKey(fact: CompletionFact): string {
  return `${fact.kind}:${fact.guideSource}:${fact.guideId}`;
}

function emit(fact: CompletionFact): void {
  for (const listener of listeners) {
    try {
      listener(fact);
    } catch (error) {
      // A misbehaving subscriber must never break the completion path.
      logger.warn('Completion listener threw', { error });
    }
  }
}

/**
 * Record a terminal guide completion. Covers bundled/standalone-interactive
 * guides reaching 100% and the milestone-as-guide bridge. Never blocks, never
 * throws on the completion path. Idempotent per `(kind, guideSource, guideId)`.
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
    const key = dedupeKey(fact);
    if (emitted.has(key)) {
      return;
    }
    emitted.add(key);
    emit(fact);
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
 * Test-only reset of the module-level dedupe guard and subscriber set so suites
 * can exercise the exactly-once contract deterministically.
 */
export function __resetRecorderForTests(): void {
  emitted.clear();
  listeners.clear();
}
