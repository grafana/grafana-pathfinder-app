/**
 * Regression tests for settings preservation on save.
 *
 * Grafana's plugin settings API replaces `jsonData` wholesale rather than merging
 * it, and Grafana Cloud provisioning writes to the same record. That produced two
 * separate incidents: a config save erased the provisioned `stackId` and broke
 * private guides (#1514), and a save that omitted `pinned` unpinned the plugin
 * from the nav (`aa1c2efd`).
 *
 * Tenant settings now live in their own App Platform resource, which shares no
 * document with provisioning. These tests cover both halves of that:
 *
 *   - the App Platform path is preferred and never carries fields it does not own;
 *   - the legacy `jsonData` fallback — still the only store on OSS, self-managed
 *     and local dev — preserves provisioned fields and echoes `enabled`/`pinned`.
 *
 * Unlike the earlier version of this file, these exercise `saveTenantSettings`
 * itself rather than re-simulating the spread pattern inline, so a call site that
 * stops preserving fields actually fails.
 *
 * @see https://grafana.com/developers/plugin-tools/how-to-guides/app-plugins/add-authentication-for-app-plugins
 */

import { getConfigWithDefaults, PathfinderPluginConfig } from '../../constants';
import { fetchPathfinderSettingsSnapshot, savePathfinderSettings } from '../../utils/pathfinder-settings-api';
import { fetchPluginSettings, updatePluginSettings } from '../../utils/utils.plugin';
import { saveTenantSettings } from './save-settings';

jest.mock('../../utils/pathfinder-settings-api', () => ({
  fetchPathfinderSettingsSnapshot: jest.fn(),
  savePathfinderSettings: jest.fn(),
}));

jest.mock('../../utils/utils.plugin', () => ({
  fetchPluginSettings: jest.fn(),
  updatePluginSettings: jest.fn(),
}));

const mockFetchTenant = fetchPathfinderSettingsSnapshot as jest.MockedFunction<typeof fetchPathfinderSettingsSnapshot>;
const mockSaveTenant = savePathfinderSettings as jest.MockedFunction<typeof savePathfinderSettings>;
const mockFetchPlugin = fetchPluginSettings as jest.MockedFunction<typeof fetchPluginSettings>;
const mockUpdatePlugin = updatePluginSettings as jest.MockedFunction<typeof updatePluginSettings>;

const PLUGIN_ID = 'grafana-pathfinder-app';

/** A settings-resource snapshot, so a test only has to name the stored config. */
function tenantSnapshot(config: PathfinderPluginConfig, resourceVersion = '7') {
  return { config, spec: {}, resourceVersion };
}

/** The jsonData a provisioned Cloud stack carries. */
function provisionedJsonData(extra: PathfinderPluginConfig = {}): PathfinderPluginConfig {
  return { stackId: '123456', ...extra };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFetchPlugin.mockResolvedValue({ jsonData: {}, enabled: true, pinned: true });
  mockFetchTenant.mockResolvedValue(null);
  mockSaveTenant.mockResolvedValue(false);
  mockUpdatePlugin.mockResolvedValue(undefined);
});

