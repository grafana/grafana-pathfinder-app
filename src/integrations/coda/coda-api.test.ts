/**
 * This adapter is now a thin wrapper around `@grafana/coda-client`'s
 * `CodaClient` — request classification, `isCodaUsable`, `codaSessionEligibility`
 * and friends are plain re-exports and covered by the package's own test suite.
 * These tests cover only what's Pathfinder-local: the `execInSession` request
 * re-join, `isRoleForbidden`, and the error sentences.
 */

import { of } from 'rxjs';
import { getBackendSrv } from '@grafana/runtime';
import { CodaError } from '@grafana/coda-client';

import { codaErrorCodeMessage, execInSession, isRoleForbidden, listVMs } from './coda-api';

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

describe('listVMs', () => {
  it('returns the caller VM list from the v1 endpoint', async () => {
    const vms = [
      {
        id: 'vm-1',
        template: 'vm-aws',
        state: 'active',
        owner: 'user-1',
        expiresAt: '2026-09-14T12:00:00Z',
        createdAt: '2026-09-14T11:30:00Z',
      },
    ];
    const fetch = mockFetch({ data: { vms } });

    await expect(listVMs()).resolves.toEqual(vms);
    expect(fetch).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'GET', url: expect.stringMatching(/\/vms$/) })
    );
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

describe('codaErrorCodeMessage for the retired credential codes', () => {
  it.each(['mint_forbidden', 'invalid_token', 'credential_write_failed'] as const)(
    'keeps the backend sentence for %s',
    (code) => {
      expect(codaErrorCodeMessage(code, 'fallback')).toBe('fallback');
    }
  );

  it('still falls back for a code this build does not know', () => {
    expect(codaErrorCodeMessage('something_new_in_v1', 'the backend sentence')).toBe('the backend sentence');
  });
});
