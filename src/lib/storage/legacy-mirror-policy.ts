import { StorageKeys } from '../storage-keys';

/** Exact compatibility records restored from Grafana storage, in reconciliation order. */
// Write eligibility remains broader until #2166 deliberately limits it to records with a restore path.
export const LEGACY_RESTORE_KEYS = [
  StorageKeys.JOURNEY_COMPLETION,
  StorageKeys.TABS,
  StorageKeys.ACTIVE_TAB,
  StorageKeys.LEARNING_PROGRESS,
  StorageKeys.GUIDE_RESPONSES,
] as const;
