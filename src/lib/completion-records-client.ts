import { getBackendSrv } from '@grafana/runtime';

import { COMPLETION_RECORDS_TIMEOUT_MS, PLUGIN_BACKEND_URL } from '../constants';
import type { CompletionContext } from '../types/context.types';
import { withTimeout } from './async-utils';
import { logger } from './logging';

/**
 * Client for the plugin-backend completion-records read proxy (added by
 * grafana-pathfinder-app#1398). It fetches the current user's own collated
 * completion summary so the recommender can weight suggestions by what the
 * user has already finished.
 *
 * Everything here fails soft: the completion context is an ENHANCEMENT to the
 * recommend request, never a prerequisite. Any failure — offline, timeout,
 * 4xx/5xx, 503 cold, malformed body, or capability=false — resolves to `null`
 * and the recommend request goes out unchanged. We never retry (the proxy is
 * TTL-cached upstream and emits Retry-After on a cold 503; a single soft GET
 * per recommend cycle respects that without a client-side retry loop).
 *
 * @coupling Backend envelope: pkg/plugin/completion_records.go
 *   (myCompletionsResponse, completionCapability, collatedCompletion) and the
 *   routes in pkg/plugin/resources.go. The types below PIN that shape — a
 *   contract drift on either side should fail the unit tests.
 * @coupling Recommend sub-contract: CompletionContext in types/context.types.ts
 */

const MY_COMPLETIONS_URL = `${PLUGIN_BACKEND_URL}/completion-records/my`;

/**
 * Availability signal from the proxy. `available` is READ-derived: it means
 * identity was present and a LIST of the completionrecords API succeeded (or a
 * warm cache exists). It is NOT a write-capability signal — do not treat it as
 * one, and do not rename it here (an open design decision owns the naming).
 */
export interface CompletionCapability {
  available: boolean;
  reason?: string;
}

/**
 * One collated entry per (guideSource, guideId) for the calling user. Mirrors
 * `collatedCompletion` in the Go backend verbatim (camelCase over the wire).
 */
export interface CollatedCompletion {
  guideSource: string;
  guideId: string;
  guideTitle: string;
  guideCategory: string;
  pathId: string;
  count: number;
  latestCompletedAt: string;
  latestSource: string;
  maxCompletionPercent: number;
}

/**
 * The `GET /completion-records/my` envelope. Mirrors `myCompletionsResponse`.
 */
export interface MyCompletionsResponse {
  capability: CompletionCapability;
  userId?: string;
  completions: CollatedCompletion[];
  asOf?: string;
}

function looksLikeMyCompletions(value: unknown): value is MyCompletionsResponse {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  const cap = v.capability as Record<string, unknown> | undefined;
  return typeof cap === 'object' && cap !== null && typeof cap.available === 'boolean' && Array.isArray(v.completions);
}

// In-flight de-duplication only: overlapping recommend cycles share one GET.
// No persistent client cache — staleness is bounded by the proxy's own TTL.
let inFlight: Promise<MyCompletionsResponse | null> | null = null;

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

async function performFetch(): Promise<MyCompletionsResponse | null> {
  try {
    const response = await withTimeout(
      getBackendSrv().get<unknown>(MY_COMPLETIONS_URL, undefined, undefined, {
        showErrorAlert: false,
        showSuccessAlert: false,
      }),
      COMPLETION_RECORDS_TIMEOUT_MS,
      'completion-records fetch timed out'
    );
    if (!looksLikeMyCompletions(response)) {
      return null;
    }
    return response;
  } catch (error) {
    // Any failure (network, 4xx, 5xx, 503-cold, timeout) degrades to null. Debug
    // only: this is an expected, silent enhancement path, not a user-facing error.
    logger.debug('completion-records fetch unavailable', { error: String(error) });
    return null;
  }
}

/**
 * Fetch the caller's collated completion summary, or `null` on any failure or
 * when offline. Never throws. Concurrent callers share one in-flight request.
 */
export async function fetchMyCompletions(): Promise<MyCompletionsResponse | null> {
  if (isOffline()) {
    return null;
  }
  if (!inFlight) {
    inFlight = performFetch().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

/**
 * Distil the proxy envelope into the recommend request's completion sub-contract.
 * Returns `null` (attach nothing) when the response is absent or the proxy
 * reported the feature unavailable for this caller. When available, the context
 * is attached even with zero items — "known user, nothing completed" is itself a
 * signal, distinct from "we don't know" (absent field).
 */
export function buildCompletionContext(response: MyCompletionsResponse | null): CompletionContext | null {
  if (!response || !response.capability.available) {
    return null;
  }
  return {
    as_of: response.asOf,
    items: response.completions
      .filter((c): c is CollatedCompletion => typeof c === 'object' && c !== null)
      .map((c) => ({
        guide_source: c.guideSource,
        guide_id: c.guideId,
        guide_category: c.guideCategory || undefined,
        path_id: c.pathId || undefined,
        count: c.count,
        latest_completed_at: c.latestCompletedAt || undefined,
        max_completion_percent: c.maxCompletionPercent,
      })),
  };
}

/**
 * Convenience wrapper for the recommend-request assembly path: fetch + distil.
 * Returns the completion context to attach, or `null` to attach nothing.
 */
export async function fetchCompletionContextForRecommend(): Promise<CompletionContext | null> {
  return buildCompletionContext(await fetchMyCompletions());
}

/**
 * Test-only reset. Not exported via index.ts.
 */
export function __resetCompletionRecordsClientForTests(): void {
  inFlight = null;
}
