/**
 * Completion-recorder boundary — the single funnel every terminal guide/journey
 * completion flows through. See `completion-recorder.ts` for the design contract.
 */

export {
  recordGuideCompletion,
  recordJourneyCompletion,
  onCompletionRecorded,
  __resetRecorderForTests,
} from './completion-recorder';
export { resolveCompletionIdentity } from './completion-identity';
export type { ResolveCompletionIdentityInput } from './completion-identity';
export type {
  CompletionKey,
  CompletionKind,
  CompletionSource,
  CompletionCategory,
  CompletionFact,
  CompletionListener,
} from './types';
