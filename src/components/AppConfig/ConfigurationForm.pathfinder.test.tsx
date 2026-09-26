import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AppPluginMeta, PluginConfigPageProps } from '@grafana/data';
import { getConfigWithDefaults, type PathfinderPluginConfig } from '../../constants';
import { usePathfinderPluginConfig } from '../../hooks';
import { getFeatureFlagValue } from '../../utils/openfeature';
import { saveTenantSettings } from './save-settings';
import ConfigurationForm from './ConfigurationForm';

jest.mock('../../hooks', () => ({ usePathfinderPluginConfig: jest.fn() }));
jest.mock('../../utils/openfeature', () => ({ getFeatureFlagValue: jest.fn() }));
jest.mock('./save-settings', () => ({ saveTenantSettings: jest.fn() }));
jest.mock('./CodaBackendStatus', () => ({ CodaBackendStatus: () => null }));

function renderForm(pathfinderEnabled?: boolean) {
  jest.mocked(usePathfinderPluginConfig).mockReturnValue({
    config: getConfigWithDefaults({ pathfinderEnabled }),
    isResolved: true,
  });
  const props = {
    plugin: { meta: { id: 'grafana-pathfinder-app', jsonData: {} } },
    query: {},
  } as unknown as PluginConfigPageProps<AppPluginMeta<PathfinderPluginConfig>>;
  return render(
    <MemoryRouter>
      <ConfigurationForm {...props} />
    </MemoryRouter>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  jest.mocked(getFeatureFlagValue).mockImplementation((_name, fallback) => fallback);
  jest.mocked(saveTenantSettings).mockResolvedValue(undefined);
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

it('defaults to enabled and submits only an explicit opt-out', async () => {
  const { container } = renderForm();
  const toggle = screen.getByRole('switch', { name: /^Enable Pathfinder/ });
  expect(toggle).toBeChecked();
  fireEvent.click(toggle);
  await act(async () => fireEvent.submit(container.querySelector('form')!));
  expect(saveTenantSettings).toHaveBeenCalledWith({
    pluginId: 'grafana-pathfinder-app',
    changes: { pathfinderEnabled: false },
  });
});

it.each([true, false])(
  'displays saved preference %s during a remote disable without persisting the flag',
  async (stored) => {
    jest.mocked(getFeatureFlagValue).mockReturnValue(false);
    const { container } = renderForm(stored);
    expect(screen.getByRole('switch', { name: /^Enable Pathfinder/ })).toHaveProperty('checked', stored);
    expect(screen.getByText('Pathfinder is disabled remotely')).toBeInTheDocument();
    await act(async () => fireEvent.submit(container.querySelector('form')!));
    expect(saveTenantSettings).toHaveBeenCalledWith({ pluginId: 'grafana-pathfinder-app', changes: {} });
  }
);

it('allows an opted-out admin to re-enable Pathfinder', async () => {
  const { container } = renderForm(false);
  fireEvent.click(screen.getByRole('switch', { name: /^Enable Pathfinder/ }));
  await act(async () => fireEvent.submit(container.querySelector('form')!));
  expect(saveTenantSettings).toHaveBeenCalledWith({
    pluginId: 'grafana-pathfinder-app',
    changes: { pathfinderEnabled: true },
  });
});

it('keeps a rejected opt-out editable without scheduling a reload', async () => {
  jest.mocked(saveTenantSettings).mockRejectedValue(new Error('conflict'));
  const { container } = renderForm(true);
  fireEvent.click(screen.getByRole('switch', { name: /^Enable Pathfinder/ }));
  const schedule = jest.spyOn(globalThis, 'setTimeout');
  await act(async () => fireEvent.submit(container.querySelector('form')!));
  expect(screen.getByText('Could not save settings')).toBeInTheDocument();
  expect(screen.getByRole('switch', { name: /^Enable Pathfinder/ })).not.toBeChecked();
  expect(schedule.mock.calls.some(([, delay]) => delay === 100)).toBe(false);
  schedule.mockRestore();
});
