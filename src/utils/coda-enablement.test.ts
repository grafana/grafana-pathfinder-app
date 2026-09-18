import { getFeatureFlagValue } from './openfeature';
import { CODA_TERMINAL_FLAG, isCodaTerminalEnabled, resetCodaTerminalFlagCache } from './coda-enablement';
import type { PathfinderPluginConfig } from '../constants';

jest.mock('./openfeature', () => ({
  getFeatureFlagValue: jest.fn(),
}));

jest.mock('@grafana/runtime', () => ({
  config: { bootData: { user: { id: 7 } } },
}));

const mockedGetFeatureFlagValue = getFeatureFlagValue as jest.MockedFunction<typeof getFeatureFlagValue>;

function pluginConfig(overrides: PathfinderPluginConfig = {}): PathfinderPluginConfig {
  return { devMode: false, devModeOptIn: false, enableCodaTerminal: false, ...overrides };
}

const devModeOn = { devMode: true, devModeOptIn: true };

beforeEach(() => {
  jest.clearAllMocks();
  resetCodaTerminalFlagCache();
  mockedGetFeatureFlagValue.mockReturnValue(false);
});

describe('isCodaTerminalEnabled', () => {
  it('is off when nothing enables it', () => {
    expect(isCodaTerminalEnabled(pluginConfig())).toBe(false);
  });

  it('is on from the flag alone, with no dev mode and no tenant toggle', () => {
    mockedGetFeatureFlagValue.mockReturnValue(true);

    expect(isCodaTerminalEnabled(pluginConfig())).toBe(true);
    expect(mockedGetFeatureFlagValue).toHaveBeenCalledWith(CODA_TERMINAL_FLAG, false);
  });

  it('is on from dev mode plus the tenant toggle', () => {
    expect(isCodaTerminalEnabled(pluginConfig({ ...devModeOn, enableCodaTerminal: true }))).toBe(true);
  });

  // The gate that used to disagree: blocks read `configured` while TerminalPanel
  // never mounted, dead-ending the learner on "not available here".
  it('is off for the tenant toggle without dev mode', () => {
    expect(isCodaTerminalEnabled(pluginConfig({ enableCodaTerminal: true }))).toBe(false);
  });

  it('is off for dev mode without the tenant toggle', () => {
    expect(isCodaTerminalEnabled(pluginConfig(devModeOn))).toBe(false);
  });

  it('is off when the tenant gate is closed, however this browser opted in', () => {
    const config = pluginConfig({ devMode: false, devModeOptIn: true, enableCodaTerminal: true });

    expect(isCodaTerminalEnabled(config)).toBe(false);
  });

  it('is off when this browser has not opted in, however the tenant gate stands', () => {
    const config = pluginConfig({ devMode: true, devModeOptIn: false, enableCodaTerminal: true });

    expect(isCodaTerminalEnabled(config)).toBe(false);
  });

  it('reads the flag once per page load, however many callers ask', () => {
    mockedGetFeatureFlagValue.mockReturnValue(true);

    isCodaTerminalEnabled(pluginConfig());
    isCodaTerminalEnabled(pluginConfig());
    isCodaTerminalEnabled(pluginConfig());

    expect(mockedGetFeatureFlagValue).toHaveBeenCalledTimes(1);
  });
});
