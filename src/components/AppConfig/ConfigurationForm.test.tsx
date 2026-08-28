/**
 * `POST /api/plugins/:id/settings` replaces the whole object, so anything the
 * form does not send is cleared: a body without `pinned` unpins the plugin, one
 * without `enabled` disables it, and one without a provisioned `jsonData` field
 * such as `stackId` drops it. The mount-time read is a seed for the form and
 * goes stale the moment another tab saves, so what matters here is that every
 * write re-reads first.
 */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { AppPluginMeta, PluginConfigPageProps } from '@grafana/data';

import ConfigurationForm from './ConfigurationForm';
import { fetchPluginSettings, updatePluginSettings } from '../../utils/utils.plugin';
import { testIds } from '../../constants/testIds';
import type { DocsPluginConfig } from '../../constants';

jest.mock('../../utils/utils.plugin', () => ({
  ...jest.requireActual('../../utils/utils.plugin'),
  fetchPluginSettings: jest.fn(),
  updatePluginSettings: jest.fn(),
}));

jest.mock('./CodaBackendStatus', () => ({ CodaBackendStatus: () => null }));

jest.mock('@grafana/runtime', () => ({
  ...jest.requireActual('@grafana/runtime'),
  config: { ...jest.requireActual('@grafana/runtime').config, bootData: { user: { id: 7 } } },
}));

/** Dev mode for user 7 is what renders the assistant toggle, the other write path. */
const DEV_MODE_SETTINGS = {
  jsonData: { stackId: '123', devMode: true, devModeUserIds: [7] } as DocsPluginConfig,
  enabled: true,
  pinned: true,
};

const mockedFetch = fetchPluginSettings as jest.MockedFunction<typeof fetchPluginSettings>;
const mockedUpdate = updatePluginSettings as jest.MockedFunction<typeof updatePluginSettings>;

const MOUNT_SETTINGS = { jsonData: { stackId: '123' } as DocsPluginConfig, enabled: true, pinned: true };

function renderForm() {
  const plugin = {
    meta: { id: 'grafana-grafanadocsplugin-app', enabled: false, pinned: false, jsonData: {} },
  } as unknown as PluginConfigPageProps<AppPluginMeta<DocsPluginConfig>>['plugin'];

  return render(<ConfigurationForm plugin={plugin} query={{}} />);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedUpdate.mockResolvedValue({});
});

describe('ConfigurationForm settings writes', () => {
  it('re-reads enabled, pinned and jsonData immediately before saving', async () => {
    mockedFetch.mockResolvedValueOnce(MOUNT_SETTINGS);
    renderForm();
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(1));

    // Another tab saves after this page opened: pinned goes false, and a
    // provisioned field appears. The form owns neither.
    mockedFetch.mockResolvedValueOnce({
      jsonData: { stackId: '123', slug: 'moved' } as DocsPluginConfig,
      enabled: true,
      pinned: false,
    });

    fireEvent.submit(screen.getByTestId(testIds.appConfig.form));

    await waitFor(() => expect(mockedUpdate).toHaveBeenCalled());
    expect(mockedFetch).toHaveBeenCalledTimes(2);
    const [, body] = mockedUpdate.mock.calls[0]!;
    expect(body.enabled).toBe(true);
    expect(body.pinned).toBe(false);
    expect(body.jsonData).toMatchObject({ stackId: '123', slug: 'moved' });
  });

  it('re-reads before the assistant dev-mode toggle writes too', async () => {
    mockedFetch.mockResolvedValueOnce(DEV_MODE_SETTINGS);
    renderForm();
    const toggle = await screen.findByTestId(testIds.appConfig.assistantDevModeToggle);

    mockedFetch.mockResolvedValueOnce({ ...DEV_MODE_SETTINGS, pinned: false });
    fireEvent.click(toggle);

    await waitFor(() => expect(mockedUpdate).toHaveBeenCalled());
    const [, body] = mockedUpdate.mock.calls[0]!;
    expect(body.pinned).toBe(false);
    expect(body.jsonData).toMatchObject({ stackId: '123', enableAssistantDevMode: true });
  });

  it('leaves a never-set enableAiAutoHeal unset on both write paths', async () => {
    // This tab does not own the field. Spreading `getConfigWithDefaults` alone
    // would bake today's default into jsonData, and the field could then never
    // again follow a change to DEFAULT_ENABLE_AI_AUTO_HEAL for this stack.
    mockedFetch.mockResolvedValue(DEV_MODE_SETTINGS);
    renderForm();
    const toggle = await screen.findByTestId(testIds.appConfig.assistantDevModeToggle);

    fireEvent.submit(screen.getByTestId(testIds.appConfig.form));
    await waitFor(() => expect(mockedUpdate).toHaveBeenCalledTimes(1));

    fireEvent.click(toggle);
    await waitFor(() => expect(mockedUpdate).toHaveBeenCalledTimes(2));

    for (const [, body] of mockedUpdate.mock.calls) {
      expect((body.jsonData as DocsPluginConfig).enableAiAutoHeal).toBeUndefined();
    }
  });

  it('keeps an explicit enableAiAutoHeal choice on both write paths', async () => {
    // Off is a decision the owning tab made, not an absent value: the raw
    // pass-through has to carry `false` through as faithfully as it omits.
    mockedFetch.mockResolvedValue({
      ...DEV_MODE_SETTINGS,
      jsonData: { ...DEV_MODE_SETTINGS.jsonData, enableAiAutoHeal: false },
    });
    renderForm();
    const toggle = await screen.findByTestId(testIds.appConfig.assistantDevModeToggle);

    fireEvent.submit(screen.getByTestId(testIds.appConfig.form));
    await waitFor(() => expect(mockedUpdate).toHaveBeenCalledTimes(1));

    fireEvent.click(toggle);
    await waitFor(() => expect(mockedUpdate).toHaveBeenCalledTimes(2));

    for (const [, body] of mockedUpdate.mock.calls) {
      expect((body.jsonData as DocsPluginConfig).enableAiAutoHeal).toBe(false);
    }
  });

  it('does not write at all when the read-back fails', async () => {
    mockedFetch.mockResolvedValueOnce(MOUNT_SETTINGS);
    renderForm();
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(1));

    mockedFetch.mockRejectedValueOnce(new Error('nope'));

    fireEvent.submit(screen.getByTestId(testIds.appConfig.form));

    await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(2));
    expect(mockedUpdate).not.toHaveBeenCalled();
  });
});
