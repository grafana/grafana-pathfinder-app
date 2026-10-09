import { initializeEchoLogging, initializeFromRecentEvents } from './context-event-bus';
import { logger } from '../lib/logging';

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
  // Dev mode is lazily initialized to avoid unnecessary API calls for anonymous users
  initializeContextServices();
  // The durable completion-write hook is armed from the universal plugin
  // bootstrap (plugin.init in module.tsx), not here — the root App page is only
  // one of several entry surfaces, so arming here would miss the others.
}
