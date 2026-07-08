import type {
  EventEvent,
  ExceptionEvent,
  Faro,
  LogEvent,
  LogLevel,
  TransportItem,
  APIEvent,
  UserActionInternalInterface,
} from '@grafana/faro-web-sdk';
import { config } from '@grafana/runtime';
import packageJson from '../../package.json';
import {
  ALLOWED_GRAFANA_DOCS_HOSTNAMES,
  ALLOWED_INTERACTIVE_LEARNING_HOSTNAMES,
  ALLOWED_RECOMMENDER_DOMAINS,
} from '../constants';

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

function isEventItem(item: TransportItem<APIEvent>): item is TransportItem<EventEvent> {
  return item.type === 'event';
}

// PerformanceInstrumentation reports every fetch/xhr resource load on the
// page (Grafana core's own requests included) — these two are the only
// domains this plugin itself ever fetches from, so anything else is core's
// traffic, not ours.
const TRACKED_RESOURCE_HOSTNAMES = new Set([
  ...ALLOWED_GRAFANA_DOCS_HOSTNAMES,
  ...ALLOWED_RECOMMENDER_DOMAINS,
  ...ALLOWED_INTERACTIVE_LEARNING_HOSTNAMES,
]);

function isTrackedResourceUrl(resourceUrl: string | undefined): boolean {
  if (typeof resourceUrl !== 'string') {
    return false;
  }
  try {
    return TRACKED_RESOURCE_HOSTNAMES.has(new URL(resourceUrl).hostname);
  } catch {
    return false;
  }
}

// Whitelist, not blocklist: Grafana core and other app plugins run their own
// Faro instances on the same page, so exceptions/logs must be attributable to
// Pathfinder, and PerformanceInstrumentation's resource entries must be
// attributable to a domain we actually fetch from. Page-wide navigation
// timing (the whole page's load, not a specific resource) is always dropped.
// Everything else — our own pushed events/user-actions/measurements — only
// ever originates from this isolated instance's own API, so it passes
// through unfiltered.
export function filterPathfinderTelemetry(item: TransportItem<APIEvent>): TransportItem<APIEvent> | null {
  if (isExceptionItem(item)) {
    const frames = item.payload.stacktrace?.frames ?? [];
    return frames.some((frame) => isPathfinderStackFrame(frame.filename)) ? item : null;
  }
  if (isLogItem(item)) {
    return item.payload.message.startsWith(LOG_PREFIX) ? item : null;
  }
  if (isEventItem(item)) {
    if (item.payload.name === 'faro.performance.navigation') {
      return null;
    }
    if (item.payload.name === 'faro.performance.resource') {
      return isTrackedResourceUrl(item.payload.attributes?.['name']) ? item : null;
    }
  }
  return item;
}

export function isFaroEnabled(): boolean {
  return faroInstance !== null;
}

export async function initFaro(sampleRate = 1): Promise<void> {
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

  const {
    initializeFaro,
    ErrorsInstrumentation,
    SessionInstrumentation,
    ViewInstrumentation,
    PerformanceInstrumentation,
  } = await import('@grafana/faro-web-sdk');

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
    instrumentations: [
      new ErrorsInstrumentation(),
      new SessionInstrumentation(),
      new ViewInstrumentation(),
      // Only fetch/xhr resources are tracked by default (config.trackResources
      // is left unset) — not every image/script/CSS on the page. Filtered
      // further in beforeSend down to docs/recommender hosts specifically.
      new PerformanceInstrumentation(),
    ],
    sessionTracking: {
      enabled: true,
      // Faro's persistent-session localStorage key is a fixed SDK constant
      // (`com.grafana.faro.session`) that `isolate` does not namespace, and
      // Grafana core's Faro uses it too — persistent:true would resume core's
      // session, inherit its sampling decision (making samplingRate below a
      // no-op), and could contaminate core's RUM sampling in return. Volatile
      // sessions live in sessionStorage, which core doesn't touch.
      persistent: false,
      // A session not selected by the sample sends nothing for its entire
      // lifetime. The local QA override always gets the real rate (1), not
      // whatever the remote production-volume control happens to be set to.
      samplingRate: isLocalOverride ? 1 : sampleRate,
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

export type FaroLogLevel = 'info' | 'warn' | 'error';

export function pushFaroLog(level: FaroLogLevel, message: string, context?: Record<string, string>): void {
  try {
    faroInstance?.api.pushLog([`${LOG_PREFIX} ${message}`], { level: level as LogLevel, context });
  } catch {
    // Telemetry must never break the app it's observing.
  }
}

const MAX_ATTRIBUTE_LENGTH = 500;

// Faro event attributes are string-only; analytics properties are not
// (numbers, booleans, the experiments array). Stringify here so every
// caller of pushFaroEvent gets the same coercion.
export function stringifyAttributes(attributes: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (value === null || value === undefined) {
      continue;
    }
    const stringified =
      typeof value === 'string' ? value : typeof value === 'object' ? JSON.stringify(value) : String(value);
    result[key] = stringified.slice(0, MAX_ATTRIBUTE_LENGTH);
  }
  return result;
}

let userActionSeq = 0;

// Faro's public startUserAction() return type only exposes `name`/`parentId` —
// ending it requires the internal interface. This isn't a hack: Faro's own
// built-in click instrumentation (UserActionController) does the exact same
// cast internally, since UserActionsAPI has no top-level `endUserAction()`.
export function pushFaroUserAction(name: string, attributes?: Record<string, unknown>): void {
  try {
    const action = faroInstance?.api.startUserAction(name, {
      ...(attributes ? stringifyAttributes(attributes) : {}),
      // Faro's dedupe compares name+attributes but not timestamps, so two
      // identical mirrors in the same millisecond would collapse into one
      // event; `seq` keeps the count in parity with RudderStack.
      seq: String(userActionSeq++),
    });
    (action as UserActionInternalInterface | undefined)?.end();
  } catch {
    // Telemetry must never break the app it's observing.
  }
}

export function setFaroView(url: string): void {
  try {
    if (!url || !faroInstance) {
      return;
    }
    const { hostname, pathname } = new URL(url, window.location.origin);
    faroInstance.api.setView({ name: `${hostname}${pathname}` });
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
