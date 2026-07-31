const MAX_TELEMETRY_URL_LENGTH = 200;

// Internal content identifiers, not fetchable URLs — safe and useful as-is.
const INTERNAL_CONTENT_SCHEMES = ['bundled:', 'backend-guide:'];

// Bounded `hostname/path` only — userinfo, query, and fragment can carry
// credentials or high-cardinality state that Faro's truncation won't remove.
export function normalizeTelemetryUrl(url: string): string {
  if (!url) {
    return '';
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

// Grafana slugifies the dashboard or folder title into the path. Every text
// node in a replay is masked, so leaving the slug in would make the URL the
// one place a title survives — `/d/abc/acme-q3-revenue-confidential` on every
// recording of that board. The uid is kept because it identifies the board
// without describing it.
const TITLE_BEARING_PATH = /^(\/(?:d|d-solo)\/[^/]+|\/dashboards\/f\/[^/]+)\/[^/]+/;

function redactTitleSlug(pathname: string): string {
  return pathname.replace(TITLE_BEARING_PATH, '$1');
}

// Session replay carries URLs its player resolves, so normalizeTelemetryUrl's
// scheme-less `hostname/path` would break every `src`. Same redaction, but the
// URL stays loadable.
export function stripUrlSecrets(url: string): string {
  if (!url) {
    return '';
  }
  // Every Grafana icon is a `<use href="#icon-x">` — here the fragment is the
  // whole reference, not a discardable tail.
  if (url.startsWith('#')) {
    return url;
  }
  if (url.startsWith('data:')) {
    return 'data:';
  }
  try {
    const parsed = new URL(url, window.location.origin);
    // Only schemes a replay player has any reason to resolve. Drops
    // javascript:/vbscript:/blob: and friends, none of which mean anything on
    // playback and all of which are better not round-tripped.
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }
    parsed.search = '';
    parsed.hash = '';
    parsed.username = '';
    parsed.password = '';
    parsed.pathname = redactTitleSlug(parsed.pathname);
    const isAbsolute = /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//');
    return (isAbsolute ? parsed.href : `${parsed.pathname}`).slice(0, MAX_TELEMETRY_URL_LENGTH);
  } catch {
    return '';
  }
}
