// Typed domain operations — call sites use these, never the vendor-specific
// pushFaro* primitives, so the backing SDK stays an adapter concern.
import { pushFaroEvent, pushFaroMeasurement, withFaroUserAction } from './faro-adapter';
import { normalizeTelemetryUrl } from './url';
import {
  TELEMETRY_ACTIONS,
  TELEMETRY_EVENTS,
  TELEMETRY_MEASUREMENTS,
  type ContentFetchOutcome,
  type ContentFetchTier,
  type GuideLoadOutcome,
  type RecommenderErrorType,
  type RecommenderOutcome,
  type StepOutcome,
} from './types';

// Loaders resolve on failure (errors live in tab state), so the resolved
// outcome — not promise settlement — stamps the action.
export function withGuideOpenAction(url: string, work: () => Promise<GuideLoadOutcome>): Promise<GuideLoadOutcome> {
  return withFaroUserAction(TELEMETRY_ACTIONS.guideOpen, { content_url: normalizeTelemetryUrl(url) }, work, undefined, {
    critical: true,
    outcomeFrom: (result) => (result === 'completed' ? 'ok' : 'error'),
  });
}

export function recordRecommenderRequest(durationMs: number, outcome: RecommenderOutcome): void {
  pushFaroMeasurement(TELEMETRY_MEASUREMENTS.recommender, { recommender_ms: durationMs }, { outcome });
}

export function recordRecommenderFallback(errorType: RecommenderErrorType, fallbackTier: string): void {
  pushFaroEvent(TELEMETRY_EVENTS.recommenderFallback, {
    fallback_tier: fallbackTier,
    error_type: errorType,
  });
}

export function recordContentFetch(params: {
  url: string;
  tier: ContentFetchTier;
  durationMs: number;
  outcome: ContentFetchOutcome;
}): void {
  pushFaroMeasurement(
    TELEMETRY_MEASUREMENTS.contentFetch,
    { content_fetch_ms: params.durationMs },
    { tier: params.tier, outcome: params.outcome, content_url: normalizeTelemetryUrl(params.url) }
  );
}

export function recordContentFetchFallback(params: {
  url: string;
  tierUsed: ContentFetchTier;
  errorType: string;
}): void {
  pushFaroEvent(TELEMETRY_EVENTS.contentFetchFallback, {
    content_url: normalizeTelemetryUrl(params.url),
    tier_used: params.tierUsed,
    error_type: params.errorType,
  });
}

export function recordStepExecution(targetAction: string, durationMs: number, outcome: StepOutcome): void {
  pushFaroMeasurement(
    TELEMETRY_MEASUREMENTS.step,
    { step_exec_ms: durationMs },
    { target_action: targetAction, outcome }
  );
}

export function recordRequirementsExhausted(requirement: string, retryCount: number): void {
  pushFaroMeasurement(TELEMETRY_MEASUREMENTS.requirements, { retry_count: retryCount }, { requirement });
  pushFaroEvent(TELEMETRY_EVENTS.requirementsExhausted, { requirement, retry_count: retryCount });
}

export function recordSequenceActionError(requirement: string, retryCount: number, errorMessage: string): void {
  pushFaroMeasurement(TELEMETRY_MEASUREMENTS.requirements, { retry_count: retryCount }, { requirement });
  pushFaroEvent(TELEMETRY_EVENTS.sequenceActionError, {
    requirement,
    retry_count: retryCount,
    error_message: errorMessage,
  });
}

export function recordPanelReady(durationMs: number, surface: string): void {
  pushFaroMeasurement(TELEMETRY_MEASUREMENTS.panel, { panel_lcp_ms: durationMs }, { surface });
}
