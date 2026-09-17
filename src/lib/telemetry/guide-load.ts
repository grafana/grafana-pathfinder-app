import type {
  GuideDiagnostic,
  GuideLoadContext,
  GuideRenderOutcome,
  GuideStage,
  GuideRequestRole,
} from '../../types/guide-diagnostics.types';
import { diagnoseGuideError, guideSource, opaqueGuideReference, newGuideLoadId } from '../guide-diagnostics';
import { recordGuideRender, recordGuideRequest } from './facade';
import { normalizeTelemetryUrl } from './url';

interface LoadState {
  stage: GuideStage;
  started: number;
  remaining: number;
  timer?: ReturnType<typeof setTimeout>;
  paused: boolean;
}

const loads = new Map<string, LoadState>();

export function beginGuideLoad(url: string): GuideLoadContext {
  const source = guideSource(url);
  const context: GuideLoadContext = {
    loadId: newGuideLoadId(),
    source,
    guideRef: source === 'app-platform' || source === 'other' ? opaqueGuideReference(url) : normalizeTelemetryUrl(url),
  };
  loads.set(context.loadId, { stage: 'prepare', started: performance.now(), remaining: 60_000, paused: true });
  resumeGuideLoad(context);
  return context;
}

export function finishGuideLoad(
  context: GuideLoadContext | undefined,
  outcome: GuideRenderOutcome,
  diagnostic?: GuideDiagnostic
): void {
  if (!context) {
    return;
  }
  const state = loads.get(context.loadId);
  if (!state) {
    return;
  }
  const elapsed = 60_000 - state.remaining + (state.paused ? 0 : performance.now() - state.started);
  if (outcome !== 'degraded' && outcome !== 'awaiting-user') {
    clearTimeout(state.timer);
    loads.delete(context.loadId);
  }
  recordGuideRender(context, outcome, elapsed, diagnostic);
}

export function pauseGuideLoad(context: GuideLoadContext | undefined, awaitingUser = false): void {
  if (!context) {
    return;
  }
  const state = loads.get(context.loadId);
  if (!state || state.paused) {
    return;
  }
  clearTimeout(state.timer);
  state.remaining = Math.max(0, state.remaining - (performance.now() - state.started));
  state.paused = true;
  if (awaitingUser) {
    finishGuideLoad(context, 'awaiting-user');
  }
}

export function resumeGuideLoad(context: GuideLoadContext | undefined): void {
  if (!context) {
    return;
  }
  const state = loads.get(context.loadId);
  if (!state?.paused) {
    return;
  }
  state.started = performance.now();
  state.paused = false;
  state.timer = setTimeout(
    () =>
      finishGuideLoad(context, 'timeout', {
        source: context.source,
        stage: state.stage,
        reason: 'timeout',
      }),
    state.remaining
  );
}

export async function observeGuideRequest<T extends { status: number }>(
  url: string,
  role: GuideRequestRole,
  context: GuideLoadContext | undefined,
  work: () => Promise<T>
): Promise<T> {
  markGuideLoadStage(context, 'fetch');
  const started = performance.now();
  const source = guideSource(url);
  try {
    const response = await work();
    recordGuideRequest({
      context,
      url,
      role,
      durationMs: performance.now() - started,
      statusCode: response.status,
      diagnostic:
        response.status >= 400
          ? { source, stage: 'fetch', reason: 'http-error', statusCode: response.status }
          : undefined,
    });
    return response;
  } catch (error) {
    recordGuideRequest({
      context,
      url,
      role,
      durationMs: performance.now() - started,
      diagnostic: diagnoseGuideError(error, source),
    });
    throw error;
  }
}

export function fetchGuideResource(
  url: string,
  init?: RequestInit,
  context?: GuideLoadContext,
  role?: GuideRequestRole
): Promise<Response> {
  const fileRole =
    role ?? (url.includes('content.json') ? 'content-json' : url.includes('unstyled.html') ? 'unstyled-html' : 'page');
  return observeGuideRequest(url, fileRole, context, () => (init === undefined ? fetch(url) : fetch(url, init)));
}

export function markGuideLoadStage(context: GuideLoadContext | undefined, stage: GuideStage): void {
  const state = context && loads.get(context.loadId);
  if (state) {
    state.stage = stage;
  }
}

export function reportGuideRenderCrash(context: GuideLoadContext | undefined): void {
  if (!context) {
    return;
  }
  const diagnostic: GuideDiagnostic = { source: context.source, stage: 'render', reason: 'react-error' };
  if (loads.has(context.loadId)) {
    finishGuideLoad(context, 'error', diagnostic);
  } else {
    recordGuideRender(context, 'degraded', 0, diagnostic);
  }
}

export function identifyGuideLoad(context: GuideLoadContext | undefined, url: string): void {
  if (!context || context.source !== 'other') {
    return;
  }
  context.source = guideSource(url);
  context.guideRef = context.source === 'app-platform' ? opaqueGuideReference(url) : normalizeTelemetryUrl(url);
}
