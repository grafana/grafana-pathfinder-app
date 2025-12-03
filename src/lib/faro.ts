/**
 * Grafana Faro v2 Frontend Observability
 *
 * This module initializes Faro for capturing errors, performance metrics,
 * traces, and console logs from the pathfinder plugin.
 *
 * Faro telemetry is ONLY enabled for Grafana Cloud users. OSS/self-hosted
 * users do not send any telemetry data to Grafana.
 *
 * In development mode or OSS environments, a minimal Faro instance is created
 * that doesn't send any events but prevents crashes in error boundaries.
 *
 * In Grafana Cloud production, full instrumentation is enabled with error
 * filtering to only capture events originating from this plugin.
 */

import type { APIEvent, ExceptionEvent, TransportItem, Faro } from '@grafana/faro-react';
import { config } from '@grafana/runtime';
import { matchRoutes } from 'react-router-dom';
import pluginJson from '../plugin.json';

const COLLECTOR_URL = 'https://faro-collector-ops-eu-south-0.grafana-ops.net/collect/1ac4cba0a01deb04ef25e9758fb177b1';
const VERSION = pluginJson.info.version ?? '0.0.0';
// Unique global object key to isolate this Faro instance from Grafana's main instance
const FARO_GLOBAL_OBJECT_KEY = 'grafanaPathfinderApp';

// ============================================================================
// FARO INSTANCE REFERENCE
// ============================================================================
// Store a reference to the initialized Faro instance to avoid repeated dynamic imports
// which could potentially load different module chunks
let faroInstance: Faro | null = null;
// Store LogLevel enum for use in pushFaroLog
let FaroLogLevel: typeof import('@grafana/faro-react').LogLevel | null = null;

// ============================================================================
// LOCAL TESTING FLAG
// ============================================================================
// Set to true to enable full Faro instrumentation locally for testing.
// Remember to set back to false before committing!
const ENABLE_FARO_LOCALLY = false;

/**
 * Check if running in Grafana Cloud
 * Uses the same detection pattern as the rest of the codebase
 */
const isGrafanaCloud = (): boolean => {
  try {
    return config.bootData?.settings?.buildInfo?.versionString?.startsWith('Grafana Cloud') ?? false;
  } catch {
    return false;
  }
};

/**
 * Initialize Faro metrics collection
 *
 * Uses dynamic imports to keep the main bundle small and allows
 * conditional loading of tracing instrumentation only in production.
 *
 * Telemetry is only sent for Grafana Cloud users - OSS users get a
 * minimal no-op instance to prevent error boundary crashes.
 */
