import type { ExceptionEvent, Faro, LogEvent, TransportItem, APIEvent } from '@grafana/faro-web-sdk';
import { config } from '@grafana/runtime';
import packageJson from '../../package.json';

const COLLECTOR_URL = 'https://faro-collector-ops-eu-south-0.grafana-ops.net/collect/d6ec87b657b65de6e363de05623d9c57';
const APP_NAME = packageJson.name;
const APP_VERSION = packageJson.version;
const GLOBAL_OBJECT_KEY = 'grafanaPathfinderApp';
const LOG_PREFIX = '[pathfinder]';
const LOCAL_OVERRIDE_KEY = 'pathfinder.faro.local';

type FaroEnvironment = 'dev' | 'ops' | 'prod' | 'local';

let faroInstance: Faro | null = null;
let initStarted = false;

// Pathfinder is a micro-frontend inside Grafana; multiple Faro instances can
// share the page. `local` only activates via an explicit localStorage flag in
// a dev build, so a real production bundle can never take this path.
export function getEnvironment(hostname: string): FaroEnvironment | null {
  if (config.buildInfo.env === 'development') {
    try {
      return localStorage.getItem(LOCAL_OVERRIDE_KEY) === 'true' ? 'local' : null;
    } catch {
      return null;
    }
  }

  if (hostname.endsWith('.grafana-dev.net')) {
    return 'dev';
  }
  if (hostname.endsWith('.grafana-ops.net')) {
    return 'ops';
  }
  if (hostname.endsWith('.grafana.net') || hostname.endsWith('.grafana.com')) {
    return 'prod';
  }
  return null;
}

export function isGrafanaCloud(): boolean {
  try {
    return config.bootData?.settings?.buildInfo?.versionString?.startsWith('Grafana Cloud') ?? false;
  } catch {
    return false;
  }
}

function isPathfinderStackFrame(filename: string | undefined): boolean {
  return (
    typeof filename === 'string' && (filename.includes('grafana-pathfinder-app') || filename.includes('/pathfinder/'))
  );
}

function isExceptionItem(item: TransportItem<APIEvent>): item is TransportItem<ExceptionEvent> {
  return item.type === 'exception';
}

function isLogItem(item: TransportItem<APIEvent>): item is TransportItem<LogEvent> {
  return item.type === 'log';
}

// Whitelist, not blocklist: Grafana core and other app plugins run their own
// Faro instances on the same page, so exceptions/logs must be attributable to
// Pathfinder. Other item types (events, measurements) only ever originate
// from this isolated instance's own API, so they pass through unfiltered.
export function filterPathfinderTelemetry(item: TransportItem<APIEvent>): TransportItem<APIEvent> | null {
  if (isExceptionItem(item)) {
    const frames = item.payload.stacktrace?.frames ?? [];
    return frames.some((frame) => isPathfinderStackFrame(frame.filename)) ? item : null;
  }
  if (isLogItem(item)) {
    return item.payload.message.startsWith(LOG_PREFIX) ? item : null;
  }
  return item;
}

export function isFaroEnabled(): boolean {
  return faroInstance !== null;
}

export async function initFaro(): Promise<void> {
  if (initStarted) {
    return;
  }
  initStarted = true;

  const environment = getEnvironment(window.location.hostname);
  if (!environment) {
    return;
  }

  const isLocalOverride = environment === 'local';
  if (!isLocalOverride && (!isGrafanaCloud() || config.analytics?.enabled === false)) {
    return;
  }

  const { initializeFaro, ErrorsInstrumentation, SessionInstrumentation, ViewInstrumentation } =
    await import('@grafana/faro-web-sdk');

  faroInstance = initializeFaro({
    url: COLLECTOR_URL,
    globalObjectKey: GLOBAL_OBJECT_KEY,
    // Isolate from Grafana core's own Faro instance and other app plugins' —
    // without this, initializing here would clobber the global object Grafana
    // core attaches its own Faro instance to.
    isolate: true,
    app: {
      name: APP_NAME,
      version: APP_VERSION,
      environment,
    },
    instrumentations: [new ErrorsInstrumentation(), new SessionInstrumentation(), new ViewInstrumentation()],
    sessionTracking: {
      enabled: true,
      persistent: true,
      session: {
        attributes: {
          grafana_version: config.buildInfo.version,
        },
      },
    },
    beforeSend: filterPathfinderTelemetry,
  });
}

export function pushFaroError(error: Error, context?: Record<string, string>): void {
  try {
    faroInstance?.api.pushError(error, context ? { context } : undefined);
  } catch {
    // Telemetry must never break the app it's observing.
  }
}

export function pauseFaroBeforeReload(): void {
  try {
    faroInstance?.pause();
  } catch {
    // best-effort only
  }
}
