import { guideSource } from '../guide-diagnostics';
import type {
  ProxyDiagnostics,
  GuideDiagnostic,
  GuideLoadContext,
  GuideRenderOutcome,
  GuideRequestRole,
} from '../../types/guide-diagnostics.types';
// Typed domain operations — call sites use these, never the vendor-specific
// pushFaro* primitives, so the backing SDK stays an adapter concern.
import {
  pushFaroEvent as emitFaroEvent,
  pushFaroMeasurement as emitFaroMeasurement,
  pushFaroUserAction,
} from './faro-adapter';
import { toAnalyticsValue } from '../analytics-values';
import { checkValueCasing } from '../analytics-value-check';
import { normalizeTelemetryUrl } from './url';
import { createInteractionName, UserInteraction } from '../analytics';
import {
  TELEMETRY_EVENTS,
  type KioskCatalogTier,
  TELEMETRY_MEASUREMENTS,
  type CompletionWriteDegradation,
  type ContentFetchOutcome,
  type ContentFetchTier,
  type RecommendCompletionsOutcome,
  type RecommenderErrorType,
  type RecommenderOutcome,
  type SequenceErrorClassification,
  type StepOutcome,
} from './types';

// The adapter is the Faro SDK seam and is mocked in facade tests, so the
// casing check lives here to cover every facade operation.
function pushFaroEventChecked(name: string, attributes?: Record<string, unknown>): void {
  checkValueCasing(name, attributes);
  emitFaroEvent(name, attributes);
}

function pushFaroMeasurementChecked(
  type: string,
  values: Record<string, number>,
  context?: Record<string, string>
): void {
  checkValueCasing(type, context);
  emitFaroMeasurement(type, values, context);
}

export function recordRecommenderRequest(durationMs: number, outcome: RecommenderOutcome): void {
  pushFaroMeasurementChecked(
    TELEMETRY_MEASUREMENTS.recommender,
    { recommender_ms: durationMs },
    { outcome: toAnalyticsValue(outcome) }
  );
}

export function recordRecommenderFallback(errorType: RecommenderErrorType, fallbackTier: string): void {
  pushFaroEventChecked(TELEMETRY_EVENTS.recommenderFallback, {
    fallback_tier: fallbackTier,
    error_type: toAnalyticsValue(errorType),
  });
}

function completionItemBucket(count: number): string {
  if (count <= 0) {
    return '0';
  }
  if (count <= 10) {
    return '1_10';
  }
  if (count <= 50) {
    return '11_50';
  }
  return count < 250 ? '51_249' : '250';
}

export function recordRecommendCompletions(
  outcome: RecommendCompletionsOutcome,
  itemCount?: number,
  truncated?: boolean,
  waitMs?: number
): void {
  pushFaroEventChecked(TELEMETRY_EVENTS.recommendCompletions, {
    outcome: toAnalyticsValue(outcome),
    ...(itemCount !== undefined && { item_bucket: completionItemBucket(itemCount) }),
    ...(truncated !== undefined && { truncated: String(truncated) }),
  });
  if (waitMs !== undefined) {
    pushFaroMeasurementChecked(
      TELEMETRY_MEASUREMENTS.recommendCompletionsWait,
      { recommend_completions_wait_ms: waitMs },
      { outcome: toAnalyticsValue(outcome) }
    );
  }
}

