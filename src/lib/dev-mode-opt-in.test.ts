import { config } from '@grafana/runtime';
import { adoptLegacyDevModeOptIn, readDevModeOptIn, writeDevModeOptIn } from './dev-mode-opt-in';
import { StorageKeys } from './storage-keys';

jest.mock('@grafana/runtime', () => ({ config: { bootData: { user: { id: 1, orgId: 1 } }, appSubUrl: '' } }));

beforeEach(() => {
  localStorage.clear();
  config.bootData.user.id = 1;
  config.bootData.user.orgId = 1;
  config.appSubUrl = '';
});

it('keeps each account and organization choice separate', async () => {
  await writeDevModeOptIn(true);
  config.bootData.user.id = 2;
  expect(readDevModeOptIn()).toBeUndefined();
  await writeDevModeOptIn(false);
  config.bootData.user.id = 1;
  expect(readDevModeOptIn()).toBe(true);
  config.bootData.user.orgId = 2;
  expect(readDevModeOptIn()).toBeUndefined();
  config.bootData.user.orgId = 1;
  config.appSubUrl = '/other';
  expect(readDevModeOptIn()).toBeUndefined();
});

it('does not adopt a browser-wide opt-in of unknown ownership', () => {
  localStorage.setItem(StorageKeys.DEV_MODE_OPT_IN, 'true');
  expect(readDevModeOptIn()).toBeUndefined();
});

it('adopts a matching legacy account once and preserves an explicit opt-out', async () => {
  adoptLegacyDevModeOptIn();
  expect(readDevModeOptIn()).toBe(true);
  await writeDevModeOptIn(false);
  expect(readDevModeOptIn()).toBe(false);
});

it('fails closed without a current user', async () => {
  config.bootData.user.id = 0;
  expect(readDevModeOptIn()).toBe(false);
  await expect(writeDevModeOptIn(true)).rejects.toThrow('current user');
  adoptLegacyDevModeOptIn();
  expect(localStorage.length).toBe(0);
});
