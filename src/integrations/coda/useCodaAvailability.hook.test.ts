/**
 * `caller.canCreateSessions` lets the sandbox be gated before a session request
 * is spent learning the answer. The states that matter are the two that are not
 * a verdict: `checking` while the probe runs, and `unknown` for a Coda plugin
 * that predates the field. Both must attempt the call and keep handling the
 * `403`, never guess — guessing either way hides the sandbox from someone
 * entitled to it, or offers it to someone who cannot have it.
 */

import { renderHook, waitFor } from '@testing-library/react';
import { isAppPluginEnabled } from '@grafana/runtime';

import { getCapabilities, type CodaCapabilities } from './coda-api';
import { resetCodaAvailabilityCache, useCodaSessionEligibility } from './useCodaAvailability.hook';

jest.mock('@grafana/runtime', () => ({
  isAppPluginEnabled: jest.fn(),
}));

jest.mock('./coda-api', () => ({
  ...jest.requireActual('./coda-api'),
  getCapabilities: jest.fn(),
}));

const mockedIsAppPluginEnabled = isAppPluginEnabled as jest.MockedFunction<typeof isAppPluginEnabled>;
const mockedGetCapabilities = getCapabilities as jest.MockedFunction<typeof getCapabilities>;

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

beforeEach(() => {
  jest.clearAllMocks();
  resetCodaAvailabilityCache();
  mockedIsAppPluginEnabled.mockResolvedValue(true);
});

describe('useCodaSessionEligibility', () => {
  it('starts at checking so first paint never renders a guess', () => {
    mockedGetCapabilities.mockResolvedValue(capabilities());
    const { result } = renderHook(() => useCodaSessionEligibility());
    expect(result.current).toEqual({ state: 'checking' });
  });

  it('reports the role floor for the message when the caller is below it', async () => {
    mockedGetCapabilities.mockResolvedValue(
      capabilities({ caller: { canCreateSessions: false, minimumSessionRole: 'Admin' } })
    );
    const { result } = renderHook(() => useCodaSessionEligibility());

    await waitFor(() => expect(result.current).toEqual({ state: 'role_forbidden', minimumSessionRole: 'Admin' }));
  });

  it('reports eligible when the backend says the caller may create sessions', async () => {
    mockedGetCapabilities.mockResolvedValue(
      capabilities({ caller: { canCreateSessions: true, minimumSessionRole: 'Editor' } })
    );
    const { result } = renderHook(() => useCodaSessionEligibility());

    await waitFor(() => expect(result.current).toEqual({ state: 'eligible' }));
  });

  it('reports unknown against a Coda plugin that does not send caller', async () => {
    mockedGetCapabilities.mockResolvedValue(capabilities());
    const { result } = renderHook(() => useCodaSessionEligibility());

    await waitFor(() => expect(result.current).toEqual({ state: 'unknown' }));
  });

  it('reports unknown when capabilities cannot be read at all', async () => {
    mockedGetCapabilities.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useCodaSessionEligibility());

    await waitFor(() => expect(result.current).toEqual({ state: 'unknown' }));
  });

  it('does not ask the Coda plugin for capabilities when it is not installed', async () => {
    mockedIsAppPluginEnabled.mockResolvedValue(false);
    const { result } = renderHook(() => useCodaSessionEligibility());

    await waitFor(() => expect(result.current).toEqual({ state: 'unknown' }));
    expect(mockedGetCapabilities).not.toHaveBeenCalled();
  });

  it('costs one request per page load however many blocks ask', async () => {
    mockedGetCapabilities.mockResolvedValue(capabilities());
    const first = renderHook(() => useCodaSessionEligibility());
    const second = renderHook(() => useCodaSessionEligibility());

    await waitFor(() => expect(first.result.current).toEqual({ state: 'unknown' }));
    await waitFor(() => expect(second.result.current).toEqual({ state: 'unknown' }));
    expect(mockedGetCapabilities).toHaveBeenCalledTimes(1);
  });
});