describe('saveTenantSettings — App Platform path', () => {
  beforeEach(() => {
    mockSaveTenant.mockResolvedValue(true);
  });

  it('writes to the settings resource and leaves plugin settings untouched', async () => {
    mockFetchPlugin.mockResolvedValue({ jsonData: provisionedJsonData(), enabled: true, pinned: true });

    await saveTenantSettings({ pluginId: PLUGIN_ID, changes: { tutorialUrl: 'https://new.example.com' } });

    expect(mockSaveTenant).toHaveBeenCalledTimes(1);
    // The provisioned document is never rewritten, so `stackId` cannot be lost.
    expect(mockUpdatePlugin).not.toHaveBeenCalled();
  });

  it('sends the resolved config, not just the edited field', async () => {
    mockFetchTenant.mockResolvedValue(tenantSnapshot({ enableLiveSessions: true }));

    await saveTenantSettings({ pluginId: PLUGIN_ID, changes: { tutorialUrl: 'https://new.example.com' } });

    const written = mockSaveTenant.mock.calls[0]![0];
    expect(written.tutorialUrl).toBe('https://new.example.com');
    // Read back from the resource, not from this form.
    expect(written.enableLiveSessions).toBe(true);
    // Defaulted, so a partial write cannot blank it.
    expect(written.enableAutoDetection).toBe(true);
  });

  it('hands the read snapshot to the writer so the save is a compare-and-swap', async () => {
    // Without the resourceVersion the write is an unconditioned replace and two
    // admins saving at once silently lose one of the two sets of edits.
    const snapshot = tenantSnapshot({ enableLiveSessions: true }, '42');
    mockFetchTenant.mockResolvedValue(snapshot);

    await saveTenantSettings({ pluginId: PLUGIN_ID, changes: { tutorialUrl: 'https://new.example.com' } });

    expect(mockSaveTenant.mock.calls[0]![1]).toBe(snapshot);
  });

  it('does not let one tab overwrite another tab with a stale value', async () => {
    // The stale-snapshot bug: this tab was rendered before another tab saved
    // `enableLiveSessions: true`. It owns only `tutorialUrl`, so the read at write
    // time — not the render-time snapshot — decides everything else.
    mockFetchTenant.mockResolvedValue(
      tenantSnapshot({ enableLiveSessions: true, tutorialUrl: 'https://old.example.com' })
    );

    await saveTenantSettings({ pluginId: PLUGIN_ID, changes: { tutorialUrl: 'https://new.example.com' } });

    const written = mockSaveTenant.mock.calls[0]![0];
    expect(written.enableLiveSessions).toBe(true);
    expect(written.tutorialUrl).toBe('https://new.example.com');
  });
});

describe('saveTenantSettings — legacy jsonData fallback', () => {
  it('preserves provisioned fields such as stackId', async () => {
    // The #1514 regression. Without the leading spread, this save wipes stackId,
    // which silently breaks the OBO token exchanger and private guides.
    mockFetchPlugin.mockResolvedValue({
      jsonData: provisionedJsonData({ recommenderServiceUrl: 'https://custom.example.com' }),
      enabled: true,
      pinned: true,
    });

    await saveTenantSettings({ pluginId: PLUGIN_ID, changes: { tutorialUrl: 'https://new.example.com' } });

    const written = mockUpdatePlugin.mock.calls[0]![1].jsonData as PathfinderPluginConfig;
    expect(written.stackId).toBe('123456');
    expect(written.recommenderServiceUrl).toBe('https://custom.example.com');
    expect(written.tutorialUrl).toBe('https://new.example.com');
  });

  it('preserves fields it has never heard of', async () => {
    mockFetchPlugin.mockResolvedValue({
      jsonData: { someFutureProvisionedField: 'cloud-value' } as PathfinderPluginConfig,
      enabled: true,
      pinned: true,
    });

    await saveTenantSettings({ pluginId: PLUGIN_ID, changes: { tutorialUrl: 'https://new.example.com' } });

    const written = mockUpdatePlugin.mock.calls[0]![1].jsonData as Record<string, unknown>;
    expect(written.someFutureProvisionedField).toBe('cloud-value');
  });

  it('echoes enabled and pinned from the authoritative read', async () => {
    // The `aa1c2efd` regression: Grafana reads an omitted `pinned` as false, so a
    // save that drops it unpins the plugin from the nav.
    mockFetchPlugin.mockResolvedValue({ jsonData: {}, enabled: true, pinned: true });

    await saveTenantSettings({ pluginId: PLUGIN_ID, changes: { tutorialUrl: 'https://new.example.com' } });

    expect(mockUpdatePlugin.mock.calls[0]![1]).toMatchObject({ enabled: true, pinned: true });
  });

  it('does not invent enabled or pinned when the stack really has them off', async () => {
    mockFetchPlugin.mockResolvedValue({ jsonData: {}, enabled: false, pinned: false });

    await saveTenantSettings({ pluginId: PLUGIN_ID, changes: { tutorialUrl: 'https://new.example.com' } });

    expect(mockUpdatePlugin.mock.calls[0]![1]).toMatchObject({ enabled: false, pinned: false });
  });

  it('never writes per-user state into the org-wide document', async () => {
    await saveTenantSettings({ pluginId: PLUGIN_ID, changes: { tutorialUrl: 'https://new.example.com' } });

    const written = mockUpdatePlugin.mock.calls[0]![1].jsonData as Record<string, unknown>;
    expect(written).not.toHaveProperty('devModeOptIn');
  });

  it('survives repeated saves without shedding provisioned fields', async () => {
    let stored: PathfinderPluginConfig = provisionedJsonData();
    mockFetchPlugin.mockImplementation(async () => ({ jsonData: stored, enabled: true, pinned: true }));
    mockUpdatePlugin.mockImplementation(async (_id, data) => {
      stored = data.jsonData as PathfinderPluginConfig;
      return undefined;
    });

    await saveTenantSettings({ pluginId: PLUGIN_ID, changes: { acceptedTermsAndConditions: true } });
    await saveTenantSettings({ pluginId: PLUGIN_ID, changes: { tutorialUrl: 'https://changed.example.com' } });

    expect(stored.stackId).toBe('123456');
    expect(stored.acceptedTermsAndConditions).toBe(true);
    expect(stored.tutorialUrl).toBe('https://changed.example.com');
  });
});