export const initializeFaroMetrics = async (): Promise<void> => {
  const isDevelopment = config.buildInfo.env === 'development';
  const isCloud = isGrafanaCloud();

  // Check if we should enable full Faro (either in Cloud or local testing mode)
  const shouldEnableFaro = ENABLE_FARO_LOCALLY || (isCloud && !isDevelopment);

  // For development or OSS environments (unless local testing is enabled), initialize minimal Faro
  // This prevents crashes in error boundaries but doesn't send any telemetry
  if (!shouldEnableFaro) {
    const reason = isDevelopment ? 'local development' : 'OSS environment';
    console.log(`[Faro] skipping frontend metrics initialization (${reason})`);

    // Dynamically import Faro modules
    const { initializeFaro, ReactIntegration, LogLevel } = await import('@grafana/faro-react');
    const { TracingInstrumentation } = await import('@grafana/faro-web-tracing');

    // Initialize minimal Faro to prevent crashes in error boundaries
    // IMPORTANT: Use returned instance, not the `faro` export (which is global, not isolated)
    const isolatedFaro = initializeFaro({
      url: 'http://localhost:12345', // dummy URL that won't be used
      globalObjectKey: FARO_GLOBAL_OBJECT_KEY,
      app: {
        name: 'grafana-pathfinder-dev',
        version: VERSION,
        environment: isDevelopment ? 'development' : 'oss',
      },
      isolate: true,
      instrumentations: [
        // React integration for error boundary compatibility
        new ReactIntegration(),
        // TracingInstrumentation required for withFaroProfiler HOC to work without warnings
        new TracingInstrumentation(),
      ],
      beforeSend: () => null, // Don't send any events
    });

    // Store references to the initialized instance (use returned instance, not export)
    faroInstance = isolatedFaro;
    FaroLogLevel = LogLevel;
    return;
  }

  // Production Grafana Cloud environment - full instrumentation
  const { initializeFaro, getWebInstrumentations, ReactIntegration, createReactRouterV6DataOptions, LogLevel } =
    await import('@grafana/faro-react');
  const { TracingInstrumentation, getDefaultOTELInstrumentations } = await import('@grafana/faro-web-tracing');

  // URLs to completely ignore from fetch instrumentation.
  // OpenTelemetry's FetchInstrumentation wraps responses in a new Response() object,
  // which loses the response.url property (browser limitation - can't set url in constructor).
  // We need response.url for proper redirect handling (docs pages move/redirect frequently).
  // Trade-off: We lose HTTP tracing for these URLs but keep all other Faro features.
  const docsUrlsToIgnore: RegExp[] = [
    /grafana\.com\/docs/,
    /grafana\.com\/tutorials/,
    /grafana\.com\/learning-journeys/,
    /raw\.githubusercontent\.com/,
    // Data proxy URLs that redirect to GitHub - must ignore to preserve response.url
    /api\/plugin-proxy\/grafana-pathfinder-app\/github-raw/,
  ];

  // IMPORTANT: Use returned instance, not the `faro` export (which is global, not isolated)
  const isolatedFaro = initializeFaro({
    url: COLLECTOR_URL,
    globalObjectKey: FARO_GLOBAL_OBJECT_KEY,
    app: {
      name: 'grafana-pathfinder',
      version: VERSION,
      environment: config.buildInfo.env,
    },
    // Isolate this Faro instance from Grafana's main Faro instance
    // This ensures we only capture telemetry from the pathfinder plugin
    isolate: true,
    instrumentations: [
      // Mandatory, omits default instrumentations otherwise.
      ...getWebInstrumentations(),
      // Tracing package to get end-to-end visibility for HTTP requests.
      // IMPORTANT: Pass custom instrumentations with ignoreUrls to prevent
      // fetch instrumentation from wrapping docs requests. This fixes the issue
      // where response.url becomes empty due to the instrumentation wrapper.
      new TracingInstrumentation({
        instrumentations: getDefaultOTELInstrumentations({
          ignoreUrls: docsUrlsToIgnore,
          propagateTraceHeaderCorsUrls: [],
        }),
      }),
      // React integration for React applications.
      new ReactIntegration({
        router: createReactRouterV6DataOptions({
          matchRoutes,
        }),
      }),
    ],
    // Filter events to only include those from the pathfinder plugin
    // This reduces noise from other Grafana errors in our Faro dashboard
    beforeSend: (event: TransportItem<APIEvent>) => {
      return filterPathfinderErrors(event);
    },
  });

  // Store references to the initialized instance (use returned instance, not export)
  faroInstance = isolatedFaro;
  FaroLogLevel = LogLevel;

  // Set initial session attributes for enhanced context
  setInitialSessionAttributes();

  console.log(`[Faro] successfully initialized frontend metrics (v2)`);
};

/**
 * Typeguard to check if an event is an exception event
 */
function isExceptionEvent(event: TransportItem<APIEvent>): event is TransportItem<ExceptionEvent> {
  return event.type === 'exception';
}

// ============================================================================
// USER ACTION TRACKING
// ============================================================================

/**
 * Importance levels for user actions
 * Critical actions are used for key journeys and alerting
 */
export type UserActionImportanceLevel = 'normal' | 'critical';

