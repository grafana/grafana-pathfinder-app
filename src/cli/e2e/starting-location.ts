export function resolveStartingUrl(targetUrl: string, startingLocation: string): string {
  const target = new URL(targetUrl);
  const resolved = new URL(startingLocation || '/', target);
  if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
    throw new Error(`Guide starting location protocol must be HTTP or HTTPS, received ${resolved.protocol}`);
  }
  if (resolved.origin !== target.origin) {
    throw new Error(`Guide starting location must use the same origin as ${target.origin}`);
  }
  return resolved.toString();
}

export function resolveStartingPath(targetUrl: string, startingLocation: string | undefined): string {
  const resolved = new URL(resolveStartingUrl(targetUrl, startingLocation ?? '/'));
  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}