describe('saveTenantSettings — the kind is not served here', () => {
  it('falls back to jsonData rather than failing the save', async () => {
    // The GAP aggregation toggle is shared with InteractiveGuide, so it can be on
    // while `pathfindersettings` is not served — a stack running the plugin ahead
    // of the backend. The writer reports that as `false`, and the save must land.
    mockSaveTenant.mockResolvedValue(false);
    mockFetchPlugin.mockResolvedValue({ jsonData: provisionedJsonData(), enabled: true, pinned: true });

    await saveTenantSettings({ pluginId: PLUGIN_ID, changes: { tutorialUrl: 'https://new.example.com' } });

    const written = mockUpdatePlugin.mock.calls[0]![1].jsonData as PathfinderPluginConfig;
    expect(written.tutorialUrl).toBe('https://new.example.com');
    expect(written.stackId).toBe('123456');
  });

  it('surfaces a real write failure instead of quietly using the other store', async () => {
    mockSaveTenant.mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 }));

    await expect(
      saveTenantSettings({ pluginId: PLUGIN_ID, changes: { tutorialUrl: 'https://new.example.com' } })
    ).rejects.toThrow('forbidden');
    expect(mockUpdatePlugin).not.toHaveBeenCalled();
  });
});

describe('getConfigWithDefaults behavior', () => {
  it('does not include unknown fields in its output', () => {
    const jsonData = provisionedJsonData({ recommenderServiceUrl: 'https://custom.example.com' });

    const defaults = getConfigWithDefaults(jsonData);

    // Why the fallback path spreads the original document first: the defaulter
    // returns only known fields, so on its own it would drop `stackId`.
    expect('stackId' in defaults).toBe(false);
  });

  it('preserves existing values for known fields', () => {
    const jsonData: PathfinderPluginConfig = {
      recommenderServiceUrl: 'https://custom.example.com',
      tutorialUrl: 'https://custom-tutorial.example.com',
      enableAutoDetection: false,
    };

    const defaults = getConfigWithDefaults(jsonData);

    expect(defaults.recommenderServiceUrl).toBe('https://custom.example.com');
    expect(defaults.tutorialUrl).toBe('https://custom-tutorial.example.com');
    expect(defaults.enableAutoDetection).toBe(false);
  });
});
