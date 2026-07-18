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
