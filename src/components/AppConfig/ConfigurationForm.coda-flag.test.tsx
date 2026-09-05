/**
 * The `pathfinder.coda-terminal` flag is display-only on this page: it must show
 * the toggle as on without ever writing that value into jsonData, so turning the
 * flag off restores whatever the stack itself had set.
 *
 * A real render + submit, deliberately: `settings-preservation.test.ts` asserts
 * hand-written jsonData literals, so a regression in this form's own save path
 * stays green there.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AppPluginMeta, PluginConfigPageProps } from '@grafana/data';
import { config } from '@grafana/runtime';

import ConfigurationForm from './ConfigurationForm';
import { testIds } from '../../constants/testIds';
import type { DocsPluginConfig } from '../../constants';
import { fetchPluginJsonData, updatePluginSettings } from '../../utils/utils.plugin';
import { isCodaTerminalForcedByFlag } from '../../utils/coda-enablement';

jest.mock('../../utils/utils.plugin', () => ({
  fetchPluginJsonData: jest.fn(),
  updatePluginSettings: jest.fn(),
}));

jest.mock('../../utils/coda-enablement', () => ({
  isCodaTerminalForcedByFlag: jest.fn(),
}));

// The readiness probe is CodaBackendStatus's own concern, covered by its suite.
jest.mock('./CodaBackendStatus', () => ({
  CodaBackendStatus: ({ enabled }: { enabled: boolean }) => (
    <div data-testid="coda-backend-status">{String(enabled)}</div>
  ),
}));

const mockedFetchPluginJsonData = fetchPluginJsonData as jest.MockedFunction<typeof fetchPluginJsonData>;
const mockedUpdatePluginSettings = updatePluginSettings as jest.MockedFunction<typeof updatePluginSettings>;
const mockedIsCodaTerminalForcedByFlag = isCodaTerminalForcedByFlag as jest.MockedFunction<
  typeof isCodaTerminalForcedByFlag
>;

const USER_ID = 7;

// The dev-mode allowlist is keyed on the boot user, which the test env leaves unset.
beforeAll(() => {
  config.bootData.user = { ...config.bootData.user, id: USER_ID };
});

function renderForm(jsonData: DocsPluginConfig) {
  const props = {
    plugin: { meta: { id: 'grafana-grafanadocsplugin-app', enabled: true, pinned: true, jsonData } },
  } as unknown as PluginConfigPageProps<AppPluginMeta<DocsPluginConfig>>;

  return render(
    <MemoryRouter>
      <ConfigurationForm {...props} />
    </MemoryRouter>
  );
}

function savedJsonData(): DocsPluginConfig {
  const call = mockedUpdatePluginSettings.mock.calls[0];
  if (!call) {
    throw new Error('updatePluginSettings was never called');
  }
  return call[1].jsonData as DocsPluginConfig;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedUpdatePluginSettings.mockResolvedValue(undefined);
});

describe('Coda terminal section, forced by the feature flag', () => {
  const noDevMode: DocsPluginConfig = { devMode: false, devModeUserIds: [], enableCodaTerminal: false };

  beforeEach(() => {
    mockedIsCodaTerminalForcedByFlag.mockReturnValue(true);
    mockedFetchPluginJsonData.mockResolvedValue(noDevMode);
  });

  it('shows the section with no dev mode, toggled on and not editable', async () => {
    renderForm(noDevMode);

    const toggle = await screen.findByTestId(testIds.appConfig.codaTerminalToggle);
    expect(toggle).toBeChecked();
    expect(toggle).toBeDisabled();
    expect(screen.getByText(/turned on by the pathfinder\.coda-terminal feature flag/i)).toBeInTheDocument();
  });

  it('probes readiness, so an operator can see whether Coda actually works', async () => {
    renderForm(noDevMode);

    expect(await screen.findByTestId('coda-backend-status')).toHaveTextContent('true');
  });

  it('never persists the forced value', async () => {
    renderForm(noDevMode);
    await screen.findByTestId(testIds.appConfig.codaTerminalToggle);

    fireEvent.click(screen.getByTestId(testIds.appConfig.submit));

    await waitFor(() => expect(mockedUpdatePluginSettings).toHaveBeenCalledTimes(1));
    expect(savedJsonData().enableCodaTerminal).toBe(false);
  });

  it('leaves an explicit opt-in alone rather than flattening it', async () => {
    const optedIn: DocsPluginConfig = { ...noDevMode, enableCodaTerminal: true };
    mockedFetchPluginJsonData.mockResolvedValue(optedIn);
    renderForm(optedIn);
    await screen.findByTestId(testIds.appConfig.codaTerminalToggle);

    fireEvent.click(screen.getByTestId(testIds.appConfig.submit));

    await waitFor(() => expect(mockedUpdatePluginSettings).toHaveBeenCalledTimes(1));
    expect(savedJsonData().enableCodaTerminal).toBe(true);
  });
});

describe('Coda terminal section, without the feature flag', () => {
  beforeEach(() => {
    mockedIsCodaTerminalForcedByFlag.mockReturnValue(false);
  });

  it('is hidden when dev mode is off', async () => {
    mockedFetchPluginJsonData.mockResolvedValue({ devMode: false, devModeUserIds: [] });
    renderForm({ devMode: false, devModeUserIds: [] });

    await waitFor(() => expect(mockedFetchPluginJsonData).toHaveBeenCalled());
    expect(screen.queryByTestId(testIds.appConfig.codaTerminalToggle)).not.toBeInTheDocument();
  });

  it('stays editable in dev mode', async () => {
    const devMode: DocsPluginConfig = { devMode: true, devModeUserIds: [USER_ID], enableCodaTerminal: false };
    mockedFetchPluginJsonData.mockResolvedValue(devMode);
    renderForm(devMode);

    const toggle = await screen.findByTestId(testIds.appConfig.codaTerminalToggle);
    expect(toggle).not.toBeChecked();
    expect(toggle).toBeEnabled();

    fireEvent.click(toggle);
    fireEvent.click(screen.getByTestId(testIds.appConfig.submit));

    await waitFor(() => expect(mockedUpdatePluginSettings).toHaveBeenCalledTimes(1));
    expect(savedJsonData().enableCodaTerminal).toBe(true);
  });
});
