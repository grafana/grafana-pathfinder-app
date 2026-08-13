/**
 * This adapter is now a thin wrapper around `@grafana/coda-client`'s
 * `CodaClient` — request classification, `isCodaUsable`, `codaSessionEligibility`
 * and friends are plain re-exports and covered by the package's own test suite.
 * These tests cover only what's Pathfinder-local: the `execInSession` request
 * re-join, `isRoleForbidden`, and the two URL builders the package has no
 * equivalent for.
 */

import { of } from 'rxjs';
import { getBackendSrv } from '@grafana/runtime';
import { CodaError } from '@grafana/coda-client';

import { alloyScenariosUrl, execInSession, isRoleForbidden, sampleAppsUrl } from './coda-api';

jest.mock('@grafana/runtime', () => ({
  getBackendSrv: jest.fn(),
}));

const mockedGetBackendSrv = getBackendSrv as jest.MockedFunction<typeof getBackendSrv>;

function mockFetch(response: unknown = { data: {} }): jest.Mock {
  const fetch = jest.fn(() => of(response));
  mockedGetBackendSrv.mockReturnValue({ fetch } as unknown as ReturnType<typeof getBackendSrv>);
  return fetch;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('execInSession', () => {
  it('re-joins the command with the rest of the options for CodaClient.exec', async () => {
    const fetch = mockFetch();
    await execInSession('s_1', { command: 'true', readyFile: '/tmp/ready', timeoutMs: 5000 });

    const [request] = fetch.mock.calls[0]!;
    expect(request).toMatchObject({
      url: expect.stringContaining('/sessions/s_1/exec'),
      data: { command: 'true', readyFile: '/tmp/ready', timeoutMs: 5000 },
    });
  });
});

describe('isRoleForbidden', () => {
  it('reads the role_forbidden code', () => {
    expect(isRoleForbidden(new CodaError('nope', 'role_forbidden', 403))).toBe(true);
  });

  it('is false for any other code', () => {
    expect(isRoleForbidden(new CodaError('nope', 'internal', 500))).toBe(false);
  });
});

describe('URL builders', () => {
  it('builds sampleAppsUrl and alloyScenariosUrl off the v1 resource base', () => {
    expect(sampleAppsUrl()).toBe('/api/plugins/grafana-coda-app/resources/v1/sample-apps');
    expect(alloyScenariosUrl()).toBe('/api/plugins/grafana-coda-app/resources/v1/alloy-scenarios');
  });
});
