import { config } from '@grafana/runtime';
import { initializeEchoLogging, initializeFromRecentEvents } from './context-event-bus';
import { collectionUrl, readListMerged } from '../utils/interactive-guides-api';
import { logger } from '../lib/logging';

/**
 * Fetch interactive guides from Pathfinder backend
 */
export async function fetchInteractiveGuidesFromBackend(): Promise<void> {
  const namespace = config.namespace;

  if (!namespace) {
    return;
  }

  try {
    // Dormant warm/probe: result discarded. readListMerged swallows
    // "not rolled out" statuses and re-throws only genuine errors.
    await readListMerged((apiVersion) => collectionUrl(apiVersion, namespace));
  } catch (error) {
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
}
