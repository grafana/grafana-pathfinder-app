import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { config } from '@grafana/runtime';
import { OrganizationGuideSettings } from './OrganizationGuideSettings';
import { currentPlatform } from '../../lib/platform';
import { usePathfinderPluginConfig } from '../../hooks';
import { getConfigWithDefaults } from '../../constants';
import { fetchBackendGuides } from '../../utils/fetchBackendGuides';
import { loadMyCompletions } from '../../completion-records/completion-read-client';
import { resolveOrganizationGuide } from '../../integrations/organization-guide/resolve';
import { saveTenantSettings } from '../AppConfig/save-settings';
import { fetchPathfinderSettingsSnapshot } from '../../utils/pathfinder-settings-api';

jest.mock('../../hooks', () => ({ usePathfinderPluginConfig: jest.fn(), publishPathfinderPluginConfig: jest.fn() }));
jest.mock('../../lib/platform', () => ({ currentPlatform: jest.fn(() => 'cloud') }));
jest.mock('../../utils/fetchBackendGuides', () => ({ fetchBackendGuides: jest.fn() }));
jest.mock('../../completion-records/completion-read-client', () => ({ loadMyCompletions: jest.fn() }));
jest.mock('../../integrations/organization-guide/resolve', () => ({ resolveOrganizationGuide: jest.fn() }));
jest.mock('../AppConfig/save-settings', () => ({ saveTenantSettings: jest.fn() }));
jest.mock('../../utils/pathfinder-settings-api', () => ({ fetchPathfinderSettingsSnapshot: jest.fn() }));

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(config, { namespace: 'stack', bootData: { user: { orgRole: 'Admin' } } });
  jest.mocked(currentPlatform).mockReturnValue('cloud');
  jest
    .mocked(usePathfinderPluginConfig)
    .mockReturnValue({ config: getConfigWithDefaults({ organizationGuideId: 'old' }), isResolved: true });
  jest.mocked(fetchBackendGuides).mockResolvedValue([
    { metadata: { name: 'welcome' }, spec: { id: 'different-content-id', title: 'Welcome', status: 'published' } },
    { metadata: { name: 'draft' }, spec: { title: 'Draft', status: 'draft' } },
    { metadata: { name: 'path' }, spec: { title: 'Path', status: 'published', manifest: { type: 'path' } } },
  ]);
  jest
    .mocked(loadMyCompletions)
    .mockResolvedValue({ kind: 'ok', data: { capability: { available: true }, completions: [], inProgress: [] } });
  jest.mocked(resolveOrganizationGuide).mockResolvedValue({ resourceName: 'welcome' } as never);
  jest.mocked(saveTenantSettings).mockResolvedValue(undefined);
  jest
    .mocked(fetchPathfinderSettingsSnapshot)
    .mockResolvedValue({ config: { organizationGuideId: 'welcome' }, spec: {}, resourceVersion: '1' });
});

it('offers published guides, explains existing-user scope, and verifies replacement', async () => {
  render(<OrganizationGuideSettings />);
  await screen.findByRole('option', { name: 'Welcome' });
  expect(screen.queryByRole('option', { name: 'Draft' })).toBeNull();
  expect(screen.queryByRole('option', { name: 'Path' })).toBeNull();
  expect(screen.getByText(/existing users as well as newcomers/)).toBeInTheDocument();
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'welcome' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save organization guide' }));
  await screen.findByText(/Organization guide saved/);
  expect(saveTenantSettings).toHaveBeenCalledWith({
    pluginId: 'grafana-pathfinder-app',
    changes: { organizationGuideId: 'welcome' },
  });
});

it('retains edits after rejection and never announces success', async () => {
  jest.mocked(saveTenantSettings).mockRejectedValue(new Error('conflict'));
  render(<OrganizationGuideSettings />);
  await screen.findByRole('option', { name: 'Welcome' });
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'welcome' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save organization guide' }));
  await screen.findByText(/Could not save the organization guide/);
  expect(screen.getByRole('combobox')).toHaveValue('welcome');
  expect(screen.queryByText(/Organization guide saved/)).toBeNull();
});

it('allows clearing when completion service is unavailable', async () => {
  jest.mocked(loadMyCompletions).mockResolvedValue({ kind: 'unavailable' });
  jest
    .mocked(fetchPathfinderSettingsSnapshot)
    .mockResolvedValue({ config: { organizationGuideId: '' }, spec: {}, resourceVersion: '1' });
  render(<OrganizationGuideSettings />);
  await screen.findByRole('option', { name: 'Welcome' });
  fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save organization guide' }));
  await screen.findByText(/Organization guide saved/);
  expect(resolveOrganizationGuide).not.toHaveBeenCalled();
  expect(saveTenantSettings).toHaveBeenCalledWith(expect.objectContaining({ changes: { organizationGuideId: '' } }));
});

it.each(['oss', 'viewer'])('does not mount privileged reads on %s', async (mode) => {
  if (mode === 'oss') {
    jest.mocked(currentPlatform).mockReturnValue('oss');
  } else {
    Object.assign(config.bootData.user, { orgRole: 'Viewer' });
  }
  await act(async () => {
    render(<OrganizationGuideSettings />);
  });
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(fetchBackendGuides).not.toHaveBeenCalled();
});

it('rechecks publication at save time', async () => {
  jest.mocked(resolveOrganizationGuide).mockResolvedValue(null);
  render(<OrganizationGuideSettings />);
  await screen.findByRole('option', { name: 'Welcome' });
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'welcome' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save organization guide' }));
  await waitFor(() => expect(screen.getByText(/Could not save the organization guide/)).toBeInTheDocument());
  expect(saveTenantSettings).not.toHaveBeenCalled();
});
