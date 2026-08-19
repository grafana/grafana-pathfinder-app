import type { TestResultsData } from './e2e-reporter';

export function preserveAuthoredStartingLocation<T extends { startingLocation?: string }>(raw: unknown, parsed: T): T {
  if (typeof raw === 'object' && raw !== null && Object.prototype.hasOwnProperty.call(raw, 'startingLocation')) {
    return parsed;
  }

  const preserved = { ...parsed };
  delete preserved.startingLocation;
  return preserved;
}
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

export function finalSuccessfulStartingLocation(
  data: TestResultsData | undefined,
  targetUrl: string
): string | undefined {
  const results = data?.results;
  const finalStep = results?.[results.length - 1];
  if (!finalStep || finalStep.status !== 'passed') {
    return undefined;
  }

  try {
    const target = new URL(targetUrl);
    const current = new URL(finalStep.currentUrl);
    if (
      (target.protocol !== 'http:' && target.protocol !== 'https:') ||
      (current.protocol !== 'http:' && current.protocol !== 'https:') ||
      current.origin !== target.origin
    ) {
      return undefined;
    }
    return `${current.pathname}${current.search}${current.hash}`;
  } catch {
    return undefined;
  }
}

export interface StartingLocationTracker {
  select: (explicitLocation: string | undefined) => string;
  record: (success: boolean, data: TestResultsData | undefined, targetUrl: string) => void;
}

export function createStartingLocationTracker(): StartingLocationTracker {
  let carriedLocation: string | undefined;

  return {
    select(explicitLocation) {
      return explicitLocation ?? carriedLocation ?? '/';
    },
    record(success, data, targetUrl) {
      if (!success) {
        return;
      }
      const finalLocation = finalSuccessfulStartingLocation(data, targetUrl);
      if (finalLocation !== undefined) {
        carriedLocation = finalLocation;
      }
    },
  };
}
