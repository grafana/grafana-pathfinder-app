import {
  editorTabStorageKey,
  editorTabHasUnsavedWork,
  clearEditorTabStorage,
  writeEditorDraftState,
  writeEditorRemoteState,
  readEditorStoredState,
  getEditorTabChromeStatus,
  findEditorTabIdByResourceName,
  editorStatusBadge,
  editorTabStatusBadge,
  migrateLegacyEditorTabStorage,
  LEGACY_EDITOR_TAB_ID,
} from './editor-tab-storage';
import { StorageKeys } from '../../lib/storage-keys';

const TAB_ID = 'tab-123';
const KEY = editorTabStorageKey(TAB_ID);
const LEGACY_KEY = editorTabStorageKey(LEGACY_EDITOR_TAB_ID);

const guide = { id: 'my-guide', title: 'My Guide', blocks: [{ type: 'markdown', content: 'hi' }] };

function seedDraft(g: unknown = guide) {
  writeEditorDraftState(KEY, { guide: g });
}

describe('editorTabHasUnsavedWork', () => {
  beforeEach(() => localStorage.clear());

  it('is false with no draft or empty never-saved draft; true with content', () => {
    expect(editorTabHasUnsavedWork(TAB_ID)).toBe(false);
    seedDraft({ ...guide, blocks: [] });
    expect(editorTabHasUnsavedWork(TAB_ID)).toBe(false);
    seedDraft();
    expect(editorTabHasUnsavedWork(TAB_ID)).toBe(true);
  });

  it('is false when draft matches lastSyncedJson, true when it diverges (including emptied blocks)', () => {
    seedDraft();
    writeEditorRemoteState(KEY, {
      resourceName: 'my-guide',
      lastSyncedJson: JSON.stringify(guide),
    });
    expect(editorTabHasUnsavedWork(TAB_ID)).toBe(false);

    seedDraft({ ...guide, title: 'Edited After Save' });
    expect(editorTabHasUnsavedWork(TAB_ID)).toBe(true);

    seedDraft({ ...guide, blocks: [] });
    expect(editorTabHasUnsavedWork(TAB_ID)).toBe(true);
  });

  it('ignores unapplied JSON-mode text', () => {
    writeEditorDraftState(KEY, {
      guide: { ...guide, blocks: [] },
      jsonModeState: {
        json: '{"id":"my-guide","title":"My Guide","blocks":[{"type":"markdown","content":"hi"}]}',
        originalJson: JSON.stringify({ ...guide, blocks: [] }),
        originalBlockIds: [],
      },
    });
    expect(editorTabHasUnsavedWork(TAB_ID)).toBe(false);
  });
});