// Track if a user action is currently running to prevent overlapping actions
let isUserActionRunning = false;
let userActionResetTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Starts a Faro user action for tracking end-to-end user journeys.
 * User actions link with HTTP requests, errors, and performance metrics.
 *
 * Note: Faro only allows one user action at a time. This function skips
 * starting a new action if one is already running to prevent warnings.
 *
 * @param name - The name of the user action (e.g., 'sidebar-open', 'tutorial-start')
 * @param attributes - Additional attributes to attach to the action
 * @param options - Configuration options including importance level
 *
 * @see https://grafana.com/docs/grafana-cloud/monitor-applications/frontend-observability/instrument/user-actions/
 */
export function startFaroUserAction(
  name: string,
  attributes?: Record<string, string>,
  options?: { importance?: UserActionImportanceLevel }
): void {
  // Skip if Faro not initialized or a user action is already running
  if (!faroInstance?.api || isUserActionRunning) {
    return;
  }

  try {
    // UserActionImportance values are 'normal' | 'critical' (strings)
    const importance = options?.importance ?? 'normal';

    faroInstance.api.startUserAction(name, attributes, {
      importance,
    });

    // Mark as running and auto-reset after timeout
    // User actions typically complete within a few seconds
    isUserActionRunning = true;
    if (userActionResetTimeout) {
      clearTimeout(userActionResetTimeout);
    }
    userActionResetTimeout = setTimeout(() => {
      isUserActionRunning = false;
    }, 3000); // Reset after 3 seconds
  } catch {
    // Faro may not be initialized, ignore silently
  }
}

// ============================================================================
// CUSTOM MEASUREMENTS
// ============================================================================

/**
 * Pushes a custom measurement to Faro for performance tracking.
 *
 * @param name - The measurement name (e.g., 'content_load_time', 'tutorial_tti')
 * @param value - The measurement value (typically in milliseconds)
 * @param attributes - Additional context attributes
 *
 * @example
 * ```typescript
 * pushFaroMeasurement('content_load_time', 1234, { url: 'https://grafana.com/docs/...' });
 * pushFaroMeasurement('tutorial_tti', 567, { tutorial_id: 'explore-drilldowns-101' });
 * ```
 */
export function pushFaroMeasurement(name: string, value: number, attributes?: Record<string, string>): void {
  if (!faroInstance?.api) {
    return;
  }

  try {
    faroInstance.api.pushMeasurement({
      type: name,
      values: { value },
      context: attributes,
    });
  } catch {
    // Faro may not be initialized, ignore silently
  }
}

// ============================================================================
// STRUCTURED LOGGING
// ============================================================================

/**
 * Log levels supported by Faro
 * Maps to Faro's LogLevel enum: TRACE, DEBUG, INFO, LOG, WARN, ERROR
 */
export type FaroLogLevel = 'trace' | 'debug' | 'info' | 'log' | 'warn' | 'error';

/**
 * Pushes a structured log message to Faro.
 * Useful for tracking important events that should be visible in the Faro dashboard.
 *
 * @param level - The log level (trace, debug, info, log, warn, error)
 * @param message - The log message
 * @param context - Additional context to attach to the log
 *
 * @example
 * ```typescript
 * pushFaroLog('info', 'Tutorial started', { tutorial_id: 'explore-101', milestone: '1' });
 * pushFaroLog('error', 'Content load failed', { url: '...', error: 'timeout' });
 * ```
 */
export function pushFaroLog(level: FaroLogLevel, message: string, context?: Record<string, string>): void {
  if (!faroInstance?.api || !FaroLogLevel) {
    return;
  }

  try {
    // Map string level to LogLevel enum
    const logLevelMap: Record<FaroLogLevel, (typeof FaroLogLevel)[keyof typeof FaroLogLevel]> = {
      trace: FaroLogLevel.TRACE,
      debug: FaroLogLevel.DEBUG,
      info: FaroLogLevel.INFO,
      log: FaroLogLevel.LOG,
      warn: FaroLogLevel.WARN,
      error: FaroLogLevel.ERROR,
    };

    faroInstance.api.pushLog([message], { level: logLevelMap[level], context });
  } catch {
    // Faro may not be initialized, ignore silently
  }
}

