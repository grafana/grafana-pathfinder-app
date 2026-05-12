/**
 * Tests for fetchCourses
 *
 * Covers the success path plus every failure mode that triggers the bundled
 * fallback (4xx/5xx, network error, malformed JSON, schema violation,
 * platform mismatch, abort).
 */

import { fetchCourses, resetFetchCoursesCache } from './fetch-courses';
import { COURSES_SCHEMA_VERSION } from '../types/courses.schema';

const mockFetch = jest.fn();
global.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockClear();
  resetFetchCoursesCache();
});

function makeValidIndex(platform: 'oss' | 'cloud') {
  return {
    schemaVersion: COURSES_SCHEMA_VERSION,
    platform,
    courses: [
      {
        id: 'getting-started',
        title: 'Getting started',
        description: 'Learn the basics',
        guides: ['first-dashboard'],
        badgeId: 'grafana-fundamentals',
        targetPlatform: platform,
        estimatedMinutes: 10,
        icon: 'grafana',
      },
    ],
    guideMetadata: {
      'first-dashboard': { title: 'First dashboard', estimatedMinutes: 10 },
    },
    badges: [
      {
        id: 'grafana-fundamentals',
        title: 'Grafana Fundamentals',
        description: 'Complete the course',
        icon: 'grafana',
        trigger: { type: 'path-completed', pathId: 'getting-started' },
      },
    ],
  };
}

function mockAbortableDeferredFetch() {
  const controls: { resolveFetch: (value: unknown) => void } = {
    resolveFetch: (_value: unknown) => {
      throw new Error('Fetch was not started');
    },
  };
  mockFetch.mockImplementationOnce(
    (_url: string, init?: RequestInit) =>
      new Promise<unknown>((resolve, reject) => {
        const signal = init?.signal;
        const onAbort = () => {
          signal?.removeEventListener('abort', onAbort);
          reject(new DOMException('Aborted', 'AbortError'));
        };

        if (signal?.aborted) {
          onAbort();
          return;
        }

        signal?.addEventListener('abort', onAbort, { once: true });
        controls.resolveFetch = (value) => {
          signal?.removeEventListener('abort', onAbort);
          resolve({
            ok: true,
            json: async () => value,
          });
        };
      })
  );

  return controls;
}

describe('fetchCourses', () => {
  it('parses a valid OSS index', async () => {
    const body = makeValidIndex('oss');
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => body });

    const result = await fetchCourses('oss');

    expect(result).not.toBeNull();
    expect(result!.platform).toBe('oss');
    expect(result!.courses).toHaveLength(1);
    expect(result!.badges).toHaveLength(1);
  });

  it('parses a valid Cloud index', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => makeValidIndex('cloud') });

    const result = await fetchCourses('cloud');

    expect(result).not.toBeNull();
    expect(result!.platform).toBe('cloud');
  });

  it('targets the correct URL for the platform', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => makeValidIndex('cloud') });

    await fetchCourses('cloud');

    const url: string = mockFetch.mock.calls[0]![0];
    expect(url).toContain('/courses/cloud.json');
    expect(url).toMatch(/^https:\/\/interactive-learning\./);
  });

  it('returns null on 404', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
    expect(await fetchCourses('oss')).toBeNull();
  });

  it('returns null on 500', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    expect(await fetchCourses('oss')).toBeNull();
  });

  it('returns null on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network down'));
    expect(await fetchCourses('oss')).toBeNull();
  });

  it('returns null on malformed JSON (parse throws)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    });
    expect(await fetchCourses('oss')).toBeNull();
  });

  it('returns null on schema violation (missing courses field)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ schemaVersion: COURSES_SCHEMA_VERSION, platform: 'oss', badges: [], guideMetadata: {} }),
    });
    expect(await fetchCourses('oss')).toBeNull();
  });

  it('returns null on schema violation (bad badge trigger)', async () => {
    const bad = makeValidIndex('oss') as unknown as { badges: Array<{ trigger: { type: string } }> };
    bad.badges[0]!.trigger = { type: 'not-a-real-trigger' };
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => bad });
    expect(await fetchCourses('oss')).toBeNull();
  });

  it('returns null when platform field mismatches the request', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => makeValidIndex('cloud') });
    expect(await fetchCourses('oss')).toBeNull();
  });

  it('returns null when the request is aborted before fetch starts', async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await fetchCourses('oss', controller.signal)).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns null when the AbortError surfaces from fetch', async () => {
    mockFetch.mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'));
    expect(await fetchCourses('oss')).toBeNull();
  });

  it('shares one in-flight request for concurrent calls (same platform)', async () => {
    let resolveFetch!: (value: unknown) => void;
    mockFetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFetch = (v) =>
            resolve({
              ok: true,
              json: async () => v,
            });
        })
    );

    const a = fetchCourses('oss');
    const b = fetchCourses('oss');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    resolveFetch(makeValidIndex('oss'));
    const [ra, rb] = await Promise.all([a, b]);

    expect(ra).not.toBeNull();
    expect(rb).not.toBeNull();
    expect(ra).toBe(rb);
  });

  it('lets a later caller abort without cancelling the shared request', async () => {
    const fetchControls = mockAbortableDeferredFetch();

    const first = fetchCourses('oss');
    const controller = new AbortController();
    const second = fetchCourses('oss', controller.signal);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    controller.abort();
    fetchControls.resolveFetch(makeValidIndex('oss'));
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).not.toBeNull();
    expect(secondResult).toBeNull();
  });

  it("does not let the first caller's abort cancel the shared request", async () => {
    const fetchControls = mockAbortableDeferredFetch();

    const controller = new AbortController();
    const first = fetchCourses('oss', controller.signal);
    const second = fetchCourses('oss');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    controller.abort();
    fetchControls.resolveFetch(makeValidIndex('oss'));
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toBeNull();
    expect(secondResult).not.toBeNull();
  });

  it('tolerates additional unknown fields (forward compat via .loose())', async () => {
    const body = { ...makeValidIndex('oss'), futureField: 'whatever' };
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => body });
    const result = await fetchCourses('oss');
    expect(result).not.toBeNull();
  });
});
