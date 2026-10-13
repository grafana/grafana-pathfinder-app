import { clearKeysByPrefix, collectKeysByPrefix } from '../../../lib/storage/key-utils';
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

export function listAutoOpenGuidesShown(hostname: string): string[] {
  const prefix = markerPrefix(hostname);
  return collectKeysByPrefix(localStorage, prefix).map((key) => key.slice(prefix.length));
}

export function clearAutoOpenGuideMarkers(hostname: string): number {
  return clearKeysByPrefix(localStorage, markerPrefix(hostname)).length;
}
