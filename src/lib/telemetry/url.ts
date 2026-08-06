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

// The path is kept because a dashboard title is not a secret. These two are:
// the segment after them is the whole credential — anyone holding a
// public-dashboard access token or a snapshot key can open it unauthenticated.
const CAPABILITY_PATH = /^(\/(?:public-dashboards|dashboard\/snapshot)\/)[^/]+/;

function redactCapabilityToken(pathname: string): string {
  return pathname.replace(CAPABILITY_PATH, '$1redacted');
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
    // The path is kept, dashboard title slug included: it is what makes a
    // replay navigable and it is not a secret. Capability tokens in the path
    // are, and the query carries `var-*` filter values, so both of those go.
    parsed.pathname = redactCapabilityToken(parsed.pathname);
    const isAbsolute = /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//');
    return (isAbsolute ? parsed.href : `${parsed.pathname}`).slice(0, MAX_TELEMETRY_URL_LENGTH);
  } catch {
    return '';
  }
}
