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

import type { APIEvent, ExceptionEvent, TransportItem } from '@grafana/faro-react';
import { config } from '@grafana/runtime';
import pluginJson from '../plugin.json';

const COLLECTOR_URL = 'https://faro-collector-ops-eu-south-0.grafana-ops.net/collect/a81c4a455fd66a459225762586e121f2';
const VERSION = pluginJson.info.version ?? '0.0.0';
const FARO_GLOBAL_OBJECT_KEY = 'grafanaPathfinderApp';

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

  // Skip sending events in development mode or OSS environments
  if (isDevelopment || !isCloud) {
    const reason = isDevelopment ? 'local development' : 'OSS environment';
    console.log(`[Faro] skipping frontend metrics initialization (${reason})`);

    // Dynamically import Faro modules
    const { initializeFaro, ReactIntegration } = await import('@grafana/faro-react');

    // Initialize minimal Faro to prevent crashes in error boundaries
    initializeFaro({
      url: 'http://localhost:12345', // dummy URL that won't be used
      globalObjectKey: FARO_GLOBAL_OBJECT_KEY,
      app: {
        name: 'grafana-pathfinder-dev',
        version: VERSION,
        environment: isDevelopment ? 'development' : 'oss',
      },
      isolate: true,
      instrumentations: [
        // Minimal setup - just React integration for error boundary compatibility
        new ReactIntegration(),
      ],
      beforeSend: () => null, // Don't send any events
    });
    return;
  }

  // Grafana Cloud Production: Full Faro initialization with v2 features
  const { initializeFaro, getWebInstrumentations, ReactIntegration } = await import('@grafana/faro-react');
  const { TracingInstrumentation } = await import('@grafana/faro-web-tracing');

  initializeFaro({
    url: COLLECTOR_URL,
    globalObjectKey: FARO_GLOBAL_OBJECT_KEY,
    app: {
      name: 'grafana-pathfinder',
      version: VERSION,
      environment: config.buildInfo.env,
    },
    // Isolate from Grafana's own telemetry
    isolate: true,
    instrumentations: [
      ...getWebInstrumentations({
        captureConsole: true,
        enablePerformanceInstrumentation: true,
      }),
      // Tracing for HTTP request visibility
      new TracingInstrumentation(),
      // React integration for component-level insights
      new ReactIntegration(),
    ],
    // v2: Web Vitals attribution is now always collected (no config needed)
    // v2: Uses session.id automatically (no migration needed for default setup)
    beforeSend: (event: TransportItem<APIEvent>) => {
      return filterPathfinderErrors(event);
    },
  });

  console.log(`[Faro] successfully initialized frontend metrics (v2)`);
};

/**
 * Typeguard to check if an event is an exception event
 */
function isExceptionEvent(event: TransportItem<APIEvent>): event is TransportItem<ExceptionEvent> {
  return event.type === 'exception';
}

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
