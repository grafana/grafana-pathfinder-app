/**
 * The single completion-recorder boundary.
 *
 * Every terminal guide/journey completion in the app flows through one of the
 * two entry points here (`recordGuideCompletion`, `recordJourneyCompletion`).
 * This operationalizes design-contract invariant 1 of the Completion Records
 * RFC (https://github.com/grafana/pathfinder-rfcs/pull/6, §5.4/§7.2/§7.3): the
 * recorder subsumes the completion-*emitting* role of `markGuideCompleted` and
 * `markMilestoneDone`, which retain only their local-cache/UX duties (badges,
 * streaks, progress storage).
 *
 * This module is intentionally backend-agnostic: it makes no HTTP calls, holds
 * no backend client types, and checks no availability flag. It is a pure
 * in-process funnel with an emitter seam. The two future write tracks attach at
 * `onCompletionRecorded`:
 *   - Track 1 — analytics events `guide_completed` / `journey_completed` (§7.3)
 *   - Track 2 — durable `CompletionRecord` CRD writes via a retry queue (§7.2)
 * In this PR the seam has no subscribers, so the recorder is behavior-neutral
 * beyond the new (empty) funnel — existing badge/streak/toast/storage behavior
 * is unchanged and driven entirely by the local-cache functions.
 */

import { logger } from '../lib/logging';

import type { CompletionFact, CompletionListener } from './types';

const listeners = new Set<CompletionListener>();

/**
 * Guards exactly-once emission against the double-fire hazards enumerated in
 * the research brief (§4): the same milestone marked done from multiple
 * surfaces, a journey threshold re-crossed, sync/async twin calls, and
 * `onGuideComplete` re-entrancy. Keyed on `(kind, guideSource, guideId)`.
 *
 * This is the intra-session guard. Cross-session replays (RFC §6.11) are a
 * downstream query-time-dedup concern and are not this module's job; it only
 * prevents one terminal completion from emitting more than once.
 */
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
export function recordGuideCompletion(fact: CompletionFact): void {
  record(fact);
}

/**
 * Record a whole-journey terminal completion — the `journey_completed` trigger
 * that has no single home in the codebase today. Fired when the final milestone
 * crosses the all-milestones-complete threshold. Same exactly-once guarantee.
 */
export function recordJourneyCompletion(fact: CompletionFact): void {
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

/**
 * Subscribe to recorded completions. This is the seam where the analytics
 * (Track 1) and durable-write (Track 2) tracks attach in follow-up epic PRs.
 * Returns an unsubscribe function.
 */
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
