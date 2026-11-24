import { act, renderHook } from '@testing-library/react';
import { config } from '@grafana/runtime';
import { StorageKeys } from '../lib/storage-keys';
import { __resetSyncedForTests, useUserStorage } from '../lib/user-storage';
import { resetGuideLanguageStateForTests } from '../global-state/guide-language';
import { resetGuideTranslationsFlagCache } from '../utils/guide-translations-enablement';
import { useGuideLanguage } from './useGuideLanguage';

jest.mock('../utils/openfeature', () => ({
  getFeatureFlagValue: () => true,
}));

interface AccountStorage {
  store: Map<string, string>;
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
}

let mockSignedIn: AccountStorage | null = null;
jest.mock('@grafana/runtime', () => ({
  ...jest.requireActual('@grafana/runtime'),
  usePluginUserStorage: () => mockSignedIn,
  getAppEvents: () => ({ publish: jest.fn() }),
}));

function makeAccount(): AccountStorage {
  const store = new Map<string, string>();
  return {
    store,
    getItem: async (key) => store.get(key) ?? null,
    setItem: async (key, value) => {
      store.set(key, value);
    },
  };
}

function openPage(account: AccountStorage) {
  resetGuideLanguageStateForTests();
  __resetSyncedForTests();
  mockSignedIn = account;
  return renderHook(() => {
    useUserStorage();
    return useGuideLanguage();
  });
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  localStorage.clear();
  (config.bootData as { user?: unknown }).user = { language: 'en-US' };
  resetGuideTranslationsFlagCache();
});

it("keeps one reader's guide language out of the next reader's account on a shared browser", async () => {
  const accountA = makeAccount();
  const accountB = makeAccount();

  const pageA = openPage(accountA);
  await settle();
  await act(() => pageA.result.current.setPreferred('ja'));
  await settle();
  pageA.unmount();

  const pageB = openPage(accountB);
  await settle();

  expect(accountB.store.has(StorageKeys.GUIDE_LANGUAGE)).toBe(false);
  expect(pageB.result.current.preferred).toBe('follow-grafana');
  expect(pageB.result.current.effective).toBe('en-US');
  expect(localStorage.getItem(StorageKeys.GUIDE_LANGUAGE)).toBeNull();
  expect(accountA.store.get(StorageKeys.GUIDE_LANGUAGE)).toBe('ja');
});
