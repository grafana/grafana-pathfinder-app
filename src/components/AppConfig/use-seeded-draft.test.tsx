import React from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AppPluginMeta, PluginConfigPageProps } from '@grafana/data';
import { getConfigWithDefaults, type PathfinderPluginConfig, type ResolvedPathfinderConfig } from '../../constants';
import { usePathfinderPluginConfig } from '../../hooks';
import { testIds } from '../../constants/testIds';
import { useSeededDraft } from './use-seeded-draft';
import { saveTenantSettings } from './save-settings';
import ConfigurationForm from './ConfigurationForm';
import InteractiveFeatures from './InteractiveFeatures';
import TermsAndConditions from './TermsAndConditions';

jest.mock('../../hooks', () => ({ usePathfinderPluginConfig: jest.fn() }));
jest.mock('./save-settings', () => ({ saveTenantSettings: jest.fn() }));
jest.mock('./CodaBackendStatus', () => ({ CodaBackendStatus: () => null }));
const mockConfig = jest.mocked(usePathfinderPluginConfig);
const build = (config: ResolvedPathfinderConfig) => ({
  tutorialUrl: config.tutorialUrl,
  peerjsHost: config.peerjsHost,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockConfig.mockReturnValue({ config: getConfigWithDefaults({}), isResolved: false });
});

it('keeps an early edit and hydrates untouched fields when the authoritative read arrives', () => {
  const { result, rerender } = renderHook(() => useSeededDraft(build));
  act(() => result.current.edit({ tutorialUrl: 'edited' }));
  mockConfig.mockReturnValue({
    config: getConfigWithDefaults({ tutorialUrl: 'stored', peerjsHost: 'new-host' }),
    isResolved: true,
  });
  rerender();
  expect(result.current.draft).toEqual({ tutorialUrl: 'edited', peerjsHost: 'new-host' });
  expect(result.current.changes).toEqual({ tutorialUrl: 'edited' });
});

it('submits only the edited field while the initial authoritative read is pending', async () => {
  const props = {
    plugin: { meta: { id: 'grafana-pathfinder-app', jsonData: {} } },
    query: {},
  } as unknown as PluginConfigPageProps<AppPluginMeta<PathfinderPluginConfig>>;
  jest.mocked(saveTenantSettings).mockImplementation(() => new Promise(() => {}));
  render(
    <MemoryRouter>
      <ConfigurationForm {...props} />
    </MemoryRouter>
  );
  fireEvent.change(screen.getByTestId(testIds.appConfig.tutorialUrl), {
    target: { value: 'https://grafana.com/docs/' },
  });
  fireEvent.submit(screen.getByTestId(testIds.appConfig.form));
  expect(saveTenantSettings).toHaveBeenCalledWith({
    pluginId: 'grafana-pathfinder-app',
    changes: { tutorialUrl: 'https://grafana.com/docs/' },
  });
});

it.each([
  ['configuration', ConfigurationForm],
  ['interactive features', InteractiveFeatures],
  ['terms', TermsAndConditions],
] as const)('keeps the %s draft and permits another save after an error', async (_name, Form) => {
  const props = {
    plugin: { meta: { id: 'grafana-pathfinder-app', jsonData: {} } },
    query: {},
  } as unknown as PluginConfigPageProps<AppPluginMeta<PathfinderPluginConfig>>;
  const save = jest.mocked(saveTenantSettings);
  save.mockRejectedValueOnce({ status: 503 }).mockImplementationOnce(() => new Promise(() => {}));
  const { container } = render(
    <MemoryRouter>
      <Form {...props} />
    </MemoryRouter>
  );
  const input = container.querySelector('input')!;
  if (input.type === 'checkbox') {
    fireEvent.click(input);
  } else {
    fireEvent.change(input, { target: { value: input.type === 'number' ? '5000' : 'https://grafana.com/docs/' } });
  }
  const editedValue = input.value;
  const editedChecked = input.checked;
  fireEvent.submit(container.querySelector('form')!);
  expect(await screen.findByText('Could not save settings')).toBeInTheDocument();
  expect(input.value).toBe(editedValue);
  expect(input.checked).toBe(editedChecked);
  expect(save).toHaveBeenCalledTimes(1);
  fireEvent.submit(container.querySelector('form')!);
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save.mock.calls[1]).toEqual(save.mock.calls[0]);
  expect(screen.queryByText('Could not save settings')).not.toBeInTheDocument();
});
