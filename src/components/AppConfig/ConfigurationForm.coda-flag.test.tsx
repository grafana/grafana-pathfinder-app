/**
 * The `pathfinder.coda-terminal` flag is display-only on this page: it must show
 * the toggle as on without ever writing that value into tenant settings, so
 * turning the flag off restores whatever the stack itself had set.
 *
 * A real render + submit, deliberately: `settings-preservation.test.ts` asserts
 * the writer in isolation, so a regression in this form's own save path stays
 * green there.
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AppPluginMeta, PluginConfigPageProps } from '@grafana/data';

import ConfigurationForm from './ConfigurationForm';
import { saveTenantSettings } from './save-settings';
import { usePathfinderPluginConfig } from '../../hooks';
import { getConfigWithDefaults, PathfinderPluginConfig } from '../../constants';
import { testIds } from '../../constants/testIds';
import { isCodaTerminalForcedByFlag } from '../../utils/coda-enablement';

jest.mock('./save-settings', () => ({ saveTenantSettings: jest.fn() }));

jest.mock('../../hooks', () => ({
  usePathfinderPluginConfig: jest.fn(),
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

const mockSave = saveTenantSettings as jest.MockedFunction<typeof saveTenantSettings>;
const mockConfig = usePathfinderPluginConfig as jest.MockedFunction<typeof usePathfinderPluginConfig>;
const mockedIsCodaTerminalForcedByFlag = isCodaTerminalForcedByFlag as jest.MockedFunction<
  typeof isCodaTerminalForcedByFlag
>;

const PLUGIN_ID = 'grafana-pathfinder-app';

function renderForm(stored: PathfinderPluginConfig) {
  mockConfig.mockReturnValue({ config: getConfigWithDefaults(stored), isResolved: true });

  const props = {
    plugin: { meta: { id: PLUGIN_ID, jsonData: {} } },
    query: {},
  } as unknown as PluginConfigPageProps<AppPluginMeta<PathfinderPluginConfig>>;

  return render(
    <MemoryRouter>
      <ConfigurationForm {...props} />
    </MemoryRouter>
  );
}

/** The tenant changes this form's submit actually wrote. */
function savedChanges(): Partial<PathfinderPluginConfig> {
  const call = mockSave.mock.calls[0];
  if (!call) {
    throw new Error('saveTenantSettings was never called');
  }
  return call[0].changes;
}

/**
 * Settle the handler's awaits without advancing to the reload it schedules on
 * success — jsdom cannot navigate, and `location.reload` is not redefinable.
 */
async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSave.mockResolvedValue(undefined);
});

describe('Coda terminal section, forced by the feature flag', () => {
  const noDevMode: PathfinderPluginConfig = { devMode: false, devModeOptIn: false, enableCodaTerminal: false };

  beforeEach(() => {
    mockedIsCodaTerminalForcedByFlag.mockReturnValue(true);
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
    await settle();

    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
    expect(savedChanges().enableCodaTerminal).toBe(false);
  });

  it('leaves an explicit opt-in alone rather than flattening it', async () => {
    renderForm({ ...noDevMode, enableCodaTerminal: true });
    await screen.findByTestId(testIds.appConfig.codaTerminalToggle);

    fireEvent.click(screen.getByTestId(testIds.appConfig.submit));
    await settle();

    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
    expect(savedChanges().enableCodaTerminal).toBe(true);
  });
});

describe('Coda terminal section, without the feature flag', () => {
  beforeEach(() => {
    mockedIsCodaTerminalForcedByFlag.mockReturnValue(false);
  });

  it('is hidden when dev mode is off', () => {
    renderForm({ devMode: false, devModeOptIn: false });

    expect(screen.queryByTestId(testIds.appConfig.codaTerminalToggle)).not.toBeInTheDocument();
  });

  it('stays editable in dev mode', async () => {
    renderForm({ devMode: true, devModeOptIn: true, enableCodaTerminal: false });

    const toggle = await screen.findByTestId(testIds.appConfig.codaTerminalToggle);
    expect(toggle).not.toBeChecked();
    expect(toggle).toBeEnabled();

    fireEvent.click(toggle);
    fireEvent.click(screen.getByTestId(testIds.appConfig.submit));
    await settle();

    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
    expect(savedChanges().enableCodaTerminal).toBe(true);
  });
});