describe('unified storage', () => {
  beforeEach(() => localStorage.clear());

  it('merges draft/remote writes and clears the key', () => {
    writeEditorDraftState(KEY, { guide, idIsLocked: false });
    writeEditorRemoteState(KEY, { resourceName: 'my-guide', lastSyncedJson: '{}' });
    expect(readEditorStoredState(KEY)?.guide).toEqual(guide);
    expect(readEditorStoredState(KEY)?.idIsLocked).toBe(false);
    expect(readEditorStoredState(KEY)?.remote?.resourceName).toBe('my-guide');

    writeEditorRemoteState(KEY, null);
    expect(readEditorStoredState(KEY)?.guide).toEqual(guide);
    expect(readEditorStoredState(KEY)?.remote).toBeUndefined();

    clearEditorTabStorage(TAB_ID);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('namespaces keys per tab id', () => {
    expect(editorTabStorageKey('any-id')).toBe(`${StorageKeys.BLOCK_EDITOR_STATE}:any-id`);
  });
});

describe('migrateLegacyEditorTabStorage', () => {
  beforeEach(() => localStorage.clear());

  it('copies unscoped singleton draft + backend tracking into :editor and clears legacy keys', () => {
    localStorage.setItem(
      StorageKeys.BLOCK_EDITOR_STATE,
      JSON.stringify({ guide, viewMode: 'edit', savedAt: '2026-01-01T00:00:00.000Z' })
    );
    localStorage.setItem(
      StorageKeys.LEGACY_BLOCK_EDITOR_BACKEND_TRACKING,
      JSON.stringify({ resourceName: 'my-guide', lastPublishedJson: JSON.stringify(guide) })
    );

    expect(migrateLegacyEditorTabStorage()).toBe(true);

    expect(localStorage.getItem(StorageKeys.BLOCK_EDITOR_STATE)).toBeNull();
    expect(localStorage.getItem(StorageKeys.LEGACY_BLOCK_EDITOR_BACKEND_TRACKING)).toBeNull();
    expect(readEditorStoredState(LEGACY_KEY)).toEqual({
      guide,
      viewMode: 'edit',
      savedAt: '2026-01-01T00:00:00.000Z',
      remote: { resourceName: 'my-guide', lastSyncedJson: JSON.stringify(guide), status: null },
    });
  });

  it('does not overwrite an existing :editor document; still clears legacy keys', () => {
    writeEditorDraftState(LEGACY_KEY, { guide: { ...guide, title: 'Already migrated' } });
    localStorage.setItem(StorageKeys.BLOCK_EDITOR_STATE, JSON.stringify({ guide }));

    expect(migrateLegacyEditorTabStorage()).toBe(true);

    expect(localStorage.getItem(StorageKeys.BLOCK_EDITOR_STATE)).toBeNull();
    expect(readEditorStoredState(LEGACY_KEY)?.guide).toEqual({ ...guide, title: 'Already migrated' });
  });

  it('returns false when there is nothing to migrate', () => {
    expect(migrateLegacyEditorTabStorage()).toBe(false);
  });

  it('runs automatically on readEditorStoredState', () => {
    localStorage.setItem(StorageKeys.BLOCK_EDITOR_STATE, JSON.stringify({ guide }));
    expect(readEditorStoredState(LEGACY_KEY)?.guide).toEqual(guide);
    expect(localStorage.getItem(StorageKeys.BLOCK_EDITOR_STATE)).toBeNull();
  });
});

describe('chrome status and badges', () => {
  beforeEach(() => localStorage.clear());

  it('derives publishedStatus and dirty from remote + applied guide', () => {
    expect(getEditorTabChromeStatus(TAB_ID).publishedStatus).toBe('not-saved');

    seedDraft();
    writeEditorRemoteState(KEY, {
      resourceName: 'my-guide',
      lastSyncedJson: JSON.stringify(guide),
      status: 'draft',
    });
    expect(getEditorTabChromeStatus(TAB_ID)).toEqual({
      publishedStatus: 'draft',
      hasUnsyncedChanges: false,
    });

    seedDraft({ ...guide, title: 'Edited' });
    expect(getEditorTabChromeStatus(TAB_ID).hasUnsyncedChanges).toBe(true);

    writeEditorRemoteState(KEY, {
      resourceName: 'my-guide',
      lastSyncedJson: null,
      status: 'published',
    });
    expect(getEditorTabChromeStatus(TAB_ID)).toEqual({
      publishedStatus: 'published',
      hasUnsyncedChanges: true,
    });
  });

  it('uses Draft/Published on the strip; modified only on the header badge', () => {
    expect(editorTabStatusBadge({ publishedStatus: 'draft', hasUnsyncedChanges: true }).text).toBe('Draft');
    expect(editorStatusBadge({ publishedStatus: 'draft', hasUnsyncedChanges: true }).text).toBe('Draft (modified)');
  });
});

describe('findEditorTabIdByResourceName', () => {
  beforeEach(() => localStorage.clear());

  it('returns the bound tab, honoring excludeTabId', () => {
    writeEditorRemoteState(editorTabStorageKey('tab-a'), {
      resourceName: 'guide-a',
      lastSyncedJson: '{}',
    });
    writeEditorRemoteState(editorTabStorageKey('tab-b'), {
      resourceName: 'guide-b',
      lastSyncedJson: '{}',
    });

    expect(findEditorTabIdByResourceName('guide-b', ['tab-a', 'tab-b'])).toBe('tab-b');
    expect(findEditorTabIdByResourceName('guide-b', ['tab-a', 'tab-b'], 'tab-b')).toBeUndefined();
  });
});
