export type UserActionOutcome =
  'ok' | 'error' | 'timeout' | 'cancelled' | 'skipped' | 'requirements_exhausted' | 'action_error';

export type GuideLoadOutcome = 'completed' | 'error';

export type StepOutcome = 'ok' | 'error';

export type SequenceRunResult = 'completed' | 'requirements_exhausted' | 'action_error';

export type SequenceErrorCategory = 'timeout' | 'not_found' | 'dispatch_failed' | 'other';

export interface SequenceErrorClassification {
  name: string;
  category: SequenceErrorCategory;
}

export type RecommenderErrorType = 'unavailable' | 'rate-limit' | 'other';
export type RecommenderOutcome = 'ok' | RecommenderErrorType;

export type ContentFetchTier = 'bundled' | 'backend-guide' | 'content-json' | 'unstyled-html' | 'other';
export type ContentFetchOutcome = 'ok' | 'error';

// Low-cardinality reason enum for the durable completion-write path degrading.
// Aggregate classes only — never a guide id/title, user id, URL, or raw error.
export type CompletionWriteDegradation =
  | 'route-missing'
  | 'forbidden-hold'
  | 'terminal-drop'
  | 'eviction'
  | 'expired-drop'
  | 'enqueue-failed'
  | 'drain-failed';

export const TELEMETRY_EVENTS = {
  recommenderFallback: 'pathfinder_recommender_fallback',
  contentFetchFallback: 'pathfinder_content_fetch_fallback',
  requirementsExhausted: 'pathfinder_requirements_exhausted',
  sequenceActionError: 'pathfinder_sequence_action_error',
  completionWriteDegraded: 'pathfinder_completion_write_degraded',
  sessionReplayActivationFailed: 'pathfinder_session_replay_activation_failed',
  sessionReplaySamplingFallback: 'pathfinder_session_replay_sampling_fallback',
  customGuideCatalogueUnavailable: 'pathfinder_custom_guide_catalogue_unavailable',
  sandboxUnavailable: 'pathfinder_sandbox_unavailable',
} as const;

export const TELEMETRY_MEASUREMENTS = {
  recommender: 'pathfinder_recommender',
  contentFetch: 'pathfinder_content_fetch',
  step: 'pathfinder_step',
  requirements: 'pathfinder_requirements',
  panel: 'pathfinder_panel',
} as const;

// Faro-only spans with no real UserInteraction counterpart (unlike guide-open,
// step-do/show, guided-step, and section-run, which reuse the real analytics
// interaction name via analytics.ts's createInteractionName instead).
export const TELEMETRY_ACTIONS = {
  remoteStep: 'pathfinder_remote_step',
} as const;
