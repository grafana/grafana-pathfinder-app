import type { APIEvent, EventEvent, ExceptionEvent, LogEvent, TransportItem } from '@grafana/faro-web-sdk';
import { config } from '@grafana/runtime';
import packageJson from '../../../package.json';
import pluginJson from '../../plugin.json';
import {
  ALLOWED_GRAFANA_DOCS_HOSTNAMES,
  ALLOWED_INTERACTIVE_LEARNING_HOSTNAMES,
  ALLOWED_RECOMMENDER_DOMAINS,
} from '../../constants';
import { isPathfinderOpen } from './surface';
import { normalizeTelemetryUrl } from './url';

const APP_NAME = packageJson.name;
const LOCAL_OVERRIDE_KEY = 'pathfinder.faro.local';

export const LOG_PREFIX = '[pathfinder]';

export type FaroEnvironment = 'dev' | 'ops' | 'prod' | 'local';

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

export function resolveFaroEnvironment(): { environment: FaroEnvironment; isLocalOverride: boolean } | null {
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
export const EXPLICIT_REPORT_MARKER = 'pathfinder_reported';

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
export const TRACKED_RESOURCE_HOSTNAMES = new Set([
  ...ALLOWED_GRAFANA_DOCS_HOSTNAMES,
  ...ALLOWED_RECOMMENDER_DOMAINS,
  ...ALLOWED_INTERACTIVE_LEARNING_HOSTNAMES,
]);

// Bare grafana.com is shared with Grafana core (plugin catalog, news feed);
// only the docs/tutorials paths url-validator lets this plugin fetch count.
const SHARED_HOSTNAME = 'grafana.com';
const SHARED_HOSTNAME_PATH_PREFIXES = ['/docs', '/tutorials'];

// Belt-and-braces with isTrackedResourceUrl/filterPathfinderTelemetry below:
// this one runs *inside* PerformanceInstrumentation's PerformanceObserver
// (via Faro's `ignoreUrls` config), before a resource-timing payload is even
// built, so the ~99% of entries that are Grafana core's own requests never
// get constructed at all. It's hostname-only (no path awareness), so the
// `/docs`|`/tutorials` restriction on shared grafana.com still has to live in
// the beforeSend filter below.
export function buildResourceIgnorePattern(hostnames: ReadonlySet<string>): RegExp {
  const escaped = [...hostnames].map((hostname) => hostname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`^(?!https?://(${escaped.join('|')})/)`);
}

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

// DOM/action failure text routinely embeds URLs with query-string secrets
// (tokens, emails) — same leak normalizeTelemetryUrl closes for dedicated
// URL attributes, applied here to any URL substring in free-text content.
// Excludes quote/bracket/paren wrapping characters so an href like
// `a[href="https://...token=x"]` doesn't swallow the closing `"]` into the
// match and silently drop it along with the stripped query string.
const EMBEDDED_URL_PATTERN = /https?:\/\/[^\s"'<>()[\]]+/g;

function redactEmbeddedUrls(text: string): string {
  return text.replace(EMBEDDED_URL_PATTERN, (match) => normalizeTelemetryUrl(match));
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
    const isExplicit = item.payload.context?.[EXPLICIT_REPORT_MARKER] === 'true';
    const frames = item.payload.stacktrace?.frames ?? [];
    if (!isExplicit && !frames.some((frame) => isPathfinderStackFrame(frame.filename))) {
      return null;
    }
    const value = redactEmbeddedUrls(item.payload.value);
    return value === item.payload.value ? item : { ...item, payload: { ...item.payload, value } };
  }
  if (isLogItem(item)) {
    if (!item.payload.message.startsWith(LOG_PREFIX)) {
      return null;
    }
    const message = redactEmbeddedUrls(item.payload.message);
    return message === item.payload.message ? item : { ...item, payload: { ...item.payload, message } };
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

// Latched for the rest of the page load: the sidebar-close mirror fires
// after unmount, when the docked key is already gone.
let pathfinderWasOpen = false;

// Attribution (filterPathfinderTelemetry) asks "is this ours?"; this gate
// asks "is Pathfinder actually in use?". Everything except exceptions and
// error-level logs is dropped until Pathfinder is open in one of its
// surfaces, so collector sessions mean "used Pathfinder or Pathfinder
// errored", not "loaded a Grafana page".
export function passesActivityGate(item: TransportItem<APIEvent>): boolean {
  if (isExceptionItem(item)) {
    return true;
  }
  if (isLogItem(item) && String(item.payload.level) === 'error') {
    return true;
  }
  if (!pathfinderWasOpen && isPathfinderOpen()) {
    pathfinderWasOpen = true;
  }
  return pathfinderWasOpen;
}
