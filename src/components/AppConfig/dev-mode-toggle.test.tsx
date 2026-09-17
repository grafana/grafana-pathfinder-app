/**
 * The dev-mode toggle has to leave the page in a state where `isDevModeEnabled`
 * is actually true.
 *
 * Dev mode is two gates — the tenant `devMode` flag and this browser's opt-in —
 * and for a while the toggle wrote only the second. Both defaults are false, so
 * on any stack that had never had dev mode the switch flipped, saved, reloaded,
 * and came back off with no error. Nothing in the type system or in a
 * per-function test catches "wrote one of the two things it had to write", so
 * these assert the pair.
 */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { AppPluginMeta, PluginConfigPageProps } from '@grafana/data';

import ConfigurationForm from './ConfigurationForm';
import { saveTenantSettings } from './save-settings';
import { isDevModeEnabled, toggleDevMode } from '../../utils/dev-mode';
import { usePathfinderPluginConfig } from '../../hooks';
import { getConfigWithDefaults, PathfinderPluginConfig } from '../../constants';
import { testIds } from '../../constants/testIds';

jest.mock('./save-settings', () => ({ saveTenantSettings: jest.fn() }));

jest.mock('../../utils/dev-mode', () => ({
  ...jest.requireActual('../../utils/dev-mode'),
  toggleDevMode: jest.fn(),
}));

jest.mock('../../hooks', () => ({
  usePathfinderPluginConfig: jest.fn(),
}));

const mockSave = saveTenantSettings as jest.MockedFunction<typeof saveTenantSettings>;
const mockToggle = toggleDevMode as jest.MockedFunction<typeof toggleDevMode>;
const mockConfig = usePathfinderPluginConfig as jest.MockedFunction<typeof usePathfinderPluginConfig>;

const PLUGIN_ID = 'grafana-pathfinder-app';

function renderForm(stored: PathfinderPluginConfig) {
  mockConfig.mockReturnValue({ config: getConfigWithDefaults(stored), isResolved: true });

  const plugin = { meta: { id: PLUGIN_ID, jsonData: {} } } as unknown as PluginConfigPageProps<
    AppPluginMeta<PathfinderPluginConfig>
  >['plugin'];

  return render(<ConfigurationForm plugin={plugin} query={{}} />);
}

/**
 * Settle the handler's awaits without advancing to the 500ms reload it schedules
 * on success — jsdom cannot navigate, and `location.reload` is not redefinable.
 */
async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeAll(() => {
  // The dev fieldset is behind `?dev=true`.
  window.history.replaceState({}, '', '?dev=true');
});

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.spyOn(window, 'alert').mockImplementation(() => undefined);
  mockSave.mockResolvedValue(undefined);
  mockToggle.mockResolvedValue(true);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('dev-mode toggle', () => {
  it('lifts the tenant gate as well as the browser opt-in on a stack that has never had dev mode', async () => {
    renderForm({});

    fireEvent.click(screen.getByTestId(testIds.appConfig.devModeToggle));

    await settle();

    expect(mockToggle).toHaveBeenCalledWith(false);
    expect(mockSave).toHaveBeenCalledWith({ pluginId: PLUGIN_ID, changes: { devMode: true } });

    // The state the two writes leave behind is the thing that actually matters.
    expect(isDevModeEnabled({ devMode: true, devModeOptIn: true })).toBe(true);
  });

  it('does not rewrite the tenant gate when the stack already has it on', async () => {
    // An org-wide write for a preference that is now per-browser is exactly what
    // unpinned the plugin (`aa1c2efd`); make it only happen when it has to.
    renderForm({ devMode: true });

    fireEvent.click(screen.getByTestId(testIds.appConfig.devModeToggle));

    await settle();

    expect(mockToggle).toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('leaves the stack gate alone when a user turns their own dev mode off', async () => {
    // Revoking the gate here would pull dev mode out from under every other user
    // on the stack.
    renderForm({ devMode: true, devModeOptIn: true });

    fireEvent.click(screen.getByTestId(testIds.appConfig.devModeToggle));

    await settle();

    expect(mockToggle).toHaveBeenCalledWith(true);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('gives an admin a way to close developer surfaces stack-wide', async () => {
    // The switch above can only ever lift the gate, so without this the
    // documented instance-level veto does not exist.
    renderForm({ devMode: true, devModeOptIn: true });

    fireEvent.click(screen.getByTestId(testIds.appConfig.tenantDevModeToggle));

    await settle();

    expect(mockSave).toHaveBeenCalledWith({ pluginId: PLUGIN_ID, changes: { devMode: false } });
    expect(isDevModeEnabled({ devMode: false, devModeOptIn: true })).toBe(false);
  });
});

describe('configuration form seeding', () => {
  it('renders the value stored in the settings resource, not the plugin jsonData snapshot', () => {
    // On Cloud a save never touches `jsonData`, so a form seeded from it shows
    // the pre-migration value and then writes it back over the resource.
    renderForm({ devMode: true, devModeOptIn: true, tutorialUrl: 'https://stored.example.com' });

    expect(screen.getByTestId(testIds.appConfig.tutorialUrl)).toHaveValue('https://stored.example.com');
  });
});