// ============================================================================
// SESSION ATTRIBUTES
// ============================================================================

/**
 * Sets session-level attributes in Faro for enhanced context.
 * These attributes are attached to all subsequent events.
 *
 * @param attributes - Key-value pairs to set as session attributes
 *
 * @example
 * ```typescript
 * setFaroSessionAttributes({
 *   user_experience_level: 'beginner',
 *   grafana_version: '10.2.0',
 *   feature_flags: 'assistant,recommendations',
 * });
 * ```
 */
export function setFaroSessionAttributes(attributes: Record<string, string>): void {
  if (!faroInstance?.api) {
    return;
  }

  try {
    faroInstance.api.setSession({
      attributes,
    });
  } catch {
    // Faro may not be initialized, ignore silently
  }
}

/**
 * Sets user-level attributes in Faro for user identification.
 *
 * @param userId - Optional user identifier
 * @param attributes - Additional user attributes
 */
export function setFaroUserAttributes(userId?: string, attributes?: Record<string, string>): void {
  if (!faroInstance?.api) {
    return;
  }

  try {
    faroInstance.api.setUser({
      id: userId,
      attributes,
    });
  } catch {
    // Faro may not be initialized, ignore silently
  }
}

/**
 * Sets initial session attributes when Faro is initialized.
 * This includes Grafana version and environment information.
 */
function setInitialSessionAttributes(): void {
  try {
    const grafanaVersion = config.buildInfo?.version ?? 'unknown';
    const environment = config.buildInfo?.env ?? 'unknown';

    setFaroSessionAttributes({
      grafana_version: grafanaVersion,
      environment: environment,
      plugin_version: VERSION,
    });
  } catch {
    // Config may not be available, ignore silently
  }
}

// ============================================================================
// VIEW TRACKING
// ============================================================================

/**
 * Sets the current view in Faro for tracking content/tab changes.
 * For sidebar panels like Pathfinder, this tracks which content is displayed.
 *
 * @param viewName - Name of the view (e.g., 'recommendations', 'docs', 'learning-journey')
 * @param attributes - Additional context (url, milestone, etc.) - logged separately
 */
export function setFaroView(viewName: string, attributes?: Record<string, string>): void {
  if (!faroInstance?.api) {
    return;
  }

  try {
    // Set the view for navigation tracking
    faroInstance.api.setView({ name: viewName });

    // Log additional context attributes if provided
    if (attributes && Object.keys(attributes).length > 0) {
      pushFaroLog('info', `View: ${viewName}`, attributes);
    }
  } catch {
    // Faro may not be initialized
  }
}

// ============================================================================
// ERROR FILTERING
// ============================================================================

/**
 * Filter errors to only include those originating from the pathfinder plugin
 *
 * This prevents noise from other Grafana errors appearing in our Faro dashboard.
 * The filter checks if the error stack trace includes the plugin's file paths.
 *
 * @param event - The Faro transport item to evaluate
 * @returns The event if it's from pathfinder, null otherwise
 */
export function filterPathfinderErrors(event: TransportItem<APIEvent>): TransportItem<APIEvent> | null {
  // In development we want to see all errors (if faro is enabled)
  if (config.buildInfo.env === 'development') {
    return event;
  }

  /**
   * Filter out errors not from the pathfinder plugin.
   * Check if the error stack trace contains the plugin's file paths.
   */
  if (isExceptionEvent(event) && event.payload.type === 'Error') {
    const trace = event.payload.stacktrace;
    if (trace) {
      const isPathfinderError = trace.frames.some(
        (frame) => typeof frame.filename === 'string' && frame.filename.includes('/grafana-pathfinder-app/./')
      );

      // Discard anything not from the pathfinder plugin
      if (!isPathfinderError) {
        return null;
      }
    }
  }

  return event;
}
