/**
 * Marks a URL as belonging to one PR-tester fetch.
 *
 * The marker rides in the URL fragment, so `fetch` never sends it while every
 * URL-keyed progress store separates per fetch, and the same predicate lets
 * slug- and identity-keyed writers (badges, learning progress, durable
 * completion records) recognise a PR test and stay out of real records.
 */

const MARKER_PREFIX = '#pf-pr-';
const MARKER_PATTERN = /#pf-pr-([a-z0-9]+)$/;

export function createPrTestFetchId(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 36 ** 3).toString(36)}`;
}

export function stripPrTestMarker(url: string): string {
  return url.replace(MARKER_PATTERN, '');
}

export function withPrTestMarker(url: string, fetchId: string): string {
  return `${stripPrTestMarker(url)}${MARKER_PREFIX}${fetchId}`;
}

export function getPrTestFetchId(url: string | undefined): string | undefined {
  return url?.match(MARKER_PATTERN)?.[1];
}

export function isPrTestUrl(url: string | undefined): boolean {
  return getPrTestFetchId(url) !== undefined;
}
