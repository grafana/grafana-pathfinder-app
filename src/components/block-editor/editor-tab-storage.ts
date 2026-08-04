/**
 * Per-tab localStorage for guide editor tabs — one document per tab.
 *
 * Draft fields (working guide + UI chrome) and remote binding (which API
 * resource this tab is linked to, plus the last synced snapshot) share a
 * single key. Writers go through merge helpers so auto-save never wipes
 * `remote` and a backend save never wipes the draft.
 *
 * Deliberately imports only `StorageKeys` (pure data) so the docs-panel main
 * chunk doesn't pull in the lazy-loaded block-editor bundle.
 */

import { StorageKeys } from '../../lib/storage-keys';

const STATE_BASE_KEY = StorageKeys.BLOCK_EDITOR_STATE;

export interface EditorTabRemoteState {
  resourceName: string;
  /** Guide JSON as of the last successful backend save/load. */
  lastSyncedJson: string | null;
  status?: 'draft' | 'published' | null;
}

/** Draft / UI half of the document. */
export interface EditorTabDraftState {
  guide?: unknown;
  blockIds?: string[];
  viewMode?: string;
  jsonModeState?: unknown;
  savedAt?: string;
  version?: number;
}

/** Unified per-tab editor document. */
export interface EditorTabStoredState extends EditorTabDraftState {
  remote?: EditorTabRemoteState;
}

export function editorTabStorageKey(tabId: string): string {
  return `${STATE_BASE_KEY}:${tabId}`;
}

/** Pending debounced draft writers, keyed by storage key. */
export const editorDraftFlushers = new Map<string, () => void>();

export function flushEditorDraft(storageKey: string): void {
  editorDraftFlushers.get(storageKey)?.();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseRemote(raw: unknown): EditorTabRemoteState | undefined {
  if (!isRecord(raw) || typeof raw.resourceName !== 'string' || raw.resourceName.length === 0) {
    return undefined;
  }
  return {
    resourceName: raw.resourceName,
    lastSyncedJson: typeof raw.lastSyncedJson === 'string' ? raw.lastSyncedJson : null,
    status: raw.status === 'draft' || raw.status === 'published' ? raw.status : null,
  };
}

export function parseEditorStoredState(raw: string | null): EditorTabStoredState | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return null;
    }

    const state: EditorTabStoredState = {};
    if ('guide' in parsed) {
      state.guide = parsed.guide;
    }
    if (Array.isArray(parsed.blockIds)) {
      state.blockIds = parsed.blockIds as string[];
    }
    if (typeof parsed.viewMode === 'string') {
      state.viewMode = parsed.viewMode;
    }
    if ('jsonModeState' in parsed) {
      state.jsonModeState = parsed.jsonModeState;
    }
    if (typeof parsed.savedAt === 'string') {
      state.savedAt = parsed.savedAt;
    }
    if (typeof parsed.version === 'number') {
      state.version = parsed.version;
    }
    if ('remote' in parsed) {
      state.remote = parseRemote(parsed.remote);
    }

    if (state.guide === undefined && state.remote === undefined) {
      return null;
    }
    return state;
  } catch {
    return null;
  }
}

export function readEditorStoredState(storageKey: string): EditorTabStoredState | null {
  try {
    return parseEditorStoredState(localStorage.getItem(storageKey));
  } catch {
    return null;
  }
}

function writeRaw(key: string, state: EditorTabStoredState): void {
  const hasDraft = state.guide !== undefined;
  const hasRemote = state.remote !== undefined;
  if (!hasDraft && !hasRemote) {
    localStorage.removeItem(key);
    notifyEditorTabChromeListeners();
    return;
  }
  localStorage.setItem(key, JSON.stringify(state));
  notifyEditorTabChromeListeners();
}

export type EditorTabChromeStatus = {
  publishedStatus: 'not-saved' | 'draft' | 'published';
  hasUnsyncedChanges: boolean;
};

export type EditorStatusBadge = {
  text: string;
  color: 'orange' | 'blue' | 'green';
  icon: 'circle' | 'exclamation-triangle' | 'cloud-upload';
  tooltip: string;
};

