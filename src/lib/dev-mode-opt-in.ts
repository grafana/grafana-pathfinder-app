import { config } from '@grafana/runtime';

import { StorageKeys } from './storage-keys';

function storageKey(): string | undefined {
  const user = config.bootData?.user;
  if (!user?.id || !user.orgId) {
    return undefined;
  }
  return `${StorageKeys.DEV_MODE_OPT_IN}:${encodeURIComponent(config.appSubUrl || '')}:${user.orgId}:${user.id}`;
}

export function readDevModeOptIn(): boolean | undefined {
  const key = storageKey();
  if (!key) {
    return false;
  }
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? undefined : JSON.parse(raw) === true;
  } catch {
    return false;
  }
}

export async function writeDevModeOptIn(enabled: boolean): Promise<void> {
  const key = storageKey();
  if (!key) {
    throw new Error('Cannot determine the current user and organization');
  }
  localStorage.setItem(key, JSON.stringify(enabled));
}

export function adoptLegacyDevModeOptIn(): void {
  const key = storageKey();
  if (!key) {
    return;
  }
  try {
    // Never adopt the old browser-wide key: its owner cannot be established.
    localStorage.setItem(key, JSON.stringify(true));
  } catch {
    // A storage failure leaves the legacy account membership available on the next load.
  }
}
