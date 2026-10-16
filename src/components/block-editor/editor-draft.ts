import { StorageKeys } from '../../lib/storage-keys';
import type { JsonGuide, JsonModeState, ViewMode } from './types';
import { DEFAULT_GUIDE_TITLE, resetEditorChromeStatus } from './editor-chrome-status';

export interface StoredEditorDraft {
  guide: JsonGuide;
  blockIds?: string[];
  viewMode?: ViewMode;
  jsonModeState?: JsonModeState;
  savedAt: string;
  version: number;
}

export function serializeEditorDraft(draft: Omit<StoredEditorDraft, 'savedAt' | 'version'>): string {
  return JSON.stringify({ ...draft, savedAt: new Date().toISOString(), version: 2 });
}

export function hasEditorDraft(): boolean {
  const raw = localStorage.getItem(StorageKeys.BLOCK_EDITOR_STATE);
  if (!raw) {
    return false;
  }
  try {
    const draft = JSON.parse(raw) as StoredEditorDraft;
    return Boolean(
      draft.jsonModeState ||
      draft.guide.blocks.length ||
      draft.guide.id !== 'new-guide' ||
      draft.guide.title !== DEFAULT_GUIDE_TITLE
    );
  } catch {
    return true;
  }
}

// The public guide tab owns this handoff; the editor has unmounted and flushed its draft.
export function replaceEditorDraft(guide: JsonGuide): void {
  const keys = [
    StorageKeys.BLOCK_EDITOR_STATE,
    StorageKeys.BLOCK_EDITOR_BACKEND_TRACKING,
    StorageKeys.BLOCK_EDITOR_RECORDING_STATE,
  ];
  const previous = keys.map((key) => localStorage.getItem(key));
  try {
    localStorage.setItem(StorageKeys.BLOCK_EDITOR_STATE, serializeEditorDraft({ guide, viewMode: 'edit' }));
    localStorage.removeItem(StorageKeys.BLOCK_EDITOR_BACKEND_TRACKING);
    localStorage.removeItem(StorageKeys.BLOCK_EDITOR_RECORDING_STATE);
  } catch (error) {
    keys.forEach((key, index) => {
      const value = previous[index];
      if (value === null || value === undefined) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, value);
      }
    });
    throw error;
  }
  resetEditorChromeStatus();
}
