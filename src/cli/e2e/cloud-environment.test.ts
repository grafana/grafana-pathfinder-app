/**
 * Tests for the per-chain cloud service-account lifecycle. global.fetch is
 * mocked so these exercise the provision/teardown/sweep orchestration and error
 * handling without real network or a Grafana stack.
 */

import { CloudEnvironment } from './cloud-environment';

const ADMIN_TOKEN = 'glsa_admin';
const CLOUD_URL = 'https://stack.grafana.net/';

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
});

describe('CloudEnvironment.provisionChain', () => {
  it('creates a service account then a token and returns the key', async () => {
    const calls = mockFetch((call) => {
      if (call.method === 'POST' && call.url.endsWith('/api/serviceaccounts')) {
        return { ok: true, json: { id: 42, name: 'pathfinder-e2e-abcd1234' } };
      }
      if (call.method === 'POST' && call.url.includes('/api/serviceaccounts/42/tokens')) {
        return { ok: true, json: { id: 1, key: 'glsa_minted' } };
      }
      return { ok: false, status: 404 };
    });

    const env = new CloudEnvironment(ADMIN_TOKEN, CLOUD_URL, false);
    const token = await env.provisionChain();

    expect(token).toBe('glsa_minted');
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: 'https://stack.grafana.net/api/serviceaccounts',
      body: { name: expect.stringContaining('pathfinder-e2e-'), role: 'Admin' },
    });
    expect(calls[1]).toMatchObject({
      method: 'POST',
      url: 'https://stack.grafana.net/api/serviceaccounts/42/tokens',
      body: { secondsToLive: expect.any(Number) },
    });
  });

  it('throws when service-account creation fails', async () => {
    mockFetch(() => ({ ok: false, status: 401 }));
    const env = new CloudEnvironment(ADMIN_TOKEN, CLOUD_URL, false);

    await expect(env.provisionChain()).rejects.toThrow(/HTTP 401/);
  });
});

describe('CloudEnvironment.teardownChain', () => {
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

    const env = new CloudEnvironment(ADMIN_TOKEN, CLOUD_URL, false);
    await env.provisionChain();
    await env.teardownChain();

    const del = calls.find((c) => c.method === 'DELETE');
    expect(del?.url).toBe('https://stack.grafana.net/api/serviceaccounts/7');
  });

  it('is a no-op when nothing was provisioned', async () => {
    const calls = mockFetch(() => ({ ok: true }));
    const env = new CloudEnvironment(ADMIN_TOKEN, CLOUD_URL, false);

    await env.teardownChain();

    expect(calls).toHaveLength(0);
  });

  it('does not throw when the delete fails (TTL is the safety net)', async () => {
    mockFetch((call) => {
      if (call.method === 'DELETE') {
        return { ok: false, status: 500 };
      }
      if (call.url.includes('/tokens')) {
        return { ok: true, json: { key: 'k' } };
      }
      return { ok: true, json: { id: 9, name: 'pathfinder-e2e-y' } };
    });

    const env = new CloudEnvironment(ADMIN_TOKEN, CLOUD_URL, false);
    await env.provisionChain();

    await expect(env.teardownChain()).resolves.toBeUndefined();
  });
});

describe('CloudEnvironment.sweepOrphans', () => {
  it('deletes only prefix-matching service accounts', async () => {
    const calls = mockFetch((call) => {
      if (call.method === 'GET') {
        return {
          ok: true,
          json: {
            serviceAccounts: [
              { id: 1, name: 'pathfinder-e2e-aaa' },
              { id: 2, name: 'some-other-account' },
              { id: 3, name: 'pathfinder-e2e-bbb' },
            ],
          },
        };
      }
      return { ok: true };
    });

    const env = new CloudEnvironment(ADMIN_TOKEN, CLOUD_URL, false);
    await env.sweepOrphans();

    const deletedIds = calls.filter((c) => c.method === 'DELETE').map((c) => c.url);
    expect(deletedIds).toEqual([
      'https://stack.grafana.net/api/serviceaccounts/1',
      'https://stack.grafana.net/api/serviceaccounts/3',
    ]);
  });

  it('does not throw when the search request fails', async () => {
    mockFetch(() => ({ ok: false, status: 403 }));
    const env = new CloudEnvironment(ADMIN_TOKEN, CLOUD_URL, false);

    await expect(env.sweepOrphans()).resolves.toBeUndefined();
  });
});
