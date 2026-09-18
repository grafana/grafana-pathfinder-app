/**
 * This adapter is now a thin wrapper around `@grafana/coda-client`'s
 * `CodaClient` — request classification, `isCodaUsable`, `codaSessionEligibility`
 * and friends are plain re-exports and covered by the package's own test suite.
 * These tests cover only what's Pathfinder-local: the `execInSession` request
 * re-join, `isRoleForbidden`, `isMintForbidden`, the `provisionGcx` wrapper that
 * supplies the shared client, and the error sentences.
 */

import { of } from 'rxjs';
import { getBackendSrv } from '@grafana/runtime';
import { CodaError } from '@grafana/coda-client';

import { codaErrorCodeMessage, execInSession, isMintForbidden, isRoleForbidden, provisionGcx } from './coda-api';

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

describe('provisionGcx', () => {
  it('installs a supplied token without minting', async () => {
    const fetch = mockFetch({
      data: { path: '/home/ubuntu/.config/gcx/config.yaml', contextName: 'coda', server: 'https://g.example.com' },
    });

    const written = await provisionGcx('s_1', { token: 'glsa_supplied' });

    // One call only: a supplied token must not touch /api/serviceaccounts.
    expect(fetch).toHaveBeenCalledTimes(1);
    const [request] = fetch.mock.calls[0]!;
    expect(request).toMatchObject({
      method: 'POST',
      url: expect.stringContaining('/sessions/s_1/credential'),
      data: { token: 'glsa_supplied' },
    });
    expect(written).toEqual({
      path: '/home/ubuntu/.config/gcx/config.yaml',
      contextName: 'coda',
      server: 'https://g.example.com',
    });
  });

  it('percent-encodes the session id into the path', async () => {
    const fetch = mockFetch({ data: { path: '/p', contextName: 'coda', server: 'https://g' } });
    await provisionGcx('s_1/../s_2', { token: 'glsa_x' });

    const [request] = fetch.mock.calls[0]! as [{ url: string }];
    expect(request.url).toContain('s_1%2F..%2Fs_2');
    expect(request.url).not.toContain('s_1/../s_2');
  });
});

describe('isMintForbidden', () => {
  it('reads the client-synthesised mint_forbidden code', () => {
    expect(isMintForbidden(new CodaError('nope', 'mint_forbidden', 403))).toBe(true);
  });

  it('does not confuse it with role_forbidden', () => {
    // Different refusals: one is Grafana declining to mint, the other is the
    // Coda plugin declining the session. They need different guidance.
    expect(isMintForbidden(new CodaError('nope', 'role_forbidden', 403))).toBe(false);
    expect(isRoleForbidden(new CodaError('nope', 'mint_forbidden', 403))).toBe(false);
  });
});

describe('codaErrorCodeMessage for the credential codes', () => {
  it.each([
    ['mint_forbidden', /Paste one instead/],
    ['invalid_token', /usable Grafana service account token/],
    ['credential_write_failed', /could not be written into the sandbox VM/],
  ] as const)('has a sentence for %s', (code, matcher) => {
    expect(codaErrorCodeMessage(code, 'fallback')).toMatch(matcher);
  });

  it('still falls back for a code this build does not know', () => {
    expect(codaErrorCodeMessage('something_new_in_v1', 'the backend sentence')).toBe('the backend sentence');
  });
});
