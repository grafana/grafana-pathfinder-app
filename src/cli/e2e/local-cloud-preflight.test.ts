import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { preflightLocalCloudGuides } from './local-cloud-preflight';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => body,
  } as Response;
}

describe('local cloud preflight', () => {
  let packageDir: string;
  let fetchSpy: jest.Mock;
  let originalFetch: typeof fetch | undefined;

  beforeEach(() => {
    packageDir = mkdtempSync(join(tmpdir(), 'pathfinder-local-cloud-preflight-'));
    mkdirSync(join(packageDir, 'guide'));
    writeFileSync(
      join(packageDir, 'guide', 'manifest.json'),
      JSON.stringify({ id: 'local-guide', type: 'guide', testEnvironment: { tier: 'cloud', plugins: ['plugin-a'] } })
    );
    originalFetch = global.fetch;
    fetchSpy = jest.fn().mockResolvedValue(jsonResponse({ database: 'ok', version: '12.0.0' }));
    Object.defineProperty(global, 'fetch', { configurable: true, value: fetchSpy });
  });

  afterEach(() => {
    if (originalFetch) {
      Object.defineProperty(global, 'fetch', { configurable: true, value: originalFetch });
    } else {
      delete (global as Partial<typeof global>).fetch;
    }
    rmSync(packageDir, { recursive: true, force: true });
  });

  it('checks the actual provisioned target and sends only its runner token to plugin preflight', async () => {
    const pluginResponse = jsonResponse([{ id: 'plugin-a', enabled: true }]);
    fetchSpy.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input.toString());
      if (url.pathname === '/api/plugins') {
        const headers = init?.headers as Record<string, string> | undefined;
        return headers?.Authorization === 'Bearer synthetic-runner-token' ? pluginResponse : jsonResponse([], 401);
      }
      return jsonResponse({ database: 'ok', version: '12.0.0' });
    });

    await preflightLocalCloudGuides([
      {
        id: 'local-guide',
        sourcePath: join(packageDir, 'guide', 'content.json'),
        targetUrl: 'https://leased-stack.example/',
        token: 'synthetic-runner-token',
      },
    ]);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const healthRequest = fetchSpy.mock.calls[0]!;
    const pluginRequest = fetchSpy.mock.calls[1]!;
    expect(new URL(healthRequest[0].toString()).origin).toBe('https://leased-stack.example');
    expect(new URL(pluginRequest[0].toString()).origin).toBe('https://leased-stack.example');
    expect((healthRequest[1] as RequestInit).headers).not.toHaveProperty('Authorization');
    expect((pluginRequest[1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer synthetic-runner-token' });
    expect((pluginRequest[1] as RequestInit).redirect).toBe('error');
  });

  it('uses the authenticated frontend version instead of a conflicting health version', async () => {
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) =>
      new URL(input.toString()).pathname === '/api/health'
        ? jsonResponse({ database: 'ok', version: '10.0.0' })
        : jsonResponse({ buildInfo: { version: '13.3.0-35886682902' } })
    );
    writeFileSync(
      join(packageDir, 'guide', 'manifest.json'),
      JSON.stringify({
        id: 'local-guide',
        type: 'guide',
        testEnvironment: { tier: 'cloud', minVersion: '12.2.0' },
      })
    );

    await preflightLocalCloudGuides([
      {
        id: 'local-guide',
        sourcePath: join(packageDir, 'guide', 'content.json'),
        targetUrl: 'https://leased-stack.example/',
        token: 'synthetic-runner-token',
      },
    ]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(new URL(fetchSpy.mock.calls[1]![0].toString()).toString()).toBe(
      'https://leased-stack.example/api/frontend/settings'
    );
    expect(fetchSpy.mock.calls[1]![1]).toMatchObject({
      headers: { Authorization: 'Bearer synthetic-runner-token' },
      redirect: 'error',
    });
    expect((fetchSpy.mock.calls[0]![1] as RequestInit).headers).not.toHaveProperty('Authorization');
  });

  it('fails when the authenticated frontend version is below the minimum', async () => {
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) =>
      new URL(input.toString()).pathname === '/api/health'
        ? jsonResponse({ database: 'ok' })
        : jsonResponse({ buildInfo: { version: '10.0.0' } })
    );
    writeFileSync(
      join(packageDir, 'guide', 'manifest.json'),
      JSON.stringify({
        id: 'local-guide',
        type: 'guide',
        testEnvironment: { tier: 'cloud', minVersion: '11.0.0' },
      })
    );
    await expect(
      preflightLocalCloudGuides([
        {
          id: 'local-guide',
          sourcePath: join(packageDir, 'guide', 'content.json'),
          targetUrl: 'https://leased-stack.example/',
          token: 'synthetic-runner-token',
        },
      ])
    ).rejects.toThrow('Grafana 10.0.0 is below the required minimum 11.0.0');
  });

  it('rejects preflight when the target token is missing', async () => {
    await expect(
      preflightLocalCloudGuides([
        {
          id: 'local-guide',
          sourcePath: join(packageDir, 'guide', 'content.json'),
          targetUrl: 'https://target.example/',
        },
      ])
    ).rejects.toThrow('Cloud target credential is unavailable');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
