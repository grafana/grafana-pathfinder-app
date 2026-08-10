/**
 * Editor chrome shared with the docs panel: the default guide title and the
 * publish/dirty status behind the header badge and the editor tab badge, so
 * none of them can drift.
 *
 * The tab strip renders outside the editor — and stays rendered while the
 * editor is unmounted — so status arrives two ways: the mounted editor
 * publishes it on every change, and a localStorage fallback derives it from the
 * persisted draft plus backend tracking for strips rendered before the editor
 * has mounted (e.g. right after a page reload).
 *
 * Deliberately imports only `StorageKeys` (pure data) so the docs-panel main
 * chunk doesn't pull in the lazy-loaded block-editor bundle.
 */

import { StorageKeys } from '../../lib/storage-keys';

/**
 * Title of an untouched guide. The docs panel labels the editor tab with this
 * before the editor mounts, and `DEFAULT_GUIDE_METADATA` carries it afterwards;
 * they have to match or the tab visibly re-cases itself on mount.
 */
export const DEFAULT_GUIDE_TITLE = 'New guide';

export interface EditorChromeStatus {
  /**
   * Backend publish status:
   * - 'not-saved': guide exists only in localStorage
   * - 'draft': saved to library but not visible to users
   * - 'published': visible in the docs panel Custom guides section
   */
  publishedStatus: 'not-saved' | 'draft' | 'published';
  /** True when local content differs from the last backend save. */
  hasUnsyncedChanges: boolean;
}

export interface EditorStatusBadge {
  text: string;
  color: 'blue' | 'orange' | 'green';
  icon: 'circle' | 'exclamation-triangle' | 'cloud-upload';
  tooltip: string;
}

const NOT_SAVED: EditorChromeStatus = { publishedStatus: 'not-saved', hasUnsyncedChanges: false };

/** Header badge labels (Draft / Published, with optional "(modified)"). */
export function editorStatusBadge({ publishedStatus, hasUnsyncedChanges }: EditorChromeStatus): EditorStatusBadge {
  if (publishedStatus === 'not-saved') {
    return { text: 'Draft', color: 'blue', icon: 'circle', tooltip: 'Not yet saved to library' };
  }

  if (publishedStatus === 'draft') {
    return hasUnsyncedChanges
      ? {
          text: 'Draft (modified)',
          color: 'orange',
          icon: 'exclamation-triangle',
          tooltip: 'Draft has unsaved changes',
        }
      : {
          text: 'Draft',
          color: 'blue',
          icon: 'circle',
          tooltip: 'Saved to library but not published to users',
        };
  }

  return hasUnsyncedChanges
    ? {
        text: 'Published (modified)',
        color: 'orange',
        icon: 'exclamation-triangle',
        tooltip: 'Published guide has unsaved changes',
      }
    : {
        text: 'Published',
        color: 'green',
        icon: 'cloud-upload',
        tooltip: 'Published and visible to users',
      };
}

/** Tab-strip badge: Draft / Published only — "modified" is carried by the italic title. */
export function editorTabStatusBadge(status: EditorChromeStatus): Omit<EditorStatusBadge, 'icon'> {
  const full = editorStatusBadge(status);
  if (status.publishedStatus === 'published') {
    return { text: 'Published', color: 'green', tooltip: full.tooltip };
  }
  return { text: 'Draft', color: 'blue', tooltip: full.tooltip };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The working guide as last auto-saved by the editor, or null when absent. */
export function readStoredEditorGuide(): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(StorageKeys.BLOCK_EDITOR_STATE);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) && isRecord(parsed.guide) ? parsed.guide : null;
  } catch {
    return null;
  }
}

/**
 * Status derived from persisted state, for strips rendered while the editor is
 * unmounted. Mirrors `useBackendSaveFlow`: dirty needs a sync baseline, so no
 * `lastPublishedJson` reads as clean rather than guessing — but with a baseline
 * and no draft, mounting the editor yields the empty default guide, which never
 * matches it, so report that divergence instead of a false clean badge.
 */
function readPersistedEditorChromeStatus(): EditorChromeStatus {
  try {
    const raw = localStorage.getItem(StorageKeys.BLOCK_EDITOR_BACKEND_TRACKING);
    if (!raw) {
      return NOT_SAVED;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || typeof parsed.resourceName !== 'string' || parsed.resourceName.length === 0) {
      return NOT_SAVED;
    }

    const publishedStatus = parsed.backendStatus === 'published' ? 'published' : 'draft';
    if (typeof parsed.lastPublishedJson !== 'string') {
      return { publishedStatus, hasUnsyncedChanges: false };
    }

    const guide = readStoredEditorGuide();
    return {
      publishedStatus,
      hasUnsyncedChanges: !guide || JSON.stringify(guide) !== parsed.lastPublishedJson,
    };
  } catch {
    return NOT_SAVED;
  }
}

let liveStatus: EditorChromeStatus | null = null;
let statusVersion = 0;
const listeners = new Set<() => void>();

function notifyListeners(): void {
  statusVersion += 1;
  for (const listener of listeners) {
    listener();
  }
}

/** Called by the mounted editor whenever its derived status changes. */
export function publishEditorChromeStatus(next: EditorChromeStatus): void {
  if (
    liveStatus &&
    liveStatus.publishedStatus === next.publishedStatus &&
    liveStatus.hasUnsyncedChanges === next.hasUnsyncedChanges
  ) {
    return;
  }
  liveStatus = next;
  notifyListeners();
}

/** Drop the published status so reads fall back to persisted state. */
export function resetEditorChromeStatus(): void {
  if (!liveStatus) {
    return;
  }
  liveStatus = null;
  notifyListeners();
}

export function subscribeEditorChromeStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Monotonic counter — the `useSyncExternalStore` snapshot for the tab strip. */
export function getEditorChromeStatusVersion(): number {
  return statusVersion;
}

export function getEditorChromeStatus(): EditorChromeStatus {
  return liveStatus ?? readPersistedEditorChromeStatus();
}
