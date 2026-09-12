/**
 * Completion-recorder boundary — the single funnel every terminal guide/journey
 * completion flows through. See `completion-recorder.ts` for the design contract.
 */

export {
  recordGuideCompletion,
  recordJourneyCompletion,
  onCompletionRecorded,
  invalidateEmittedCompletion,
  invalidateAllEmittedCompletions,
  __resetRecorderForTests,
} from './completion-recorder';
export {
  resolveCompletionIdentity,
  resolveMilestoneCompletionIdentity,
  manifestGuideId,
  manifestGuideSource,
} from './completion-identity';
export type { ResolveCompletionIdentityInput, ResolveMilestoneCompletionIdentityInput } from './completion-identity';
export { armCompletionWriteHook, discardQueuedCompletionWrites } from './completion-write-hook';
export type {
  CompletionKey,
  CompletionKind,
  CompletionSource,
  CompletionCategory,
  CompletionFact,
  GuideCompletionFact,
  JourneyCompletionFact,
  CompletionListener,
} from './types';
