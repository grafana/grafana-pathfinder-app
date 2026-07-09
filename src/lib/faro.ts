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
import pluginJson from '../plugin.json';
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

// Faro init is engagement-gated: sessions must mean "used Pathfinder or
// Pathfinder errored", not "loaded a Grafana page". While armed, facade calls
// queue here and flush after the first trigger (any analytics event except
// flag exposures, or an error) completes the real init.
type BufferedFaroCall =
  | { kind: 'error'; error: Error; context?: Record<string, string> }
  | { kind: 'log'; level: FaroLogLevel; message: string; context?: Record<string, string> }
  | { kind: 'userAction'; name: string; attributes?: Record<string, unknown> };

const PRE_INIT_BUFFER_CAP = 30;
let preInitBuffer: BufferedFaroCall[] | null = null;
let pendingInit: Promise<void> | null = null;

function guardTelemetry(fn: () => void): void {
  try {
    fn();
  } catch {
    // Telemetry must never break the app it's observing.
  }
}

// The SDK's fixed volatile-session sessionStorage key. Hardcoded because
// importing the constant would pull @grafana/faro-web-sdk into the entry
// bundle — the SDK must stay behind the dynamic import in initFaro.
const FARO_SESSION_STORAGE_KEY = 'com.grafana.faro.session';

