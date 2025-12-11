/**
 * Grafana Faro v2 Frontend Observability
 *
 * This module initializes Faro for capturing errors, performance metrics,
 * traces, and console logs from the pathfinder plugin.
 *
 * Faro telemetry is ONLY enabled for Grafana Cloud environments.
 * OSS/self-hosted/local instances do not send any telemetry data.
 *
 * Environment is automatically determined from the domain:
 * - *.grafana-dev.net → dev
 * - *.grafana-ops.net → ops
 * - *.grafana.net or *.grafana.com → prod
 *
 * Usage:
 *   import { initFaro, isFaroEnabled, pauseFaroBeforeReload } from './lib/faro';
 *
 *   // Initialize Faro (call once at app startup)
 *   initFaro();
 *
 *   // Check if Faro is enabled before running Faro-specific code
 *   if (isFaroEnabled()) {
 *     // ... Faro-related operations
 *   }
 *
 *   // Before page reload, pause Faro to prevent race conditions
 *   pauseFaroBeforeReload();
 *   window.location.reload();
 */

import { matchRoutes } from 'react-router-dom';
import {
  initializeFaro,
  faro,
  createReactRouterV6DataOptions,
  ReactIntegration,
  getWebInstrumentations,
} from '@grafana/faro-react';
//import { TracingInstrumentation } from '@grafana/faro-web-tracing';
import packageJson from '../../package.json';
import { error as logError } from './logger';

const COLLECTOR_URL = 'https://faro-collector-ops-eu-south-0.grafana-ops.net/collect/d6ec87b657b65de6e363de05623d9c57';
const VERSION = packageJson.version ?? '0.0.0';
const NAME = packageJson.name ?? 'grafana-pathfinder-app';

// Set to true to enable Faro locally for testing
const ENABLE_FARO_LOCALLY = false;

type Environment = 'dev' | 'ops' | 'prod' | 'local';

// Track initialization state
let faroInitialized = false;

/**
 * Determines the Grafana Cloud environment from the hostname.
 * Returns null if not running on a Grafana Cloud domain (unless local testing is enabled).
 */
const getEnvironment = (): Environment | null => {
  const hostname = window.location.hostname;

  if (hostname.endsWith('.grafana-dev.net')) {
    return 'dev';
  }
  if (hostname.endsWith('.grafana-ops.net')) {
    return 'ops';
  }
  if (hostname.endsWith('.grafana.net') || hostname.endsWith('.grafana.com')) {
    return 'prod';
  }

  if (ENABLE_FARO_LOCALLY) {
    return 'local';
  }

  return null;
};

/**
 * Check if Faro is enabled for the current environment.
 * Use this to conditionally run Faro-related code.
 */
export const isFaroEnabled = (): boolean => {
  return getEnvironment() !== null;
};

/**
 * Initialize Faro metrics collection.
 * Call this once at app startup. Safe to call multiple times (will no-op after first init).
 * Errors are caught internally to prevent plugin crashes.
 */
export const initFaro = (): void => {
  if (faroInitialized) {
    return;
  }

  const environment = getEnvironment();

  if (environment === null) {
    return;
  }

  try {
    initializeFaro({
      url: COLLECTOR_URL,
      app: {
        name: NAME,
        version: VERSION,
        environment,
      },
      isolate: true,
      // Use custom transport to silently handle errors
      // This prevents Faro from logging to console.error when transport fails,
      // which would otherwise be captured by other plugins' Faro instances
      instrumentations: [
        ...getWebInstrumentations(),
        //new TracingInstrumentation(), // Causing issues with other plugins do not enable until fixed
        new ReactIntegration({
          router: createReactRouterV6DataOptions({
            matchRoutes,
          }),
        }),
      ],
      // Ignore URLs that we fetch for content - TracingInstrumentation breaks response.url on these
      ignoreUrls: [
        /interactive-learning\.grafana\.net/,
        /interactive-learning\.grafana-dev\.net/,
        /interactive-learning\.grafana-ops\.net/,
        /grafana\.com\/docs/,
        /grafana\.com\/tutorials/,
        /grafana\.com\/learning-journeys/,
      ],
      // Filter events to only capture Pathfinder-related logs and errors
      // This is a whitelist approach - much cleaner than maintaining a long ignoreErrors list
      beforeSend: (item) => {
        // For logs, only send those with our [pathfinder] prefix
        if (item.type === 'log') {
          const message = String((item.payload as { message?: string })?.message || '');
          if (!message.includes('[pathfinder]')) {
            return null;
          }
        }

        // For exceptions, check stack trace for our plugin code
        if (item.type === 'exception') {
          const payload = item.payload as { stacktrace?: { frames?: Array<{ filename?: string }> } };
          const frames = payload?.stacktrace?.frames || [];
          const isFromPathfinder = frames.some(
            (frame) => frame.filename?.includes('grafana-pathfinder-app') || frame.filename?.includes('/pathfinder/')
          );
          if (!isFromPathfinder) {
            return null;
          }
        }

        return item;
      },
      sessionTracking: {
        enabled: true,
        persistent: true,
      },
    });

    faroInitialized = true;
  } catch (err) {
    logError('[Faro] Failed to initialize:', err);
  }
};

/**
 * Pause Faro before page reload to prevent "Failed to fetch" errors.
 * Call this before triggering window.location.reload() to gracefully
 * stop Faro from attempting to send data during page unload.
 */
export const pauseFaroBeforeReload = (): void => {
  if (!faroInitialized) {
    return;
  }

  try {
    // Pause Faro to stop all instrumentations and prevent pending requests
    faro.pause();
  } catch (err) {
    // Silently ignore - we're about to reload anyway
  }
};
