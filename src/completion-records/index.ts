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
  liftEmittedCompletionGuard,
  hasEmittedGuideCompletion,
  __resetRecorderForTests,
} from './completion-recorder';
export type { RecordGuideCompletionOptions } from './completion-recorder';
export { registerGuideIdentity, lookupGuideIdentity } from './guide-identity-registry';
export type { RegisteredGuideIdentity } from './guide-identity-registry';
export {
  resolveCompletionIdentity,
  resolveMilestoneCompletionIdentity,
  resolveBundledGuideCompletionIdentity,
  resolveStandaloneGuideCompletionIdentity,
  resolveJourneyCompletionIdentity,
  manifestGuideId,
  manifestGuideSource,
  normalizeGuideId,
} from './completion-identity';
export type {
  ResolveCompletionIdentityInput,
  ResolveMilestoneCompletionIdentityInput,
  ResolveGuideCompletionIdentityInput,
} from './completion-identity';
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
  AttemptMode,
} from './types';
