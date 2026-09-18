import { getFeatureFlagValue } from './openfeature';
import { CODA_TERMINAL_FLAG, isCodaTerminalEnabled, resetCodaTerminalFlagCache } from './coda-enablement';
import type { DocsPluginConfig } from '../constants';

jest.mock('./openfeature', () => ({
  getFeatureFlagValue: jest.fn(),
}));

jest.mock('@grafana/runtime', () => ({
  config: { bootData: { user: { id: 7 } } },
}));

const mockedGetFeatureFlagValue = getFeatureFlagValue as jest.MockedFunction<typeof getFeatureFlagValue>;

const USER_ID = 7;

function pluginConfig(overrides: DocsPluginConfig = {}): DocsPluginConfig {
  return { devMode: false, devModeUserIds: [], enableCodaTerminal: false, ...overrides };
}

const devModeOn = { devMode: true, devModeUserIds: [USER_ID] };

beforeEach(() => {
  jest.clearAllMocks();
  resetCodaTerminalFlagCache();
  mockedGetFeatureFlagValue.mockReturnValue(false);
});

describe('isCodaTerminalEnabled', () => {
  it('is off when nothing enables it', () => {
    expect(isCodaTerminalEnabled(pluginConfig(), USER_ID)).toBe(false);
  });

  it('is on from the flag alone, with no dev mode and no jsonData toggle', () => {
    mockedGetFeatureFlagValue.mockReturnValue(true);

    expect(isCodaTerminalEnabled(pluginConfig(), USER_ID)).toBe(true);
    expect(mockedGetFeatureFlagValue).toHaveBeenCalledWith(CODA_TERMINAL_FLAG, false);
  });

  it('is on from dev mode plus the jsonData toggle', () => {
    expect(isCodaTerminalEnabled(pluginConfig({ ...devModeOn, enableCodaTerminal: true }), USER_ID)).toBe(true);
  });

  // The gate that used to disagree: blocks read `configured` while TerminalPanel
  // never mounted, dead-ending the learner on "not available here".
  it('is off for the jsonData toggle without dev mode', () => {
    expect(isCodaTerminalEnabled(pluginConfig({ enableCodaTerminal: true }), USER_ID)).toBe(false);
  });

  it('is off for dev mode without the jsonData toggle', () => {
    expect(isCodaTerminalEnabled(pluginConfig(devModeOn), USER_ID)).toBe(false);
  });

  it('is off for a user outside the dev-mode allowlist', () => {
    const config = pluginConfig({ devMode: true, devModeUserIds: [99], enableCodaTerminal: true });

    expect(isCodaTerminalEnabled(config, USER_ID)).toBe(false);
  });

  it('reads the flag once per page load, however many callers ask', () => {
    mockedGetFeatureFlagValue.mockReturnValue(true);

    isCodaTerminalEnabled(pluginConfig(), USER_ID);
    isCodaTerminalEnabled(pluginConfig(), USER_ID);
    isCodaTerminalEnabled(pluginConfig(), USER_ID);

    expect(mockedGetFeatureFlagValue).toHaveBeenCalledTimes(1);
  });

  it('falls back to the current user when no id is passed', () => {
    expect(isCodaTerminalEnabled(pluginConfig({ ...devModeOn, enableCodaTerminal: true }))).toBe(true);
  });
});
