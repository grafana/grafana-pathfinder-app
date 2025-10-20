import { ContextService } from './context.service';

/**
 * Initialize context services at plugin startup
 * This ensures EchoSrv is listening for events even when the plugin UI is closed
 */
export function initializeContextServices(): void {
  try {
    // Initialize EchoSrv event logging immediately
    ContextService.initializeEchoLogging();

    // Initialize from any recent events that might have been cached
    ContextService.initializeFromRecentEvents();
  } catch (error) {
    console.error('Failed to initialize context services:', error);
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
