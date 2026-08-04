/**
 * Tests for per-tab editor storage helpers — unified draft + remote document,
 * focused on the close-time unsaved-work decision.
 */

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
} from './editor-tab-storage';
import { StorageKeys } from '../../lib/storage-keys';

const TAB_ID = 'tab-123';
const KEY = editorTabStorageKey(TAB_ID);

const guide = { id: 'my-guide', title: 'My Guide', blocks: [{ type: 'markdown', content: 'hi' }] };

function seedDraft(g: unknown = guide) {
  writeEditorDraftState(KEY, { guide: g });
}

describe('editorTabHasUnsavedWork', () => {
  beforeEach(() => localStorage.clear());

  it('is false when there is no draft or an empty never-saved draft', () => {
    expect(editorTabHasUnsavedWork(TAB_ID)).toBe(false);

    seedDraft({ ...guide, blocks: [] });
    expect(editorTabHasUnsavedWork(TAB_ID)).toBe(false);
  });

  it('is true when the draft has content but was never saved to the backend', () => {
    seedDraft();
    expect(editorTabHasUnsavedWork(TAB_ID)).toBe(true);
  });

  it('is false when the draft matches the last backend save, true when it diverges', () => {
    seedDraft();
    writeEditorRemoteState(KEY, {
      resourceName: 'my-guide',
      lastSyncedJson: JSON.stringify(guide),
    });
    expect(editorTabHasUnsavedWork(TAB_ID)).toBe(false);

    seedDraft({ ...guide, title: 'Edited After Save' });
    expect(editorTabHasUnsavedWork(TAB_ID)).toBe(true);
  });

  it('is true when every block was deleted but the guide still diverges from lastSyncedJson', () => {
    seedDraft();
    writeEditorRemoteState(KEY, {
      resourceName: 'my-guide',
      lastSyncedJson: JSON.stringify(guide),
    });

    seedDraft({ ...guide, blocks: [] });
    expect(editorTabHasUnsavedWork(TAB_ID)).toBe(true);
    expect(getEditorTabChromeStatus(TAB_ID).hasUnsyncedChanges).toBe(true);
  });

  it('ignores unapplied JSON-mode text (matches guide isDirty / header sync)', () => {
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

  it('is false when applied guide matches lastSyncedJson even with a JSON buffer present', () => {
    const originalJson = JSON.stringify(guide);
    writeEditorDraftState(KEY, {
      guide,
      jsonModeState: { json: '{"id":"x"}', originalJson, originalBlockIds: [] },
    });
    writeEditorRemoteState(KEY, {
      resourceName: 'my-guide',
      lastSyncedJson: originalJson,
    });
    expect(editorTabHasUnsavedWork(TAB_ID)).toBe(false);
  });
});

describe('unified storage lifecycle', () => {
  beforeEach(() => localStorage.clear());

  it('keeps remote when writing draft, and keeps draft when clearing remote', () => {
    seedDraft();
    writeEditorRemoteState(KEY, { resourceName: 'my-guide', lastSyncedJson: '{}' });

    expect(readEditorStoredState(KEY)?.guide).toEqual(guide);
    expect(readEditorStoredState(KEY)?.remote?.resourceName).toBe('my-guide');

    writeEditorRemoteState(KEY, null);
    expect(readEditorStoredState(KEY)?.guide).toEqual(guide);
    expect(readEditorStoredState(KEY)?.remote).toBeUndefined();
  });

  it('clearEditorTabStorage removes the unified key', () => {
    seedDraft();
    writeEditorRemoteState(KEY, { resourceName: 'x', lastSyncedJson: null });

    clearEditorTabStorage(TAB_ID);

    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('namespaces every tab under the draft base key', () => {
    expect(editorTabStorageKey('any-id')).toBe(`${StorageKeys.BLOCK_EDITOR_STATE}:any-id`);
  });
});

describe('editorStatusBadge / editorTabStatusBadge', () => {
  it('matches the header vocabulary including (modified) variants', () => {
    expect(editorStatusBadge({ publishedStatus: 'not-saved', hasUnsyncedChanges: false }).text).toBe('Draft');
    expect(editorStatusBadge({ publishedStatus: 'draft', hasUnsyncedChanges: true })).toMatchObject({
      text: 'Draft (modified)',
      color: 'orange',
    });
    expect(editorStatusBadge({ publishedStatus: 'published', hasUnsyncedChanges: true })).toMatchObject({
      text: 'Published (modified)',
      color: 'orange',
    });
  });

  it('keeps tab badges succinct and leaves dirty to the title italics', () => {
    expect(editorTabStatusBadge({ publishedStatus: 'draft', hasUnsyncedChanges: true })).toEqual({
      text: 'Draft',
      color: 'blue',
      tooltip: 'Draft has unsaved changes',
    });
    expect(editorTabStatusBadge({ publishedStatus: 'published', hasUnsyncedChanges: true })).toEqual({
      text: 'Published',
      color: 'green',
      tooltip: 'Published guide has unsaved changes',
    });
  });
});

describe('getEditorTabChromeStatus', () => {
  beforeEach(() => localStorage.clear());

  it('is not-saved when there is no remote binding', () => {
    expect(getEditorTabChromeStatus(TAB_ID)).toEqual({
      publishedStatus: 'not-saved',
      hasUnsyncedChanges: false,
    });

    seedDraft();
    expect(getEditorTabChromeStatus(TAB_ID)).toEqual({
      publishedStatus: 'not-saved',
      hasUnsyncedChanges: false,
    });
  });

  it('reports draft / published and whether the draft diverged from lastSyncedJson', () => {
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
    expect(getEditorTabChromeStatus(TAB_ID)).toEqual({
      publishedStatus: 'draft',
      hasUnsyncedChanges: true,
    });

    writeEditorRemoteState(KEY, {
      resourceName: 'my-guide',
      lastSyncedJson: JSON.stringify({ ...guide, title: 'Edited' }),
      status: 'published',
    });
    expect(getEditorTabChromeStatus(TAB_ID)).toEqual({
      publishedStatus: 'published',
      hasUnsyncedChanges: false,
    });
  });

  it('ignores unapplied JSON-mode edits when the applied guide matches lastSyncedJson', () => {
    const originalJson = JSON.stringify(guide);
    writeEditorDraftState(KEY, {
      guide,
      jsonModeState: {
        json: '{"id":"my-guide","title":"Edited in JSON","blocks":[]}',
        originalJson,
        originalBlockIds: [],
      },
    });
    writeEditorRemoteState(KEY, {
      resourceName: 'my-guide',
      lastSyncedJson: originalJson,
      status: 'draft',
    });
    expect(getEditorTabChromeStatus(TAB_ID)).toEqual({
      publishedStatus: 'draft',
      hasUnsyncedChanges: false,
    });
  });

  it('reports unsynced when remote is bound but lastSyncedJson is missing and the guide has blocks', () => {
    seedDraft();
    writeEditorRemoteState(KEY, {
      resourceName: 'my-guide',
      lastSyncedJson: null,
      status: 'draft',
    });
    expect(getEditorTabChromeStatus(TAB_ID)).toEqual({
      publishedStatus: 'draft',
      hasUnsyncedChanges: true,
    });
  });
});

describe('findEditorTabIdByResourceName', () => {
  beforeEach(() => localStorage.clear());

  it('returns the tab bound to the resource, skipping excludeTabId', () => {
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
    expect(findEditorTabIdByResourceName('missing', ['tab-a', 'tab-b'])).toBeUndefined();
  });
});
