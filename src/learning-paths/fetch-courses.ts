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
 * Fetch the platform index for the given platform. Concurrent calls for the
 * same platform share a single in-flight request so multiple hook mounts in
 * a single page load don't trigger duplicate fetches.
 */
export function fetchCourses(
  platform: CoursesPlatform,
  signal?: AbortSignal
): Promise<InferredCoursesPlatformIndex | null> {
  if (signal?.aborted) {
    return Promise.resolve(null);
  }

  const cached = inFlight[platform];
  if (cached) {
    return withCallerAbort(cached, signal);
  }

  const promise = doFetchCourses(platform).finally(() => {
    inFlight[platform] = undefined;
  });
  inFlight[platform] = promise;
  return withCallerAbort(promise, signal);
}

/** For tests: reset the in-flight promise cache between scenarios. */
export function resetFetchCoursesCache(): void {
  inFlight = {};
}

function withCallerAbort(
  promise: Promise<InferredCoursesPlatformIndex | null>,
  signal?: AbortSignal
): Promise<InferredCoursesPlatformIndex | null> {
  if (!signal) {
    return promise;
  }
  if (signal.aborted) {
    return Promise.resolve(null);
  }
  const callerSignal = signal;

  return new Promise((resolve, reject) => {
    let settled = false;

    function cleanup() {
      callerSignal.removeEventListener('abort', onAbort);
    }

    function onAbort() {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(null);
    }

    callerSignal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve(value);
      },
      (error) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(error);
      }
    );
  });
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
