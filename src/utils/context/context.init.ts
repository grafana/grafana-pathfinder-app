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
    console.error('@context/ Failed to initialize context services:', error);
  }
}

/**
 * Plugin lifecycle hook - call this when plugin starts
 */
export function onPluginStart(): void {
  initializeContextServices();
}

/**
 * Plugin lifecycle hook - call this when plugin stops
 */
export function onPluginStop(): void {
  // Note: We deliberately don't stop EchoSrv to keep capturing events
}
