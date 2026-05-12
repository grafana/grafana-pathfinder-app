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
  const cached = inFlight[platform];
  if (cached) {
    return cached;
  }

  const promise = doFetchCourses(platform, signal).finally(() => {
    inFlight[platform] = undefined;
  });
  inFlight[platform] = promise;
  return promise;
}

/** For tests: reset the in-flight promise cache between scenarios. */
export function resetFetchCoursesCache(): void {
  inFlight = {};
}

async function doFetchCourses(
  platform: CoursesPlatform,
  externalSignal?: AbortSignal
): Promise<InferredCoursesPlatformIndex | null> {
  const url = new URL(`/courses/${platform}.json`, getCoursesCdnBaseUrl());

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), DEFAULT_CONTENT_FETCH_TIMEOUT);

  const onExternalAbort = () => timeoutController.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timeoutId);
      return null;
    }
    externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

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
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}
