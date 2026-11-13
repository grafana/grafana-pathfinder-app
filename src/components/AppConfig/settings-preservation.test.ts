import { usesSdkBackend } from '../../lib/backend-routes';
import { DEFAULT_ENABLE_AI_AUTO_HEAL, getConfigWithDefaults, PathfinderPluginConfig } from '../../constants';
import { fetchPathfinderSettingsSnapshot, savePathfinderSettings } from '../../utils/pathfinder-settings-api';
import { fetchPluginSettings, updatePluginSettings } from '../../utils/utils.plugin';
import { saveTenantSettings } from './save-settings';

jest.mock('../../lib/backend-routes', () => ({ usesSdkBackend: jest.fn() }));

jest.mock('../../utils/pathfinder-settings-api', () => ({
  ...jest.requireActual('../../utils/pathfinder-settings-api'),
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
  jest.mocked(usesSdkBackend).mockReturnValue(true);
  mockFetchPlugin.mockResolvedValue({ jsonData: {}, enabled: true, pinned: true });
  mockFetchTenant.mockResolvedValue(null);
  mockSaveTenant.mockResolvedValue(true);
  mockUpdatePlugin.mockResolvedValue(undefined);
});

describe('saveTenantSettings — App Platform path', () => {
  it.each([true, false])(
    'saves Pathfinder preference %s while preserving other org settings',
    async (pathfinderEnabled) => {
      const base = tenantSnapshot({ tutorialUrl: 'stored', pathfinderEnabled: !pathfinderEnabled });
      mockFetchTenant.mockResolvedValueOnce(base).mockResolvedValueOnce(tenantSnapshot({ pathfinderEnabled }));
      await saveTenantSettings({ pluginId: PLUGIN_ID, changes: { pathfinderEnabled } });
      expect(mockSaveTenant).toHaveBeenCalledWith({ tutorialUrl: 'stored', pathfinderEnabled }, base);
      expect(mockUpdatePlugin).not.toHaveBeenCalled();
    }
  );
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
    expect(written).not.toHaveProperty('enableAutoDetection');
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

describe('saveTenantSettings — the kind is not served here', () => {
  it.each([403, 502])('does not save to either store when the authoritative read fails with %s', async (status) => {
    mockFetchTenant.mockRejectedValue(Object.assign(new Error('settings unavailable'), { status }));

    await expect(saveTenantSettings({ pluginId: PLUGIN_ID, changes: { enableLiveSessions: true } })).rejects.toThrow(
      'settings unavailable'
    );

    expect(mockSaveTenant).not.toHaveBeenCalled();
    expect(mockUpdatePlugin).not.toHaveBeenCalled();
  });

  it('rejects an unavailable SDK store without mutating plugin configuration', async () => {
    mockSaveTenant.mockResolvedValue(false);
    mockFetchPlugin.mockResolvedValue({ jsonData: provisionedJsonData(), enabled: true, pinned: true });
    await expect(saveTenantSettings({ pluginId: PLUGIN_ID, changes: { tutorialUrl: 'new' } })).rejects.toThrow(
      'SDK settings API is unavailable'
    );
    expect(mockUpdatePlugin).not.toHaveBeenCalled();
  });

  it('surfaces a real write failure instead of quietly using the other store', async () => {
    mockSaveTenant.mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 }));

    await expect(
      saveTenantSettings({ pluginId: PLUGIN_ID, changes: { tutorialUrl: 'https://new.example.com' } })
    ).rejects.toThrow('forbidden');
    expect(mockUpdatePlugin).not.toHaveBeenCalled();
  });
});

