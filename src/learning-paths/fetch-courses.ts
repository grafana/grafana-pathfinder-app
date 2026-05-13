/**
 * Fetch course definitions from the interactive-learning CDN.
 *
 * Fetches `${baseUrl}/courses/${platform}.json` with timeout, validates
 * the response with Zod, and returns null on any failure so callers can
 * fall back to bundled data.
 */

import { DEFAULT_CONTENT_FETCH_TIMEOUT, getCoursesCdnBaseUrl } from '../constants';
import { CoursesPlatformIndexSchema, type InferredCoursesPlatformIndex } from '../types/courses.schema';

export type CoursesPlatform = 'oss' | 'cloud';

let inFlight: Partial<Record<CoursesPlatform, Promise<InferredCoursesPlatformIndex | null>>> = {};

/**
 * Fetch the platform index for the given platform.
 *
 * Concurrent calls for the same platform share a single in-flight request so
 * multiple hook mounts in a single page load don't trigger duplicate fetches.
 *
 * **Per-caller signal semantics**: the shared in-flight fetch is intentionally
 * NOT bound to any single caller's `signal`. Each caller's `signal` only
 * controls when *that caller* stops waiting and resolves to `null`; it never
 * cancels the underlying request that other concurrent callers are still
 * waiting on. (Earlier versions piped the first caller's signal straight into
 * `fetch()`, which (a) silently ignored every subsequent caller's signal on a
 * cache hit and (b) made the first caller's abort cancel everyone.)
 */
export function fetchCourses(
  platform: CoursesPlatform,
  signal?: AbortSignal
): Promise<InferredCoursesPlatformIndex | null> {
  if (signal?.aborted) {
    return Promise.resolve(null);
  }

  let shared = inFlight[platform];
  if (!shared) {
    shared = doFetchCourses(platform).finally(() => {
      // Guard against `resetFetchCoursesCache()` (or a parallel future
      // request) replacing the entry while this one was in flight.
      if (inFlight[platform] === shared) {
        inFlight[platform] = undefined;
      }
    });
    inFlight[platform] = shared;
  }

  return wrapWithCallerSignal(shared, signal);
}

/**
 * Wrap a shared promise with a per-caller `AbortSignal` so the caller can
 * give up waiting without cancelling the underlying work. Resolves to `null`
 * if the caller aborts before the shared promise settles.
 */
function wrapWithCallerSignal<T>(promise: Promise<T | null>, signal: AbortSignal | undefined): Promise<T | null> {
  if (!signal) {
    return promise;
  }
  return new Promise((resolve) => {
    const onAbort = () => resolve(null);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      () => {
        signal.removeEventListener('abort', onAbort);
        resolve(null);
      }
    );
  });
}

/** For tests: reset the in-flight promise cache between scenarios. */
export function resetFetchCoursesCache(): void {
  inFlight = {};
}

async function doFetchCourses(platform: CoursesPlatform): Promise<InferredCoursesPlatformIndex | null> {
  const url = new URL(`/courses/${platform}.json`, getCoursesCdnBaseUrl());

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), DEFAULT_CONTENT_FETCH_TIMEOUT);

  try {
    const response = await fetch(url.toString(), { signal: timeoutController.signal });
    if (!response.ok) {
      console.warn(`[fetchCourses] Failed to fetch (${response.status}): ${url.toString()}`);
      return null;
    }

    const raw: unknown = await response.json();
    const parsed = CoursesPlatformIndexSchema.safeParse(raw);
    if (!parsed.success) {
      console.warn(`[fetchCourses] Schema validation failed for ${url.toString()}:`, parsed.error.issues);
      return null;
    }

    if (parsed.data.platform !== platform) {
      console.warn(`[fetchCourses] Platform mismatch: requested ${platform}, got ${parsed.data.platform}`);
      return null;
    }

    return parsed.data;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return null;
    }
    console.warn(`[fetchCourses] Failed to fetch courses from ${url.toString()}:`, error);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}
