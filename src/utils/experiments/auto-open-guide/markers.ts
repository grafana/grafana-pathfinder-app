import { clearKeysByPrefix, collectKeysByPrefix } from '../../../lib/storage/key-utils';
import {
  COHORT_AUTO_OPEN_EXPERIMENT_ID,
  ONBOARDING_EXPLORING_EXPERIMENT_ID,
} from '../../../constants/auto-open-guide-experiment';
import { StorageKeys } from '../../../lib/storage-keys';

const markerPrefix = (hostname: string) => `${StorageKeys.AUTO_OPEN_GUIDE_SHOWN_PREFIX}${hostname}:`;

export function hasAutoOpenGuideShown(hostname: string, guide: string): boolean {
  try {
    return localStorage.getItem(`${markerPrefix(hostname)}${guide}`) === 'true';
  } catch {
    return false;
  }
}

export function markAutoOpenGuideShown(hostname: string, guide: string): void {
  try {
    localStorage.setItem(`${markerPrefix(hostname)}${guide}`, 'true');
  } catch {
    // Blocked storage re-offers the guide on the next page load.
  }
}

export function readConsumedVisit(hostname: string): string | undefined {
  try {
    return sessionStorage.getItem(`${StorageKeys.AUTO_OPEN_GUIDE_VISIT_PREFIX}${hostname}`) ?? undefined;
  } catch {
    return undefined;
  }
}

export function writeConsumedVisit(hostname: string, visit: string | undefined): void {
  const key = `${StorageKeys.AUTO_OPEN_GUIDE_VISIT_PREFIX}${hostname}`;
  try {
    if (visit === undefined) {
      sessionStorage.removeItem(key);
    } else {
      sessionStorage.setItem(key, visit);
    }
  } catch {
    // Blocked storage keeps the visit for this page load only.
  }
}

export function listAutoOpenGuidesShown(hostname: string, contextKey: string): string[] {
  const prefix = markerPrefix(hostname);
  const scopedPrefixes = [ONBOARDING_EXPLORING_EXPERIMENT_ID, COHORT_AUTO_OPEN_EXPERIMENT_ID].map(
    (id) => `${prefix}${id}:`
  );
  const guides = collectKeysByPrefix(localStorage, prefix).flatMap((key) => {
    const scopedPrefix = scopedPrefixes.find((candidate) => key.startsWith(candidate));
    if (!scopedPrefix) {
      return [key.slice(prefix.length)];
    }
    const currentPrefix = `${scopedPrefix}${contextKey}:`;
    return key.startsWith(currentPrefix) ? [key.slice(currentPrefix.length)] : [];
  });
  return [...new Set(guides)];
}

export function clearAutoOpenGuideMarkers(hostname: string): number {
  writeConsumedVisit(hostname, undefined);
  clearKeysByPrefix(sessionStorage, `${StorageKeys.AUTO_OPEN_GUIDE_VISIT_PREFIX}${hostname}:`);
  return clearKeysByPrefix(localStorage, markerPrefix(hostname)).length;
}
