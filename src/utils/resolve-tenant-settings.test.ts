import { resolveTenantSettings, TenantSettingsReadError } from './resolve-tenant-settings';
import { fetchPluginSettings } from './utils.plugin';
import { fetchPathfinderSettingsSnapshot } from './pathfinder-settings-api';

jest.mock('./utils.plugin', () => ({ fetchPluginSettings: jest.fn() }));
jest.mock('./pathfinder-settings-api', () => ({ fetchPathfinderSettingsSnapshot: jest.fn() }));

it.each(['plugin', 'tenant'])('retains a readable false when the %s read fails', async (failed) => {
  jest.mocked(fetchPluginSettings).mockImplementation(async () => {
    if (failed === 'plugin') {
      throw { status: 403 };
    }
    return { jsonData: { pathfinderEnabled: false }, enabled: true, pinned: true };
  });
  jest.mocked(fetchPathfinderSettingsSnapshot).mockImplementation(async () => {
    if (failed === 'tenant') {
      throw { status: 403 };
    }
    return { config: { pathfinderEnabled: false }, spec: {}, resourceVersion: '1' };
  });
  await expect(resolveTenantSettings('grafana-pathfinder-app')).rejects.toMatchObject({
    pathfinderEnabled: false,
  });
  await expect(resolveTenantSettings('grafana-pathfinder-app')).rejects.toBeInstanceOf(TenantSettingsReadError);
});

it('keeps tenant precedence over legacy false when both reads succeed', async () => {
  jest
    .mocked(fetchPluginSettings)
    .mockResolvedValue({ jsonData: { pathfinderEnabled: false }, enabled: true, pinned: true });
  jest
    .mocked(fetchPathfinderSettingsSnapshot)
    .mockResolvedValue({ config: { pathfinderEnabled: true }, spec: {}, resourceVersion: '1' });
  await expect(resolveTenantSettings('grafana-pathfinder-app')).resolves.toMatchObject({
    config: { pathfinderEnabled: true },
  });
});