export function recordContentFetch(params: {
  url: string;
  tier: ContentFetchTier;
  durationMs: number;
  outcome: ContentFetchOutcome;
  diagnostic?: GuideDiagnostic;
  loadContext?: GuideLoadContext;
}): void {
  pushFaroMeasurementChecked(
    TELEMETRY_MEASUREMENTS.contentFetch,
    { content_fetch_ms: params.durationMs },
    {
      tier: toAnalyticsValue(params.tier),
      outcome: toAnalyticsValue(params.outcome),
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
  pushFaroEventChecked(TELEMETRY_EVENTS.contentFetchFallback, {
    content_url: normalizeTelemetryUrl(params.url),
    tier_used: toAnalyticsValue(params.tierUsed),
    ...(params.loadContext && { load_id: params.loadContext.loadId }),
    error_type: toAnalyticsValue(params.errorType),
    ...guideDiagnosticAttributes(params.diagnostic),
  });
}

export function recordStepExecution(targetAction: string, durationMs: number, outcome: StepOutcome): void {
  pushFaroMeasurementChecked(
    TELEMETRY_MEASUREMENTS.step,
    { step_exec_ms: durationMs },
    { target_action: toAnalyticsValue(targetAction), outcome: toAnalyticsValue(outcome) }
  );
}

export function recordRequirementsExhausted(requirement: string, retryCount: number): void {
  pushFaroMeasurementChecked(TELEMETRY_MEASUREMENTS.requirements, { retry_count: retryCount }, { requirement });
  pushFaroEventChecked(TELEMETRY_EVENTS.requirementsExhausted, {
    requirement,
    retry_count: retryCount,
  });
}

// Takes a classification, not the raw error: free-text messages embed URLs,
// selectors, and echoed input, and nothing downstream scrubs event attributes.
export function recordSequenceActionError(
  requirement: string,
  retryCount: number,
  error: SequenceErrorClassification
): void {
  pushFaroMeasurementChecked(TELEMETRY_MEASUREMENTS.requirements, { retry_count: retryCount }, { requirement });
  pushFaroEventChecked(TELEMETRY_EVENTS.sequenceActionError, {
    requirement,
    retry_count: retryCount,
    error_name: error.name,
    error_category: error.category,
  });
}

export function recordPanelReady(durationMs: number, surface: string): void {
  pushFaroMeasurementChecked(TELEMETRY_MEASUREMENTS.panel, { panel_lcp_ms: durationMs }, { surface });
}

// The durable completion-write path degraded (route not served, a record was
// dropped/evicted/expired, or persistence/drain failed). Only the aggregate
// reason class is attached — never a guide id/title, user id, URL, or error.
export function recordCompletionWriteDegradation(reason: CompletionWriteDegradation): void {
  pushFaroEventChecked(TELEMETRY_EVENTS.completionWriteDegraded, { reason: toAnalyticsValue(reason) });
}

// The custom-guide catalogue could not be listed — a soft-200 reporting itself
// unavailable with a machine `reason`, or a rejected request (`http_<status>` /
// `transport_error` once converted) — so the surface renders empty. This is the countable,
// alertable signal the capability-degradation ladder needs — a log alone can't
// distinguish "no guides authored" from "OBO unavailable on this stack", which
// is exactly how a recent incident stayed invisible. `reason` is Faro-only
// (never RudderStack): it includes open-ended `upstream_<status>` values.
export function recordCustomGuideCatalogueUnavailable(reason: string): void {
  pushFaroEventChecked(TELEMETRY_EVENTS.customGuideCatalogueUnavailable, { reason: toAnalyticsValue(reason) });
}

// Input reason is a capability.reason, `http-<status>` or `transport-error`; never an id or identity.
export function recordAssignmentsUnavailable(reason: string): void {
  pushFaroEventChecked(TELEMETRY_EVENTS.assignmentsUnavailable, { reason: toAnalyticsValue(reason) });
}

// Count only, never a target id.
export function recordAssignmentTargetsUnresolved(count: number): void {
  pushFaroEventChecked(TELEMETRY_EVENTS.assignmentTargetUnresolved, { reason: 'unresolvable_target', count });
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
  pushFaroEventChecked(TELEMETRY_EVENTS.sandboxUnavailable, {
    reason: toAnalyticsValue(reason),
    blockType: toAnalyticsValue(blockType),
  });
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

export function recordStartupSettings(
  durationMs: number,
  outcome: 'resolved' | 'read-error' | 'timeout' | 'remote-disabled'
): void {
  pushFaroMeasurementChecked(
    TELEMETRY_MEASUREMENTS.startupSettings,
    { startup_settings_ms: durationMs },
    { outcome: toAnalyticsValue(outcome) }
  );
}

export function recordSettingsStoreResolved(outcome: SettingsStoreOutcome): void {
  pushFaroEventChecked(TELEMETRY_EVENTS.settingsStoreResolved, { outcome: toAnalyticsValue(outcome) });
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
  pushFaroEventChecked(TELEMETRY_EVENTS.gcxCredentialDegraded, { reason: toAnalyticsValue(reason) });
}

export function guideDiagnosticAttributes(diagnostic?: GuideDiagnostic): Record<string, string> {
  return diagnostic
    ? {
        source: toAnalyticsValue(diagnostic.source),
        stage: toAnalyticsValue(diagnostic.stage),
        reason: toAnalyticsValue(diagnostic.reason),
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
  pushFaroEventChecked(TELEMETRY_EVENTS.guideRequest, {
    load_id: params.context?.loadId,
    guide_ref: params.context?.guideRef,
    source: toAnalyticsValue(guideSource(params.url)),
    content_url:
      params.context?.source === 'app-platform'
        ? `private-guide:${params.context.guideRef}`
        : normalizeTelemetryUrl(params.url),
    role: toAnalyticsValue(params.role),
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
      outcome: outcome === 'rendered' ? 'ok' : toAnalyticsValue(outcome),
      duration_ms: Math.round(durationMs),
      ...guideDiagnosticAttributes(diagnostic),
    });
  }
  pushFaroEventChecked(TELEMETRY_EVENTS.guideRender, {
    load_id: context.loadId,
    guide_ref: context.guideRef,
    source: toAnalyticsValue(context.source),
    outcome: toAnalyticsValue(outcome),
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
  pushFaroEventChecked(TELEMETRY_EVENTS.packageIndex, {
    ...attributes,
    ...(attributes.reason !== undefined && { reason: toAnalyticsValue(attributes.reason) }),
  });
}

export function recordProxyFailure(diagnostic: ProxyDiagnostics): void {
  pushFaroEventChecked(TELEMETRY_EVENTS.proxyFailure, {
    outcome: diagnostic.outcome,
    stage: toAnalyticsValue(diagnostic.stage ?? 'unknown'),
    resource: diagnostic.resource ?? 'unknown',
    operation: diagnostic.operation ?? 'unknown',
    reason: toAnalyticsValue(diagnostic.reason ?? 'unexpected_error'),
    upstream_status: diagnostic.upstreamStatus ?? 0,
    cache: diagnostic.cache ?? 'none',
  });
}

export function recordKioskCatalogLoaded(tier: KioskCatalogTier, degraded: boolean, rejectedRules: number): void {
  pushFaroEventChecked(TELEMETRY_EVENTS.kioskCatalogLoaded, {
    tier: toAnalyticsValue(tier),
    degraded,
    rejected_rules: rejectedRules,
  });
}
