import { of, throwError } from 'rxjs';
import { getBackendSrv } from '@grafana/runtime';

import {
  codaSessionEligibility,
  createSession,
  execInSession,
  getCapabilities,
  isCodaUsable,
  toCodaError,
  sessionChannelAddress,
  type CodaCapabilities,
} from './coda-api';

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

describe('coda-api request options', () => {
  // Issue #1539: the plugin answers 401 `coda_auth_failed` when *its* Coda
  // credential expires, but Grafana's global handler reads any first-attempt
  // 401 on a relative URL as the caller's Grafana session expiring — it pings
  // /api/login/ping and replays the request. `retry: 1` opts out.
  it.each([
    ['createSession', () => createSession()],
    ['execInSession', () => execInSession('s_1', { command: 'true' })],
    ['getCapabilities', () => getCapabilities()],
  ])('%s opts out of Grafana global 401 handling', async (_name, call) => {
    const fetch = mockFetch();
    await call();
    expect(fetch.mock.calls[0]![0]).toMatchObject({ retry: 1, showErrorAlert: false });
  });

  it('still classifies a 401 by the backend code rather than the status', async () => {
    const fetch = jest.fn(() =>
      throwError(() => ({ status: 401, data: { code: 'coda_auth_failed', error: 'token expired' } }))
    );
    mockedGetBackendSrv.mockReturnValue({ fetch } as unknown as ReturnType<typeof getBackendSrv>);

    await expect(getCapabilities()).rejects.toMatchObject({ code: 'coda_auth_failed', status: 401 });
  });
});

describe('toCodaError', () => {
  it('reads a bare 404 as the plugin being absent, since the backend always sends a code', () => {
    expect(toCodaError({ status: 404 })).toMatchObject({ code: 'plugin_not_installed' });
  });
});

function capabilities(overrides: Partial<CodaCapabilities> = {}): CodaCapabilities {
  return {
    registered: true,
    templates: [],
    sampleApps: [],
    alloyScenarios: [],
    limits: { maxVMsPerUser: 3, maxExecTimeoutMs: 120_000, maxOutputBytes: 32_768 },
    ...overrides,
  };
}

describe('isCodaUsable', () => {
  it('refuses a registered backend whose credential has expired', () => {
    expect(isCodaUsable(capabilities({ credential: { state: 'expired' } }))).toBe(false);
  });

  it('refuses a registered backend that reports configuration errors', () => {
    expect(isCodaUsable(capabilities({ configErrors: ['apiUrl is not set'] }))).toBe(false);
  });

  it('accepts absent evidence: unknown and unreachable are not a dead credential', () => {
    expect(isCodaUsable(capabilities({ credential: { state: 'unknown' } }))).toBe(true);
    expect(isCodaUsable(capabilities({ credential: { state: 'unreachable' } }))).toBe(true);
  });

  // Never stricter than reading `registered` was, or upgrading Pathfinder would
  // break a stack running a 1.1.x Coda plugin that cannot answer.
  it('is no stricter than registered on a backend that omits both fields', () => {
    expect(isCodaUsable(capabilities())).toBe(true);
    expect(isCodaUsable(capabilities({ registered: false }))).toBe(false);
  });
});

describe('codaSessionEligibility', () => {
  it('reads an absent caller as unknown rather than guessing either answer', () => {
    expect(codaSessionEligibility(capabilities())).toBe('unknown');
  });

  it('answers before a session request is spent finding out', () => {
    expect(
      codaSessionEligibility(capabilities({ caller: { canCreateSessions: true, minimumSessionRole: 'Editor' } }))
    ).toBe('eligible');
    expect(
      codaSessionEligibility(capabilities({ caller: { canCreateSessions: false, minimumSessionRole: 'Editor' } }))
    ).toBe('role_forbidden');
  });
});

describe('sessionChannelAddress', () => {
  it('keeps slashes in the opaque path so a scenario id survives', () => {
    expect(sessionChannelAddress('plugin/grafana-coda-app/v1/session/s_1')).toMatchObject({
      stream: 'grafana-coda-app',
      path: 'v1/session/s_1',
    });
  });
});
