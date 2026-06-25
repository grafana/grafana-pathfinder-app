/**
 * Tests for the CLI-local recommender resolver. `fetch` is mocked URL-by-URL so
 * these exercise the real resolution + manifest-fetch + error-mapping logic
 * that `e2e-package.test.ts` mocks away.
 */

import { resolvePackageById } from './recommender-resolver';

interface RouteResponse {
  ok: boolean;
  status?: number;
  body?: string;
}

/** Route `fetch` by URL substring; unmatched URLs 404. */
function mockFetch(handler: (url: string) => RouteResponse): void {
  global.fetch = jest.fn(async (input: unknown) => {
    const r = handler(String(input));
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 500),
      statusText: r.ok ? 'OK' : 'Error',
      json: async () => JSON.parse(r.body ?? '{}'),
      text: async () => r.body ?? '',
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

afterEach(() => jest.restoreAllMocks());

describe('resolvePackageById', () => {
  it('resolves a package and parses its manifest', async () => {
    mockFetch((url) => {
      if (url.includes('/api/v1/packages/alerting-101')) {
        return {
          ok: true,
          body: JSON.stringify({
            id: 'alerting-101',
            contentUrl: 'https://cdn.test/alerting-101/content.json',
            manifestUrl: 'https://cdn.test/alerting-101/manifest.json',
          }),
        };
      }
      if (url.endsWith('manifest.json')) {
        return {
          ok: true,
          body: JSON.stringify({ id: 'alerting-101', type: 'guide', testEnvironment: { tier: 'local' } }),
        };
      }
      return { ok: false, status: 404 };
    });

    const res = await resolvePackageById('https://recommender.test', 'alerting-101');

    expect(res).toMatchObject({
      ok: true,
      id: 'alerting-101',
      contentUrl: 'https://cdn.test/alerting-101/content.json',
    });
    expect(res.ok && res.manifest?.type).toBe('guide');
    expect(res.ok && res.manifest?.testEnvironment?.tier).toBe('local');
  });

  it('maps a 404 from the resolver to a failure', async () => {
    mockFetch(() => ({ ok: false, status: 404 }));

    const res = await resolvePackageById('https://recommender.test', 'missing');

    expect(res.ok).toBe(false);
    expect(res).toMatchObject({ ok: false, message: expect.stringContaining('404') });
  });

  it('maps a network error to a failure', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;

    const res = await resolvePackageById('https://recommender.test', 'x');

    expect(res).toMatchObject({ ok: false, message: 'offline' });
  });

  it('resolves without a manifest when the manifest fetch fails (non-fatal)', async () => {
    mockFetch((url) => {
      if (url.includes('/api/v1/packages/')) {
        return {
          ok: true,
          body: JSON.stringify({
            id: 'g',
            contentUrl: 'https://cdn.test/g/content.json',
            manifestUrl: 'https://cdn.test/g/manifest.json',
          }),
        };
      }
      return { ok: false, status: 500 }; // manifest fetch fails
    });

    const res = await resolvePackageById('https://recommender.test', 'g');

    expect(res).toMatchObject({ ok: true, id: 'g', contentUrl: 'https://cdn.test/g/content.json' });
    expect(res.ok && res.manifest).toBeUndefined();
  });

  it('resolves without a manifest when the package declares no manifestUrl', async () => {
    mockFetch(() => ({
      ok: true,
      body: JSON.stringify({ id: 'g', contentUrl: 'https://cdn.test/g/content.json', manifestUrl: '' }),
    }));

    const res = await resolvePackageById('https://recommender.test', 'g');

    expect(res).toMatchObject({ ok: true, id: 'g' });
    expect(res.ok && res.manifest).toBeUndefined();
  });

  it('fails on a 200 with a missing contentUrl', async () => {
    mockFetch(() => ({ ok: true, body: JSON.stringify({ id: 'g' }) }));

    const res = await resolvePackageById('https://recommender.test', 'g');

    expect(res.ok).toBe(false);
  });

  it('fails when contentUrl is not an http(s) URL', async () => {
    mockFetch(() => ({ ok: true, body: JSON.stringify({ id: 'g', contentUrl: 'file:///etc/passwd' }) }));

    const res = await resolvePackageById('https://recommender.test', 'g');

    expect(res.ok).toBe(false);
  });

  it('preserves a path prefix on the resolver URL', async () => {
    const calls: string[] = [];
    global.fetch = jest.fn(async (input: unknown) => {
      calls.push(String(input));
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ id: 'alerting-101', contentUrl: 'https://cdn.test/c.json', manifestUrl: '' }),
        text: async () => '',
      } as unknown as Response;
    }) as unknown as typeof fetch;

    await resolvePackageById('https://host/api-prefix', 'alerting-101');

    expect(calls[0]).toBe('https://host/api-prefix/api/v1/packages/alerting-101');
  });

  it('does not fetch a manifest at a non-http URL', async () => {
    const calls: string[] = [];
    global.fetch = jest.fn(async (input: unknown) => {
      calls.push(String(input));
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          id: 'g',
          contentUrl: 'https://cdn.test/g/content.json',
          manifestUrl: 'file:///etc/passwd',
        }),
        text: async () => '',
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const res = await resolvePackageById('https://recommender.test', 'g');

    expect(res).toMatchObject({ ok: true, id: 'g' });
    expect(res.ok && res.manifest).toBeUndefined();
    // The file: manifest URL must never be requested.
    expect(calls.some((u) => u.startsWith('file:'))).toBe(false);
  });
});
