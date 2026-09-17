import { guideSource } from '../guide-diagnostics';
import type {
  GuideDiagnostic,
  GuideLoadContext,
  GuideRenderOutcome,
  GuideRequestRole,
} from '../../types/guide-diagnostics.types';
// Typed domain operations — call sites use these, never the vendor-specific
// pushFaro* primitives, so the backing SDK stays an adapter concern.
import { pushFaroEvent, pushFaroMeasurement, pushFaroUserAction } from './faro-adapter';
import { normalizeTelemetryUrl } from './url';
import { createInteractionName, UserInteraction } from '../analytics';
import {
  TELEMETRY_EVENTS,
  TELEMETRY_MEASUREMENTS,
  type CompletionWriteDegradation,
  type ContentFetchOutcome,
  type ContentFetchTier,
  type RecommenderErrorType,
  type RecommenderOutcome,
  type SequenceErrorClassification,
  type StepOutcome,
} from './types';

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
  diagnostic?: GuideDiagnostic;
  loadContext?: GuideLoadContext;
}): void {
  pushFaroMeasurement(
    TELEMETRY_MEASUREMENTS.contentFetch,
    { content_fetch_ms: params.durationMs },
    {
      tier: params.tier,
      outcome: params.outcome,
      content_url: normalizeTelemetryUrl(params.url),
      ...guideDiagnosticAttributes(params.diagnostic),
      ...(params.loadContext && { load_id: params.loadContext.loadId }),
    }
  );
}

export function recordContentFetchFallback(params: {
  url: string;
  tierUsed: ContentFetchTier;
  diagnostic?: GuideDiagnostic;
  loadContext?: GuideLoadContext;
  errorType: string;
}): void {
  pushFaroEvent(TELEMETRY_EVENTS.contentFetchFallback, {
    content_url: normalizeTelemetryUrl(params.url),
    tier_used: params.tierUsed,
    ...(params.loadContext && { load_id: params.loadContext.loadId }),
    error_type: params.errorType,
    ...guideDiagnosticAttributes(params.diagnostic),
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
 * A gcx credential install did not mint, with the rung that stopped it.
 *
 * `mint-forbidden` is the ordinary answer rather than a fault —
 * `serviceaccounts:create` is Admin by default while sandbox sessions are open
 * to Editors — and the whole shape of the surface follows from how often it
 * happens. Without this the rate is unmeasurable, and "nobody sets up gcx" and
 * "nobody on this stack is allowed to" produce identical telemetry.
 *
 * `account-outranks-caller` is separated out because it is the one rung an
 * operator can clear — there is a service account to delete — while
 * `mint-forbidden` needs a role change.
 *
 * A closed set of rungs. No token, session id, or backend error text.
 */
export type GcxCredentialDegradation =
  'mint-forbidden' | 'account-outranks-caller' | 'account-check-unavailable' | 'plugin-too-old' | 'refused';

export function recordGcxCredentialDegradation(reason: GcxCredentialDegradation): void {
  pushFaroEvent(TELEMETRY_EVENTS.gcxCredentialDegraded, { reason });
}

export function guideDiagnosticAttributes(diagnostic?: GuideDiagnostic): Record<string, string> {
  return diagnostic
    ? {
        source: diagnostic.source,
        stage: diagnostic.stage,
        reason: diagnostic.reason,
        ...(diagnostic.statusCode !== undefined && { http_status: String(diagnostic.statusCode) }),
        ...(diagnostic.validationCount !== undefined && { validation_count: String(diagnostic.validationCount) }),
      }
    : {};
}

export function recordGuideRequest(params: {
  context?: GuideLoadContext;
  url: string;
  role: GuideRequestRole;
  durationMs: number;
  statusCode?: number;
  diagnostic?: GuideDiagnostic;
}): void {
  pushFaroEvent(TELEMETRY_EVENTS.guideRequest, {
    load_id: params.context?.loadId,
    guide_ref: params.context?.guideRef,
    source: guideSource(params.url),
    content_url:
      params.context?.source === 'app-platform'
        ? `private-guide:${params.context.guideRef}`
        : normalizeTelemetryUrl(params.url),
    role: params.role,
    duration_ms: Math.round(params.durationMs),
    http_status: params.statusCode,
    outcome: params.diagnostic ? 'error' : 'ok',
    ...guideDiagnosticAttributes(params.diagnostic),
  });
}

export function recordGuideRender(
  context: GuideLoadContext,
  outcome: GuideRenderOutcome,
  durationMs: number,
  diagnostic?: GuideDiagnostic
): void {
  if (outcome !== 'degraded' && outcome !== 'awaiting-user') {
    pushFaroUserAction(createInteractionName(UserInteraction.DocsPanelInteraction), {
      action: 'open_guide',
      phase: 'render',
      load_id: context.loadId,
      guide_ref: context.guideRef,
      outcome: outcome === 'rendered' ? 'ok' : outcome,
      duration_ms: Math.round(durationMs),
      ...guideDiagnosticAttributes(diagnostic),
    });
  }
  pushFaroEvent(TELEMETRY_EVENTS.guideRender, {
    load_id: context.loadId,
    guide_ref: context.guideRef,
    source: context.source,
    outcome,
    duration_ms: Math.round(durationMs),
    ...guideDiagnosticAttributes(diagnostic),
  });
}

export function recordPackageIndex(attributes: {
  outcome: 'ok' | 'error' | 'degraded' | 'suppressed';
  reason?: string;
  http_status?: number;
  cache?: string;
  cache_age_ms?: number;
  manifest_failures?: number;
  manifest_http_error_count?: number;
  manifest_timeout_count?: number;
  manifest_invalid_json_count?: number;
  manifest_other_error_count?: number;
  budget_exhausted?: boolean;
}): void {
  pushFaroEvent(TELEMETRY_EVENTS.packageIndex, attributes);
}