/** Header badge labels (Draft / Published, with optional "(modified)"). */
export function editorStatusBadge({ publishedStatus, hasUnsyncedChanges }: EditorTabChromeStatus): EditorStatusBadge {
  if (publishedStatus === 'not-saved') {
    return {
      text: 'Draft',
      color: 'blue',
      icon: 'circle',
      tooltip: 'Not yet saved to library',
    };
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

/** Tab-strip badge: Draft / Published only; dirty → italic title. */
export function editorTabStatusBadge(status: EditorTabChromeStatus): Omit<EditorStatusBadge, 'icon'> {
  const full = editorStatusBadge(status);
  if (status.publishedStatus === 'published') {
    return { text: 'Published', color: 'green', tooltip: full.tooltip };
  }
  return { text: 'Draft', color: 'blue', tooltip: full.tooltip };
}

/**
 * Strip chrome from per-tab storage (works for inactive tabs).
 * Uses applied guide only — unapplied JSON buffer ignored (follow-up).
 */
export function getEditorTabChromeStatus(tabId: string): EditorTabChromeStatus {
  try {
    const state = readEditorStoredState(editorTabStorageKey(tabId));
    const remote = state?.remote;
    if (!remote?.resourceName) {
      return { publishedStatus: 'not-saved', hasUnsyncedChanges: false };
    }

    const publishedStatus: 'draft' | 'published' = remote.status === 'published' ? 'published' : 'draft';

    const guide = state?.guide as { id?: string; title?: string; blocks?: unknown[] } | undefined;
    const hasGuideContent = Boolean(guide && Array.isArray(guide.blocks) && guide.blocks.length > 0);
    if (!guide || typeof remote.lastSyncedJson !== 'string') {
      return { publishedStatus, hasUnsyncedChanges: hasGuideContent };
    }

    return { publishedStatus, hasUnsyncedChanges: guideSyncSnapshot(guide) !== remote.lastSyncedJson };
  } catch {
    return { publishedStatus: 'not-saved', hasUnsyncedChanges: false };
  }
}

/** id/title/blocks only — shared dirty baseline for header, strip, and close. */
export function guideSyncSnapshot(guide: { id?: unknown; title?: unknown; blocks?: unknown }): string {
  return JSON.stringify({ id: guide.id, title: guide.title, blocks: guide.blocks });
}

let chromeVersion = 0;
const chromeListeners = new Set<() => void>();

function notifyEditorTabChromeListeners(): void {
  chromeVersion += 1;
  for (const listener of chromeListeners) {
    listener();
  }
}

export function subscribeEditorTabChrome(listener: () => void): () => void {
  chromeListeners.add(listener);
  return () => {
    chromeListeners.delete(listener);
  };
}

export function getEditorTabChromeVersion(): number {
  return chromeVersion;
}

/** Merge-write draft fields; preserves `remote`. */
export function writeEditorDraftState(storageKey: string, draft: EditorTabDraftState): void {
  try {
    const existing = readEditorStoredState(storageKey) ?? {};
    writeRaw(storageKey, {
      ...existing,
      ...draft,
      remote: existing.remote,
    });
  } catch {
    // localStorage unavailable
  }
}

/** Merge-write or clear remote binding; preserves draft fields. */
export function writeEditorRemoteState(storageKey: string, remote: EditorTabRemoteState | null): void {
  try {
    const existing = readEditorStoredState(storageKey) ?? {};
    if (remote === null) {
      const { remote: _drop, ...draftOnly } = existing;
      writeRaw(storageKey, draftOnly);
      return;
    }
    writeRaw(storageKey, { ...existing, remote });
  } catch {
    // localStorage unavailable
  }
}

export function clearEditorTabStorage(tabId: string): void {
  try {
    localStorage.removeItem(editorTabStorageKey(tabId));
    notifyEditorTabChromeListeners();
  } catch {
    // ignore
  }
}

/** First editor tab bound to `resourceName` (optional exclude for library reload). */
export function findEditorTabIdByResourceName(
  resourceName: string,
  editorTabIds: string[],
  excludeTabId?: string
): string | undefined {
  for (const tabId of editorTabIds) {
    if (tabId === excludeTabId) {
      continue;
    }
    const remote = readEditorStoredState(editorTabStorageKey(tabId))?.remote;
    if (remote?.resourceName === resourceName) {
      return tabId;
    }
  }
  return undefined;
}

/** True when closing would discard applied guide work. */
export function editorTabHasUnsavedWork(tabId: string): boolean {
  try {
    const state = readEditorStoredState(editorTabStorageKey(tabId));

    const guide = state?.guide as { id?: string; title?: string; blocks?: unknown[] } | undefined;
    if (!guide || !Array.isArray(guide.blocks)) {
      return false;
    }

    const remote = state?.remote;
    if (!remote?.resourceName || typeof remote.lastSyncedJson !== 'string') {
      // No sync baseline — only confirm if there's local content to lose.
      return Boolean(guide.blocks.length > 0);
    }

    return guideSyncSnapshot(guide) !== remote.lastSyncedJson;
  } catch {
    return false;
  }
}
