/**
 * Shared types for the completion-recorder boundary.
 *
 * Implements the client-supplied fields of the Completion Records RFC §7.1
 * (https://github.com/grafana/pathfinder-rfcs/pull/6). Server-stamped fields
 * (recordedAt, userLogin, stable user id, stack/org context, metadata.name)
 * are deliberately absent — they are added by the durable-write backend in a
 * later epic PR, not here.
 */

/**
 * Durable guide identity: the pair `(guideSource, guideId)`.
 *
 * Sourced from the resolved package manifest — `guideSource = manifest.repository`,
 * `guideId = manifest.id` — never derived from a loader URL. This is the joint
 * key shared with the Custom Guide Packages RFC
 * (https://github.com/grafana/pathfinder-rfcs/pull/11).
 */
export interface CompletionKey {
  /** Provenance / resolving repository. e.g. 'bundled' | 'app-platform' | 'interactive-tutorials'. */
  guideSource: string;
  /** Guide identifier within its source (not globally unique on its own). */
  guideId: string;
}

export type CompletionKind = 'guide' | 'journey';

/** How the completion happened. Today only 'objectives' is produced (see brief §2). */
export type CompletionSource = 'objectives' | 'manual' | 'skipped';

export type CompletionCategory = 'interactive' | 'documentation' | 'learning-journey';

/**
 * A single terminal-completion fact handed to the recorder. Carries the
 * client-supplied fields only; the recorder attaches nothing server-side.
 */
export interface CompletionFact extends CompletionKey {
  kind: CompletionKind;
  guideTitle: string;
  guideCategory: CompletionCategory;
  pathId?: string;
  /** 0..100. Terminal completions are ~100 (partial-progress never reaches here). */
  completionPercent: number;
  source: CompletionSource;
  /** ISO 8601, client-observed time of completion. */
  completedAt: string;
  durationMs?: number;
}

/** A fact whose `kind` is pinned to 'guide' — the only shape `recordGuideCompletion` accepts. */
export type GuideCompletionFact = CompletionFact & { kind: 'guide' };

/** A fact whose `kind` is pinned to 'journey' — the only shape `recordJourneyCompletion` accepts. */
export type JourneyCompletionFact = CompletionFact & { kind: 'journey' };

/** Subscriber signature for the emitter seam (Track 1 / Track 2 attach here in later PRs). */
export type CompletionListener = (fact: CompletionFact) => void;