describe('saveTenantSettings — a field this tab does not own', () => {
  // Main's #1654 rule: an unrelated save must not write down a field nobody has
  // set, because a written field stops tracking `DEFAULT_*` for that stack.
  // `enableAiAutoHeal` is the field it was written for — its default flipped to
  // true, and any stack whose settings had been saved once would have missed it.
  it('does not materialize an unset field while migrating legacy settings into the SDK resource', async () => {
    mockFetchPlugin.mockResolvedValue({
      jsonData: { tutorialUrl: 'https://original.example.com' },
      enabled: true,
      pinned: true,
    });

    await saveTenantSettings({ pluginId: PLUGIN_ID, changes: { tutorialUrl: 'https://changed.example.com' } });

    const written = mockSaveTenant.mock.calls[0]![0] as Record<string, unknown>;
    expect(written).not.toHaveProperty('enableAiAutoHeal');
    // Still resolves to the live default, which is the whole point of not writing it.
    expect(getConfigWithDefaults(written).enableAiAutoHeal).toBe(DEFAULT_ENABLE_AI_AUTO_HEAL);
  });

  it('leaves an admin-chosen value for that field alone', async () => {
    mockFetchPlugin.mockResolvedValue({
      jsonData: { enableAiAutoHeal: false, tutorialUrl: 'https://original.example.com' },
      enabled: true,
      pinned: true,
    });

    await saveTenantSettings({ pluginId: PLUGIN_ID, changes: { tutorialUrl: 'https://changed.example.com' } });

    const written = mockSaveTenant.mock.calls[0]![0] as PathfinderPluginConfig;
    expect(written.enableAiAutoHeal).toBe(false);
  });

  it('does not materialize an unset field into the settings resource', async () => {
    mockSaveTenant.mockResolvedValue(true);
    mockFetchTenant.mockResolvedValue(tenantSnapshot({}));

    await saveTenantSettings({ pluginId: PLUGIN_ID, changes: { tutorialUrl: 'https://changed.example.com' } });

    expect(mockSaveTenant.mock.calls[0]![0]).not.toHaveProperty('enableAiAutoHeal');
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

it.each([{}, { pathfinderEnabled: true }])(
  'rejects a successful write that did not retain the opt-out: %j',
  async (saved) => {
    mockSaveTenant.mockResolvedValue(true);
    mockFetchTenant.mockResolvedValueOnce(tenantSnapshot({})).mockResolvedValueOnce(tenantSnapshot(saved));
    await expect(saveTenantSettings({ pluginId: PLUGIN_ID, changes: { pathfinderEnabled: false } })).rejects.toThrow(
      'Interactive learning preference was not retained'
    );
    expect(mockUpdatePlugin).not.toHaveBeenCalled();
  }
);

it('reports a failed verification read rather than declaring the save successful', async () => {
  mockSaveTenant.mockResolvedValue(true);
  mockFetchTenant.mockResolvedValueOnce(tenantSnapshot({})).mockRejectedValueOnce(new Error('read failed'));
  await expect(saveTenantSettings({ pluginId: PLUGIN_ID, changes: { pathfinderEnabled: false } })).rejects.toThrow(
    'read failed'
  );
});

describe('settings on installations without SDK registration', () => {
  beforeEach(() => jest.mocked(usesSdkBackend).mockReturnValue(false));

  it('preserves plugin metadata and explicit settings when disabling learning', async () => {
    mockFetchPlugin.mockResolvedValue({
      jsonData: { stackId: '123', tutorialUrl: 'existing', devModeOptIn: true },
      enabled: false,
      pinned: false,
    });
    await saveTenantSettings({ pluginId: PLUGIN_ID, changes: { pathfinderEnabled: false } });
    expect(mockSaveTenant).not.toHaveBeenCalled();
    expect(mockUpdatePlugin).toHaveBeenCalledWith(PLUGIN_ID, {
      enabled: false,
      pinned: false,
      jsonData: { stackId: '123', tutorialUrl: 'existing', pathfinderEnabled: false },
    });
  });

  it('does not abandon an existing authoritative resource', async () => {
    mockFetchTenant.mockResolvedValue(tenantSnapshot({ tutorialUrl: 'resource' }));
    mockSaveTenant.mockResolvedValue(false);
    await expect(saveTenantSettings({ pluginId: PLUGIN_ID, changes: {} })).rejects.toThrow('SDK settings API');
    expect(mockUpdatePlugin).not.toHaveBeenCalled();
  });

  it('surfaces plugin configuration write errors', async () => {
    mockUpdatePlugin.mockRejectedValueOnce(new Error('forbidden'));
    await expect(saveTenantSettings({ pluginId: PLUGIN_ID, changes: {} })).rejects.toThrow('forbidden');
    expect(mockSaveTenant).not.toHaveBeenCalled();
  });
});
