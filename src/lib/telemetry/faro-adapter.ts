import type { Faro, LogLevel, UserActionInternalInterface } from '@grafana/faro-web-sdk';
import { config } from '@grafana/runtime';
import packageJson from '../../../package.json';
import type { UserActionOutcome } from './types';
import {
  buildResourceIgnorePattern,
  filterPathfinderTelemetry,
  LOG_PREFIX,
  passesActivityGate,
  resolveFaroEnvironment,
  EXPLICIT_REPORT_MARKER,
  TRACKED_RESOURCE_HOSTNAMES,
} from './filtering';
import { buildTelemetryIdentity } from './identity';
import { getPathfinderSurface, onPathfinderSurfaceChange } from './surface';
import { stampSessionExperiments } from './session';

const COLLECTOR_URL = 'https://faro-collector-ops-eu-south-0.grafana-ops.net/collect/d6ec87b657b65de6e363de05623d9c57';
const APP_NAME = packageJson.name;
const APP_VERSION = packageJson.version;
const GLOBAL_OBJECT_KEY = 'grafanaPathfinderApp';

let faroInstance: Faro | null = null;
let initStarted = false;

export function guardTelemetry(fn: () => void): void {
  try {
    fn();
  } catch {
    // Telemetry must never break the app it's observing.
  }
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
    ignoreUrls: [buildResourceIgnorePattern(TRACKED_RESOURCE_HOSTNAMES)],
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
          edition: config.buildInfo.edition ?? '',
          language: config.bootData?.user?.language ?? '',
          // Stack hostname (slug.grafana.net on Cloud) so sessions are
          // attributable to an instance; the recommender payload sends the
          // same hostname unhashed as `source`.
          instance: window.location.hostname,
        },
      },
    },
    beforeSend: (item) => (passesActivityGate(item) ? filterPathfinderTelemetry(item) : null),
  });

  void stampFaroUser();
  void stampSessionExperiments();

  const stampSurface = () => setFaroSessionAttributes({ surface: getPathfinderSurface() });
  onPathfinderSurfaceChange(stampSurface);
  stampSurface();
}

async function stampFaroUser(): Promise<void> {
  try {
    const identity = await buildTelemetryIdentity();
    faroInstance?.api.setUser({
      // Same hashes as the recommender payload so sessions stay joinable; no raw PII.
      id: identity.faroUserId,
      attributes: { user_id_hash: identity.userIdHash, org_role: identity.orgRole },
    });
  } catch {
    // Telemetry must never break the app it's observing.
  }
}

export function pushFaroError(error: Error, context?: Record<string, string>): void {
  guardTelemetry(() => {
    faroInstance?.api.pushError(error, { context: { ...context, [EXPLICIT_REPORT_MARKER]: 'true' } });
  });
}

export type FaroLogLevel = 'info' | 'warn' | 'error';

export function pushFaroLog(level: FaroLogLevel, message: string, context?: Record<string, string>): void {
  guardTelemetry(() => {
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

// Merges onto the existing session attributes rather than replacing them —
// setSession() itself replaces the whole meta, so the current session
// (including its id) must be read back first or the SDK would rotate it.
export function setFaroSessionAttributes(attributes: Record<string, unknown>): void {
  guardTelemetry(() => {
    if (!faroInstance) {
      return;
    }
    const session = faroInstance.api.getSession();
    faroInstance.api.setSession({
      ...session,
      attributes: { ...session?.attributes, ...stringifyAttributes(attributes) },
    });
  });
}

let userActionSeq = 0;

// Faro's public startUserAction() return type only exposes `name`/`parentId` —
// ending it requires the internal interface. This isn't a hack: Faro's own
// built-in click instrumentation (UserActionController) does the exact same
// cast internally, since UserActionsAPI has no top-level `endUserAction()`.
export function pushFaroUserAction(name: string, attributes?: Record<string, unknown>): void {
  guardTelemetry(() => {
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

export interface WithFaroUserActionOptions<T = unknown> {
  // `@grafana/faro-web-sdk` only re-exports UserActionImportance as a type,
  // not a value, so the literal is passed straight through to startUserAction.
  critical?: boolean;
  // Maps resolved-but-failed work to its real outcome instead of 'ok'.
  outcomeFrom?: (result: T) => UserActionOutcome;
}

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
  timeoutMs = USER_ACTION_TIMEOUT_MS,
  options?: WithFaroUserActionOptions<T>
): Promise<T> {
  let action: StampableUserAction | undefined;
  guardTelemetry(() => {
    if (faroInstance && faroInstance.api.getActiveUserAction() === undefined) {
      action = faroInstance.api.startUserAction(
        name,
        stringifyAttributes(attributes),
        options?.critical ? { importance: 'critical' } : undefined
      ) as StampableUserAction | undefined;
    }
  });
  if (!action) {
    return work();
  }
  const started = action;
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const finish = (outcome: UserActionOutcome) => {
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
    let outcome: UserActionOutcome = 'ok';
    guardTelemetry(() => {
      outcome = options?.outcomeFrom?.(result) ?? 'ok';
    });
    finish(outcome);
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

// For operational signals (funnel degradations, silent fallbacks) that
// belong in Faro for alerting but are not product analytics — unlike
// reportAppInteraction, nothing here reaches RudderStack. skipDedupe keeps
// repeated identical failures countable.
export function pushFaroEvent(name: string, attributes?: Record<string, unknown>): void {
  guardTelemetry(() => {
    faroInstance?.api.pushEvent(name, attributes ? stringifyAttributes(attributes) : undefined, undefined, {
      skipDedupe: true,
    });
  });
}

// Namespaced type + analogy-legible value names (e.g. `panel_lcp_ms`), never
// Faro's default web-vitals names (`lcp`/`cls`/`inp`/...) — those are scored
// against Google's Core Web Vitals thresholds in the Frontend Observability
// UI, which don't fit panel-scoped measurements and would be misleading.
export function pushFaroMeasurement(
  type: string,
  values: Record<string, number>,
  context?: Record<string, string>
): void {
  guardTelemetry(() => {
    faroInstance?.api.pushMeasurement({ type, values }, context ? { context } : undefined);
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

// For surfaces with no URL to derive a view name from (e.g. the
// recommendations tab) — setFaroView's hostname+pathname derivation doesn't
// apply there, so the view would otherwise stay unset/stale until a doc opens.
export function setFaroViewName(name: string): void {
  guardTelemetry(() => {
    if (name && faroInstance) {
      faroInstance.api.setView({ name });
    }
  });
}

export function pauseFaroBeforeReload(): void {
  guardTelemetry(() => {
    faroInstance?.pause();
  });
}
