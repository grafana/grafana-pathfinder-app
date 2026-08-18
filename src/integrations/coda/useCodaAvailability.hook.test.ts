/**
 * `caller.canCreateSessions` lets the sandbox be gated before a session request
 * is spent learning the answer. The states that matter are the two that are not
 * a verdict: `checking` while the probe runs, and `unknown` for a Coda plugin
 * that predates the field. Both must attempt the call and keep handling the
 * `403`, never guess — guessing either way hides the sandbox from someone
 * entitled to it, or offers it to someone who cannot have it.
 */

import { renderHook, waitFor } from '@testing-library/react';
import { usePluginContext } from '@grafana/data';
import { isAppPluginEnabled, isAppPluginInstalled } from '@grafana/runtime';

import { CODA_PLUGIN_ID, getCapabilities, type CodaCapabilities } from './coda-api';
import {
  isCodaPluginAvailable,
  resetCodaAvailabilityCache,
  useCodaSessionEligibility,
  useCodaTerminalGate,
} from './useCodaAvailability.hook';

jest.mock('@grafana/runtime', () => ({
  isAppPluginEnabled: jest.fn(),
  isAppPluginInstalled: jest.fn(),
  // Silences getConfigWithDefaults' platform-detection warning.
  config: { bootData: { settings: { buildInfo: { versionString: 'Grafana v13.1.0' } } } },
}));

jest.mock('@grafana/data', () => ({
  ...jest.requireActual('@grafana/data'),
  usePluginContext: jest.fn(),
}));

jest.mock('./coda-api', () => ({
  ...jest.requireActual('./coda-api'),
  getCapabilities: jest.fn(),
}));

const mockedIsAppPluginEnabled = isAppPluginEnabled as jest.MockedFunction<typeof isAppPluginEnabled>;
const mockedIsAppPluginInstalled = isAppPluginInstalled as jest.MockedFunction<typeof isAppPluginInstalled>;
const mockedUsePluginContext = usePluginContext as jest.MockedFunction<typeof usePluginContext>;
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
  mockedIsAppPluginInstalled.mockResolvedValue(true);
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

describe('isCodaPluginAvailable', () => {
  it('never asks for the plugin’s settings when boot data says it is not installed', async () => {
    mockedIsAppPluginInstalled.mockResolvedValue(false);

    await expect(isCodaPluginAvailable()).resolves.toBe(false);
    expect(mockedIsAppPluginEnabled).not.toHaveBeenCalled();
  });

  it('still asks whether the plugin is enabled when the installed probe fails', async () => {
    mockedIsAppPluginInstalled.mockRejectedValue(new Error('boom'));

    await expect(isCodaPluginAvailable()).resolves.toBe(true);
    expect(mockedIsAppPluginEnabled).toHaveBeenCalledWith(CODA_PLUGIN_ID);
  });

  // isAppPluginEnabled is served by Grafana core's own @grafana/runtime at
  // runtime, not bundled with this plugin, and is absent on core versions
  // older than ~13.1. Calling it there throws synchronously rather than
  // rejecting, which crashed the whole docs panel on those versions.
  //
  // Its absence must not read as "the plugin is missing" either: the terminal
  // works across the whole grafanaDependency range, so on those versions the
  // provider is asked directly instead.
  function withRuntime<T>(runtime: Record<string, unknown>, read: () => T): T {
    let value!: T;
    // @grafana/runtime is already cached (with isAppPluginEnabled present) from
    // this file's static import above — reset the registry first, or doMock
    // below is silently ignored and the module keeps the wrong mock.
    jest.resetModules();
    jest.isolateModules(() => {
      jest.doMock('@grafana/runtime', () => runtime);
      value = read();
    });
    return value;
  }

  function withoutCoreProbe<T>(read: () => T): T {
    return withRuntime({}, read);
  }

  it('asks whether the plugin is enabled on a core without the installed probe', async () => {
    const enabled = jest.fn().mockResolvedValue(true);
    const result = withRuntime({ isAppPluginEnabled: enabled }, () => {
      const { isCodaPluginAvailable: probe } = require('./useCodaAvailability.hook');
      return probe() as Promise<boolean>;
    });

    await expect(result).resolves.toBe(true);
    expect(enabled).toHaveBeenCalledWith(CODA_PLUGIN_ID);
  });

  it('does not throw when the running Grafana core predates isAppPluginEnabled', async () => {
    const result = withoutCoreProbe(() => {
      jest.doMock('./coda-api', () => ({
        ...jest.requireActual('./coda-api'),
        getCapabilities: jest.fn().mockRejectedValue(new Error('404')),
      }));
      const { isCodaPluginAvailable } = require('./useCodaAvailability.hook');
      return isCodaPluginAvailable() as Promise<boolean>;
    });

    await expect(result).resolves.toBe(false);
  });

  it('falls back to the provider’s own capabilities on a core without the probe', async () => {
    const result = withoutCoreProbe(() => {
      jest.doMock('./coda-api', () => ({
        ...jest.requireActual('./coda-api'),
        getCapabilities: jest.fn().mockResolvedValue(capabilities()),
      }));
      const { isCodaPluginAvailable } = require('./useCodaAvailability.hook');
      return isCodaPluginAvailable() as Promise<boolean>;
    });

    await expect(result).resolves.toBe(true);
  });

  it('spends one capabilities request for both answers on such a core', async () => {
    const { available, calls } = withoutCoreProbe(() => {
      const getCapabilitiesMock = jest.fn().mockResolvedValue(capabilities());
      jest.doMock('./coda-api', () => ({
        ...jest.requireActual('./coda-api'),
        getCapabilities: getCapabilitiesMock,
      }));
      const { isCodaPluginAvailable, loadCodaCapabilities } = require('./useCodaAvailability.hook');
      return {
        available: Promise.all([isCodaPluginAvailable(), loadCodaCapabilities()]),
        calls: getCapabilitiesMock,
      };
    });

    await expect(available).resolves.toEqual([true, capabilities()]);
    expect(calls).toHaveBeenCalledTimes(1);
  });
});

describe('useCodaTerminalGate', () => {
  function withTerminalSetting(enableCodaTerminal: boolean) {
    mockedUsePluginContext.mockReturnValue({ meta: { jsonData: { enableCodaTerminal } } } as never);
  }

  it('asks nothing about Coda when the operator has not enabled the terminal', () => {
    withTerminalSetting(false);
    const { result } = renderHook(() => useCodaTerminalGate());

    expect(result.current).toBe('disabled');
    expect(mockedIsAppPluginInstalled).not.toHaveBeenCalled();
    expect(mockedIsAppPluginEnabled).not.toHaveBeenCalled();
  });

  it('reports plugin-missing without a settings fetch when boot data has no Coda', async () => {
    mockedIsAppPluginInstalled.mockResolvedValue(false);
    withTerminalSetting(true);
    const { result } = renderHook(() => useCodaTerminalGate());

    await waitFor(() => expect(result.current).toBe('plugin-missing'));
    expect(mockedIsAppPluginEnabled).not.toHaveBeenCalled();
  });

  it('reports configured when both operator gates pass', async () => {
    withTerminalSetting(true);
    const { result } = renderHook(() => useCodaTerminalGate());

    await waitFor(() => expect(result.current).toBe('configured'));
  });
});
