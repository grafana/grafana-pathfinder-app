/**
 * Tests for the per-chain cloud service-account lifecycle. global.fetch is
 * mocked so these exercise the provision/teardown/sweep orchestration and error
 * handling without real network or a Grafana stack.
 */

import { SharedCloudStackEnvironment } from './shared-cloud-stack-environment';

const ADMIN_TOKEN = 'glsa_admin';
const CLOUD_URL = 'https://stack.grafana.net/';
const NOW_SECONDS = 2_000_000;

interface FetchCall {
  url: string;
  method: string;
  body: unknown;
}

/** Capture fetch calls and drive responses with a per-call handler. */
function mockFetch(handler: (call: FetchCall) => { ok: boolean; status?: number; json?: unknown }): FetchCall[] {
  const calls: FetchCall[] = [];
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    const call: FetchCall = {
      url: String(url),
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const res = handler(call);
    return {
      ok: res.ok,
      status: res.status ?? (res.ok ? 200 : 500),
      statusText: res.ok ? 'OK' : 'Error',
      text: async () => (res.json === undefined ? '' : JSON.stringify(res.json)),
    } as Response;
  }) as unknown as typeof fetch;
  return calls;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(NOW_SECONDS * 1000);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('SharedCloudStackEnvironment.provisionChain', () => {
  it('creates a service account then a token and returns a provisioned target', async () => {
    const calls = mockFetch((call) => {
      if (call.method === 'POST' && call.url.endsWith('/api/serviceaccounts')) {
        return { ok: true, json: { id: 42, name: 'pathfinder-e2e-abcd1234' } };
      }
      if (call.method === 'POST' && call.url.includes('/api/serviceaccounts/42/tokens')) {
        return { ok: true, json: { id: 1, key: 'glsa_minted' } };
      }
      return { ok: false, status: 404 };
    });

    const env = new SharedCloudStackEnvironment(ADMIN_TOKEN, CLOUD_URL, false);
    const target = await env.provisionChain();

    expect(target).toEqual({ kind: 'shared', targetUrl: CLOUD_URL, token: 'glsa_minted' });
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: 'https://stack.grafana.net/api/serviceaccounts',
      body: { name: expect.stringMatching(/^pathfinder-e2e-\d+-[a-f0-9]{8}-[a-f0-9]{8}$/), role: 'Admin' },
    });
    expect(calls[1]).toMatchObject({
      method: 'POST',
      url: 'https://stack.grafana.net/api/serviceaccounts/42/tokens',
      body: { secondsToLive: expect.any(Number) },
    });
  });

  it('throws when service-account creation fails', async () => {
    mockFetch(() => ({ ok: false, status: 401 }));
    const env = new SharedCloudStackEnvironment(ADMIN_TOKEN, CLOUD_URL, false);

    await expect(env.provisionChain()).rejects.toThrow(/HTTP 401/);
  });
});

describe('SharedCloudStackEnvironment.teardownChain', () => {
  it('deletes the provisioned service account by id', async () => {
    const calls = mockFetch((call) => {
      if (call.url.endsWith('/api/serviceaccounts')) {
        return { ok: true, json: { id: 7, name: 'pathfinder-e2e-x' } };
      }
      if (call.url.includes('/tokens')) {
        return { ok: true, json: { key: 'k' } };
      }
      return { ok: true };
    });

    const env = new SharedCloudStackEnvironment(ADMIN_TOKEN, CLOUD_URL, false);
    await env.provisionChain();
    await expect(env.teardownChain()).resolves.toEqual([]);

    const del = calls.find((c) => c.method === 'DELETE');
    expect(del?.url).toBe('https://stack.grafana.net/api/serviceaccounts/7');
  });

  it('is a no-op when nothing was provisioned', async () => {
    const calls = mockFetch(() => ({ ok: true }));
    const env = new SharedCloudStackEnvironment(ADMIN_TOKEN, CLOUD_URL, false);
    await expect(env.teardownChain()).resolves.toEqual([]);

    expect(calls).toHaveLength(0);
  });

  it('does not throw when the delete fails (TTL is the safety net)', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockFetch((call) => {
      if (call.method === 'DELETE') {
        return { ok: false, status: 500 };
      }
      if (call.url.includes('/tokens')) {
        return { ok: true, json: { key: 'k' } };
      }
      return { ok: true, json: { id: 9, name: 'pathfinder-e2e-y' } };
    });

    const env = new SharedCloudStackEnvironment(ADMIN_TOKEN, CLOUD_URL, false);
    await env.provisionChain();
    await expect(env.teardownChain()).resolves.toEqual([
      'Failed to delete service account id 9 (it will expire via TTL): DELETE /api/serviceaccounts/9 failed: HTTP 500 Error',
    ]);
  });
});

describe('SharedCloudStackEnvironment.sweepOrphans', () => {
  it('deletes only stale provisioned service accounts', async () => {
    const staleTimestamp = NOW_SECONDS - 3901;
    const freshTimestamp = NOW_SECONDS - 60;
    const calls = mockFetch((call) => {
      if (call.method === 'GET') {
        return {
          ok: true,
          json: {
            serviceAccounts: [
              { id: 1, name: `pathfinder-e2e-${staleTimestamp}-aaaaaaaa-bbbbbbbb` },
              { id: 2, name: 'some-other-account' },
              { id: 3, name: `pathfinder-e2e-${freshTimestamp}-cccccccc-dddddddd` },
              { id: 4, name: 'pathfinder-e2e-legacy' },
            ],
          },
        };
      }
      return { ok: true };
    });

    const env = new SharedCloudStackEnvironment(ADMIN_TOKEN, CLOUD_URL, false);
    await env.sweepOrphans();

    const deletedIds = calls.filter((c) => c.method === 'DELETE').map((c) => c.url);
    expect(deletedIds).toEqual(['https://stack.grafana.net/api/serviceaccounts/1']);
  });

  it('does not throw when the search request fails', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockFetch(() => ({ ok: false, status: 403 }));
    const env = new SharedCloudStackEnvironment(ADMIN_TOKEN, CLOUD_URL, false);

    await expect(env.sweepOrphans()).resolves.toBeUndefined();
  });
});
