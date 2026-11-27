import { getPluginSettings, updateAppPluginSettings } from '@grafana/plugin-compat/apps';

import { fetchPluginJsonData, fetchPluginSettings, updatePluginSettings } from './utils.plugin';
import { saveTenantSettings } from '../components/AppConfig/save-settings';
import { fetchPathfinderSettingsSnapshot, savePathfinderSettings } from './pathfinder-settings-api';

jest.mock('@grafana/plugin-compat/apps', () => ({
  getPluginSettings: jest.fn(),
  updateAppPluginSettings: jest.fn(),
}));
jest.mock('./pathfinder-settings-api', () => ({
  ...jest.requireActual('./pathfinder-settings-api'),
  fetchPathfinderSettingsSnapshot: jest.fn(),
  savePathfinderSettings: jest.fn(),
}));

const PLUGIN_ID = 'grafana-pathfinder-app';

function serveSettings(record: Record<string, unknown>) {
  jest.mocked(getPluginSettings).mockResolvedValue(record as never);
  jest.mocked(updateAppPluginSettings).mockResolvedValue(record as never);
}

function sentWrites(): unknown[] {
  return jest.mocked(updateAppPluginSettings).mock.calls.map(([pluginId, data]) => {
    expect(pluginId).toBe(PLUGIN_ID);
    return data;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(fetchPathfinderSettingsSnapshot).mockResolvedValue(null);
  jest.mocked(savePathfinderSettings).mockResolvedValue(false);
});

describe('fetchPluginSettings', () => {
  it('echoes pinned and enabled alongside jsonData', async () => {
    serveSettings({ pinned: true, enabled: false, jsonData: { tutorialUrl: 'https://example.com' } });
    await expect(fetchPluginSettings(PLUGIN_ID)).resolves.toEqual({
      jsonData: { tutorialUrl: 'https://example.com' },
      enabled: false,
      pinned: true,
    });
    expect(getPluginSettings).toHaveBeenCalledWith(PLUGIN_ID);
  });

  it("defaults to Grafana's reading of omitted fields: enabled, not pinned, empty jsonData", async () => {
    serveSettings({});
    await expect(fetchPluginSettings(PLUGIN_ID)).resolves.toEqual({ jsonData: {}, enabled: true, pinned: false });
  });

  it.each([
    [
      { enabled: null, pinned: 'true' },
      { enabled: true, pinned: false },
    ],
    [
      { enabled: 0, pinned: 1 },
      { enabled: true, pinned: false },
    ],
    [
      { enabled: true, pinned: false },
      { enabled: true, pinned: false },
    ],
  ])('only an explicit false disables and only an explicit true pins (%j)', async (record, expected) => {
    serveSettings(record);
    await expect(fetchPluginSettings(PLUGIN_ID)).resolves.toMatchObject(expected);
  });

  it('reads jsonData alone through fetchPluginJsonData', async () => {
    serveSettings({ pinned: true, jsonData: { devMode: true } });
    await expect(fetchPluginJsonData(PLUGIN_ID)).resolves.toEqual({ devMode: true });
  });
});

describe('updatePluginSettings', () => {
  it('sends the payload it was given unchanged', async () => {
    serveSettings({});
    const payload = { enabled: false, pinned: true, jsonData: { tutorialUrl: 'https://example.com' } };
    await updatePluginSettings(PLUGIN_ID, payload);
    expect(sentWrites()).toEqual([payload]);
  });
});

describe('saveTenantSettings legacy write', () => {
  it('echoes pinned and enabled and keeps every other jsonData key', async () => {
    serveSettings({
      pinned: true,
      enabled: false,
      jsonData: { tutorialUrl: 'https://old.example.com', stackId: '123', devModeOptIn: true },
    });

    await saveTenantSettings({ pluginId: PLUGIN_ID, changes: { tutorialUrl: 'https://new.example.com' } });

    expect(sentWrites()).toEqual([
      {
        enabled: false,
        pinned: true,
        jsonData: { tutorialUrl: 'https://new.example.com', stackId: '123' },
      },
    ]);
  });

  it('keeps the plugin pinned when Grafana reports it pinned and enabled by default', async () => {
    serveSettings({ pinned: true, jsonData: {} });

    await saveTenantSettings({ pluginId: PLUGIN_ID, changes: { openPanelOnLaunch: true } });

    expect(sentWrites()).toEqual([{ enabled: true, pinned: true, jsonData: { openPanelOnLaunch: true } }]);
  });
});