function hasLiveFaroSession(): boolean {
  try {
    return sessionStorage.getItem(FARO_SESSION_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

function bufferPreInitCall(call: BufferedFaroCall): boolean {
  if (!preInitBuffer) {
    return false;
  }
  if (preInitBuffer.length >= PRE_INIT_BUFFER_CAP) {
    preInitBuffer.shift();
  }
  preInitBuffer.push(call);
  return true;
}

function flushPreInitBuffer(): void {
  const buffered = preInitBuffer ?? [];
  preInitBuffer = null;
  for (const call of buffered) {
    if (call.kind === 'error') {
      pushFaroError(call.error, call.context);
    } else if (call.kind === 'log') {
      pushFaroLog(call.level, call.message, call.context);
    } else {
      pushFaroUserAction(call.name, call.attributes);
    }
  }
}

function triggerFaroInit(): Promise<void> {
  if (!pendingInit) {
    pendingInit = initFaro()
      .catch(() => undefined)
      .then(() => flushPreInitBuffer());
  }
  return pendingInit;
}

export function armFaro(): void {
  if (initStarted || preInitBuffer) {
    return;
  }
  const resolved = resolveFaroEnvironment();
  if (!resolved) {
    return;
  }
  if (resolved.isLocalOverride || hasLiveFaroSession()) {
    void triggerFaroInit();
    return;
  }
  preInitBuffer = [];
}

export function notifyFaroEngagement(): Promise<void> {
  if (!preInitBuffer && !pendingInit) {
    return Promise.resolve();
  }
  return triggerFaroInit();
}

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

// Both derived from their source of truth (Grafana serves plugin assets from
// /public/plugins/<id>/; sourcemapped frames use webpack://<package name>/),
// so a plugin rename can't silently break the whitelist.
const PLUGIN_ASSET_PATH = `/public/plugins/${pluginJson.id}/`;

function isPathfinderStackFrame(filename: string | undefined): boolean {
  return typeof filename === 'string' && (filename.includes(PLUGIN_ASSET_PATH) || filename.includes(APP_NAME));
}

// Exceptions we report explicitly (error boundaries, logger) must survive the
// beforeSend frame filter even when the stack is missing or lives entirely in
// a shared chunk; ambient window errors still need a Pathfinder frame.
const EXPLICIT_REPORT_MARKER = 'pathfinder_reported';

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
// page (Grafana core's own requests included); only hosts this plugin itself
// fetches from are kept.
const TRACKED_RESOURCE_HOSTNAMES = new Set([
  ...ALLOWED_GRAFANA_DOCS_HOSTNAMES,
  ...ALLOWED_RECOMMENDER_DOMAINS,
  ...ALLOWED_INTERACTIVE_LEARNING_HOSTNAMES,
]);

// Bare grafana.com is shared with Grafana core (plugin catalog, news feed);
// only the docs/tutorials paths url-validator lets this plugin fetch count.
const SHARED_HOSTNAME = 'grafana.com';
const SHARED_HOSTNAME_PATH_PREFIXES = ['/docs', '/tutorials'];

function isTrackedResourceUrl(resourceUrl: string | undefined): boolean {
  if (typeof resourceUrl !== 'string') {
    return false;
  }
  try {
    const { hostname, pathname } = new URL(resourceUrl);
    if (!TRACKED_RESOURCE_HOSTNAMES.has(hostname)) {
      return false;
    }
    return (
      hostname !== SHARED_HOSTNAME ||
      SHARED_HOSTNAME_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
    );
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
    if (item.payload.context?.[EXPLICIT_REPORT_MARKER] === 'true') {
      return item;
    }
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

function resolveFaroEnvironment(): { environment: FaroEnvironment; isLocalOverride: boolean } | null {
  const environment = getEnvironment(window.location.hostname);
  if (!environment) {
    return null;
  }
  const isLocalOverride = environment === 'local';
  if (!isLocalOverride && (!isGrafanaCloud() || config.analytics?.enabled === false)) {
    return null;
  }
  return { environment, isLocalOverride };
}

export async function initFaro(): Promise<void> {
  if (initStarted) {
    return;
  }
  initStarted = true;

  const resolved = resolveFaroEnvironment();
  if (!resolved) {
    return;
  }
  const { environment } = resolved;

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
      // session, inherit its sampling decision, and could contaminate core's
      // RUM sampling in return. Volatile sessions live in sessionStorage,
      // which core doesn't touch.
      persistent: false,
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
  guardTelemetry(() => {
    if (bufferPreInitCall({ kind: 'error', error, context })) {
      void triggerFaroInit();
      return;
    }
    faroInstance?.api.pushError(error, { context: { ...context, [EXPLICIT_REPORT_MARKER]: 'true' } });
  });
}

export type FaroLogLevel = 'info' | 'warn' | 'error';

export function pushFaroLog(level: FaroLogLevel, message: string, context?: Record<string, string>): void {
  guardTelemetry(() => {
    if (bufferPreInitCall({ kind: 'log', level, message, context })) {
      if (level === 'error') {
        void triggerFaroInit();
      }
      return;
    }
    faroInstance?.api.pushLog([`${LOG_PREFIX} ${message}`], { level: level as LogLevel, context });
  });
}

const MAX_ATTRIBUTE_LENGTH = 500;

// Faro event attributes are string-only; analytics properties are not
// (numbers, booleans, the experiments array). Stringify here so every
// user-action producer gets the same coercion.
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
  guardTelemetry(() => {
    if (bufferPreInitCall({ kind: 'userAction', name, attributes })) {
      return;
    }
    if (!faroInstance) {
      return;
    }
    const attrs = {
      ...(attributes ? stringifyAttributes(attributes) : {}),
      // Faro's dedupe compares name+attributes but not timestamps, so two
      // identical mirrors in the same millisecond would collapse into one
      // event; `seq` keeps the count in parity with RudderStack.
      seq: String(userActionSeq++),
    };
    // A real action is in flight: starting another would return undefined and
    // silently drop this mirror. Push it as a plain event instead — the SDK
    // buffers it into the open action and stamps action.parentId/name on end.
    if (faroInstance.api.getActiveUserAction() !== undefined) {
      faroInstance.api.pushEvent(name, attrs, undefined, { skipDedupe: true });
      return;
    }
    const action = faroInstance.api.startUserAction(name, attrs);
    (action as UserActionInternalInterface | undefined)?.end();
  });
}

const USER_ACTION_TIMEOUT_MS = 30_000;
export const USER_ACTION_TIMEOUT_LONG_MS = 600_000;

type StampableUserAction = UserActionInternalInterface & { attributes?: Record<string, string> };

// UserActionInternalInterface.end() declares an attributes parameter, but the
// 2.8.2 implementation ignores it — outcome must be stamped by mutating the
// action's public `attributes` field before end(). end() also only guards
// re-entry from the Cancelled state, so calling it again after the safety
// timeout already ended the action would emit a duplicate faro.user.action
// event; `settled` is the idempotency guard for both.
export async function withFaroUserAction<T>(
  name: string,
  attributes: Record<string, unknown>,
  work: () => Promise<T> | T,
  timeoutMs = USER_ACTION_TIMEOUT_MS
): Promise<T> {
  // Reaching an interactive funnel is engagement by definition: complete an
  // armed init before deciding to pass through, so the first action in a
  // fresh tab is captured rather than run outside an action envelope. Only
  // awaited pre-init — once initialized the action must start synchronously.
  if (!faroInstance) {
    await notifyFaroEngagement().catch(() => undefined);
  }
  let action: StampableUserAction | undefined;
  guardTelemetry(() => {
    if (faroInstance && faroInstance.api.getActiveUserAction() === undefined) {
      action = faroInstance.api.startUserAction(name, stringifyAttributes(attributes)) as
        StampableUserAction | undefined;
    }
  });
  if (!action) {
    return work();
  }
  const started = action;
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const finish = (outcome: 'ok' | 'error' | 'timeout') => {
    if (settled) {
      return;
    }
    settled = true;
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    guardTelemetry(() => {
      started.attributes = { ...started.attributes, outcome };
      started.end();
    });
  };
  timer = setTimeout(() => finish('timeout'), timeoutMs);
  try {
    const result = await work();
    finish('ok');
    return result;
  } catch (error) {
    finish('error');
    throw error;
  }
}

export function setFaroUserActionAttributes(attributes: Record<string, unknown>): void {
  guardTelemetry(() => {
    const action = faroInstance?.api.getActiveUserAction() as StampableUserAction | undefined;
    if (action) {
      action.attributes = { ...action.attributes, ...stringifyAttributes(attributes) };
    }
  });
}

export function setFaroView(url: string): void {
  guardTelemetry(() => {
    if (!url || !faroInstance) {
      return;
    }
    const { hostname, pathname } = new URL(url, window.location.origin);
    faroInstance.api.setView({ name: `${hostname}${pathname}` });
  });
}

export function pauseFaroBeforeReload(): void {
  guardTelemetry(() => {
    faroInstance?.pause();
  });
}
