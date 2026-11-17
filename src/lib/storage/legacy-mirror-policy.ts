import { StorageKeys } from '../storage-keys';

/** Restore order and intended remote-write allowlist; writes remain broader until routing adopts it. */
export const LEGACY_RESTORE_KEYS = [
  StorageKeys.JOURNEY_COMPLETION,
  StorageKeys.TABS,
  StorageKeys.ACTIVE_TAB,
  StorageKeys.LEARNING_PROGRESS,
  StorageKeys.GUIDE_RESPONSES,
  StorageKeys.GUIDE_LANGUAGE,
] as const;
