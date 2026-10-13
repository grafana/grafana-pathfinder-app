import { config } from '@grafana/runtime';

import { StorageKeys } from '../lib/storage-keys';

export interface SettingsAbsenceCache {
  key: string;
  generationKey: string;
  generation: string;
  absent: boolean;
}

export function readSettingsAbsenceCache(): SettingsAbsenceCache | undefined {
  if (!config.namespace) {
    return undefined;
  }
  const user = config.bootData?.user;
  const scope = JSON.stringify([config.appSubUrl || '', config.namespace]);
  const generationKey = `${StorageKeys.SETTINGS_GENERATION_PREFIX}${scope}`;
  const key = `${StorageKeys.SETTINGS_ABSENT_PREFIX}${JSON.stringify([scope, user?.orgId, user?.id])}`;
  try {
    const generation = localStorage.getItem(generationKey) ?? 'initial';
    return { key, generationKey, generation, absent: sessionStorage.getItem(key) === generation };
  } catch {
    return undefined;
  }
}

export function rememberSettingsAbsence(cache: SettingsAbsenceCache | undefined): void {
  if (!cache) {
    return;
  }
  try {
    // A save or authoritative read in another tab must win over an older missing-record response.
    if ((localStorage.getItem(cache.generationKey) ?? 'initial') === cache.generation) {
      sessionStorage.setItem(cache.key, cache.generation);
    }
  } catch {
    // Unavailable storage costs another read, never a failed settings operation.
  }
}

export function forgetSettingsAbsence(cache: SettingsAbsenceCache | undefined): void {
  if (!cache) {
    return;
  }
  try {
    sessionStorage.removeItem(cache.key);
  } catch {
    // Cache storage is optional.
  }
}

export function invalidateSettingsAbsence(cache: SettingsAbsenceCache | undefined): void {
  forgetSettingsAbsence(cache);
  if (!cache) {
    return;
  }
  try {
    localStorage.setItem(cache.generationKey, crypto.randomUUID());
  } catch {
    // The current tab is cleared even when cross-tab invalidation is unavailable.
  }
}
