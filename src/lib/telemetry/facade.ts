// Typed domain operations — call sites use these, never the vendor-specific
// pushFaro* primitives, so the backing SDK stays an adapter concern.
import { pushFaroEvent, pushFaroMeasurement, withFaroUserAction, USER_ACTION_TIMEOUT_MEDIUM_MS } from './faro-adapter';
import { normalizeTelemetryUrl } from './url';
import { createInteractionName, UserInteraction } from '../analytics';
import {
  TELEMETRY_EVENTS,
  TELEMETRY_MEASUREMENTS,
  type CompletionWriteDegradation,
  type ContentFetchOutcome,
  type ContentFetchTier,
  type GuideLoadOutcome,
  type RecommenderErrorType,
  type RecommenderOutcome,
  type SequenceErrorClassification,
  type StepOutcome,
} from './types';

// Loaders resolve on failure (errors live in tab state), so the resolved
// outcome — not promise settlement — stamps the action.
export function withGuideOpenAction(url: string, work: () => Promise<GuideLoadOutcome>): Promise<GuideLoadOutcome> {
  return withFaroUserAction(
    createInteractionName(UserInteraction.DocsPanelInteraction),
    { action: 'open_guide', content_url: normalizeTelemetryUrl(url) },
    work,
    USER_ACTION_TIMEOUT_MEDIUM_MS,
    {
      critical: true,
      outcomeFrom: (result) => (result === 'completed' ? 'ok' : 'error'),
    }
  );
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

// Takes a classification, not the raw error: free-text messages embed URLs,
// selectors, and echoed input, and nothing downstream scrubs event attributes.
export function recordSequenceActionError(
  requirement: string,
  retryCount: number,
  error: SequenceErrorClassification
): void {
  pushFaroMeasurement(TELEMETRY_MEASUREMENTS.requirements, { retry_count: retryCount }, { requirement });
  pushFaroEvent(TELEMETRY_EVENTS.sequenceActionError, {
    requirement,
    retry_count: retryCount,
    error_name: error.name,
    error_category: error.category,
  });
}

export function recordPanelReady(durationMs: number, surface: string): void {
  pushFaroMeasurement(TELEMETRY_MEASUREMENTS.panel, { panel_lcp_ms: durationMs }, { surface });
}

// The durable completion-write path degraded (route not served, a record was
// dropped/evicted/expired, or persistence/drain failed). Only the aggregate
// reason class is attached — never a guide id/title, user id, URL, or error.
export function recordCompletionWriteDegradation(reason: CompletionWriteDegradation): void {
  pushFaroEvent(TELEMETRY_EVENTS.completionWriteDegraded, { reason });
}

// The custom-guide catalogue could not be listed — a soft-200 reporting itself
// unavailable with a machine `reason`, or a rejected request (`http-<status>` /
// `transport-error`) — so the surface renders empty. This is the countable,
// alertable signal the capability-degradation ladder needs — a log alone can't
// distinguish "no guides authored" from "OBO unavailable on this stack", which
// is exactly how a recent incident stayed invisible. `reason` is Faro-only
// (never RudderStack): it includes open-ended `upstream-<status>` values.
export function recordCustomGuideCatalogueUnavailable(reason: string): void {
  pushFaroEvent(TELEMETRY_EVENTS.customGuideCatalogueUnavailable, { reason });
}

/**
 * A sandbox-backed block could not run, with the rung of the ladder that
 * stopped it. Emitted once per block that had to degrade, not per render.
 *
 * `grafana-coda-app` is a separate plugin, so there are several ordinary ways
 * for the sandbox to be absent and they are operationally different problems.
 * Without this, "nobody uses the terminal" and "every terminal block is broken
 * for everyone on this stack" produce identical telemetry.
 *
 * A closed set of rungs, no ids, commands, URLs or guide content — the reason a
 * capability was unavailable, nothing about what the learner was doing.
 */
export type SandboxUnavailableReason =
  'terminal-disabled' | 'plugin-missing' | 'role-forbidden' | 'panel-not-registered';

export function recordSandboxUnavailable(reason: SandboxUnavailableReason, blockType: string): void {
  pushFaroEvent(TELEMETRY_EVENTS.sandboxUnavailable, { reason, blockType });
}

/**
 * Which rung of the settings-store ladder a config read landed on:
 * `PathfinderSettings` resource → plugin `jsonData` → defaults.
 *
 * Every rung below `resource` is a stack running on the legacy store, and they
 * are operationally different problems — a kind that was never deployed, a
 * first-run stack with no resource yet, and an admin whose role cannot read it
 * all produce identical UI. Without a count, "the migration is done" and "the
 * migration silently never applied anywhere" look the same.
 *
 * A closed set of rungs. No namespace, stack id, user or setting value.
 */
export type SettingsStoreOutcome =
  'resource' | 'not-created' | 'kind-not-served' | 'api-unavailable' | 'empty-spec' | 'forbidden' | 'read-error';

export function recordSettingsStoreResolved(outcome: SettingsStoreOutcome): void {
  pushFaroEvent(TELEMETRY_EVENTS.settingsStoreResolved, { outcome });
}
