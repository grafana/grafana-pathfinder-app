import { getBackendSrv, config } from '@grafana/runtime';
import { lastValueFrom } from 'rxjs';
import { initializeEchoLogging, initializeFromRecentEvents } from './context-event-bus';
import { logger } from '../lib/logging';
import { armCompletionWriteHook } from '../completion-records';

/**
 * Fetch interactive guides from Pathfinder backend
 */
export async function fetchInteractiveGuidesFromBackend(): Promise<void> {
  const namespace = config.namespace;

  if (!namespace) {
    return;
  }

  try {
    const url = `/apis/pathfinderbackend.ext.grafana.com/v1alpha1/namespaces/${namespace}/interactiveguides`;
    await lastValueFrom(
      getBackendSrv().fetch({
        url,
        method: 'GET',
        // Optional rollout endpoint: don't show global toast when absent.
        showErrorAlert: false,
      })
    );
  } catch (error) {
    const status =
      (error as { status?: number; statusCode?: number; data?: { statusCode?: number } })?.status ??
      (error as { statusCode?: number })?.statusCode ??
      (error as { data?: { statusCode?: number } })?.data?.statusCode;
    const unavailableStatuses = new Set([400, 403, 404, 405, 501, 503]);

    if (status && unavailableStatuses.has(status)) {
      return;
    }

    logger.error('[Pathfinder] Failed to fetch interactive guides', { error });
  }
}

/**
 * Initialize context services at plugin startup
 * This ensures EchoSrv is listening for events even when the plugin UI is closed
 */
export function initializeContextServices(): void {
  try {
    // Initialize EchoSrv event logging immediately
    initializeEchoLogging();

    // Initialize from any recent events that might have been cached
    initializeFromRecentEvents();
  } catch (error) {
    logger.error('Failed to initialize context services', { error });
  }
}

/**
 * Plugin lifecycle hook - call this when plugin starts
 * SECURITY: Dev mode is now lazily initialized when user visits config with ?dev=true
 */
export function onPluginStart(): void {
  // Initialize context services only
  // Dev mode is lazily initialized to avoid unnecessary API calls for anonymous users
  initializeContextServices();

  // Arm the durable completion-write hook (Track 2). Capability-gated and
  // fire-and-forget: it never blocks startup and never throws — on stacks
  // without App Platform aggregation it no-ops and behavior is unchanged.
  void armCompletionWriteHook();
}
