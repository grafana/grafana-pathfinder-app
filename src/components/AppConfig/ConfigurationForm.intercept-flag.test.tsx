import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AppPluginMeta, PluginConfigPageProps } from '@grafana/data';

import ConfigurationForm from './ConfigurationForm';
import { saveTenantSettings } from './save-settings';
import { usePathfinderPluginConfig } from '../../hooks';
import { getConfigWithDefaults, PathfinderPluginConfig } from '../../constants';
import { testIds } from '../../constants/testIds';
import { isDocsLinkInterceptionForcedByFlag } from '../../utils/docs-link-interception-enablement';

jest.mock('./save-settings', () => ({ saveTenantSettings: jest.fn() }));

jest.mock('../../hooks', () => ({
  usePathfinderPluginConfig: jest.fn(),
}));

jest.mock('../../utils/docs-link-interception-enablement', () => ({
  isDocsLinkInterceptionForcedByFlag: jest.fn(),
}));

const mockSave = saveTenantSettings as jest.MockedFunction<typeof saveTenantSettings>;
const mockConfig = usePathfinderPluginConfig as jest.MockedFunction<typeof usePathfinderPluginConfig>;
const mockedForcedByFlag = isDocsLinkInterceptionForcedByFlag as jest.MockedFunction<
  typeof isDocsLinkInterceptionForcedByFlag
>;

function renderForm(stored: PathfinderPluginConfig) {
  mockConfig.mockReturnValue({ config: getConfigWithDefaults(stored), isResolved: true });

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

function savedChanges(): Partial<PathfinderPluginConfig> {
  const call = mockSave.mock.calls[0];
  if (!call) {
    throw new Error('saveTenantSettings was never called');
  }
  return call[0].changes;
}

async function submit() {
  fireEvent.click(screen.getByTestId(testIds.appConfig.submit));
  await act(async () => {
    await Promise.resolve();
  });
  await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSave.mockResolvedValue(undefined);
});

describe('Global link interception, forced by the feature flag', () => {
  beforeEach(() => {
    mockedForcedByFlag.mockReturnValue(true);
  });

  it('shows the toggle on and not editable', async () => {
    renderForm({ interceptGlobalDocsLinks: false });

    const toggle = await screen.findByTestId(testIds.appConfig.globalLinkInterception);
    expect(toggle).toBeChecked();
    expect(toggle).toBeDisabled();
    expect(screen.getByText(/turned on by the pathfinder\.intercept-docs-links feature flag/i)).toBeInTheDocument();
    expect(screen.getByText('How it works')).toBeInTheDocument();
  });

  it('never persists the forced value', async () => {
    renderForm({ interceptGlobalDocsLinks: false });
    await screen.findByTestId(testIds.appConfig.globalLinkInterception);

    await submit();

    expect(savedChanges()).not.toHaveProperty('interceptGlobalDocsLinks');
  });
});

describe('Global link interception, without the feature flag', () => {
  beforeEach(() => {
    mockedForcedByFlag.mockReturnValue(false);
  });

  it('stays editable and saves the admin opt-in', async () => {
    renderForm({ interceptGlobalDocsLinks: false });

    const toggle = await screen.findByTestId(testIds.appConfig.globalLinkInterception);
    expect(toggle).not.toBeChecked();
    expect(toggle).toBeEnabled();
    expect(screen.queryByText(/pathfinder\.intercept-docs-links feature flag/i)).not.toBeInTheDocument();

    fireEvent.click(toggle);
    await submit();

    expect(savedChanges().interceptGlobalDocsLinks).toBe(true);
  });
});
