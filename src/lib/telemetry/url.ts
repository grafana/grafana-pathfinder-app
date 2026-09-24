import { opaqueGuideReference } from '../guide-diagnostics';
const MAX_TELEMETRY_URL_LENGTH = 200;

// Internal content identifiers, not fetchable URLs — safe and useful as-is.
const INTERNAL_CONTENT_SCHEMES = ['bundled:'];

// Bounded `hostname/path` only — userinfo, query, and fragment can carry
// credentials or high-cardinality state that Faro's truncation won't remove.
export function normalizeTelemetryUrl(url: string): string {
  if (!url) {
    return '';
  }
  if (
    url.startsWith('backend-guide:') ||
    url.startsWith('app-platform:') ||
    url.includes('/interactiveguides/') ||
    url.includes('/api/v1/packages/')
  ) {
    return `private-guide:${opaqueGuideReference(url)}`;
  }
  if (INTERNAL_CONTENT_SCHEMES.some((scheme) => url.startsWith(scheme))) {
    return url.slice(0, MAX_TELEMETRY_URL_LENGTH);
  }
  try {
    const { hostname, pathname } = new URL(url, window.location.origin);
    return `${hostname}${pathname}`.slice(0, MAX_TELEMETRY_URL_LENGTH);
  } catch {
    return 'invalid-url';
  }
}

// Public-dashboard tokens and snapshot keys grant unauthenticated access.
const CAPABILITY_PATH = /^(\/(?:public-dashboards|dashboard\/snapshot)\/)[^/]+/;

function redactCapabilityToken(pathname: string): string {
  return pathname.replace(CAPABILITY_PATH, '$1redacted');
}

// Page metadata and resource timings require full URLs rather than hostname/path labels.
export function stripUrlSecrets(url: string): string {
  if (!url) {
    return '';
  }
  // A fragment-only URL is an in-document reference.
  if (url.startsWith('#')) {
    return url;
  }
  if (url.startsWith('data:')) {
    return 'data:';
  }
  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }
    parsed.search = '';
    parsed.hash = '';
    parsed.username = '';
    parsed.password = '';
    parsed.pathname = redactCapabilityToken(parsed.pathname);
    const isAbsolute = /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//');
    return (isAbsolute ? parsed.href : `${parsed.pathname}`).slice(0, MAX_TELEMETRY_URL_LENGTH);
  } catch {
    return '';
  }
}
