import { act, renderHook } from '@testing-library/react';
import { StorageKeys } from '../../lib/storage-keys';
import { hasEditorDraft, replaceEditorDraft, serializeEditorDraft } from './editor-draft';
import { useBackendSaveFlow } from './hooks/useBackendSaveFlow';
import { getEditorChromeStatus } from './editor-chrome-status';

jest.mock('./notify', () => ({ notify: jest.fn() }));

const guide = {
  id: 'private-new-copy',
  title: 'Original (copy)',
  blocks: [{ type: 'markdown' as const, content: 'Copy' }],
};

beforeEach(() => localStorage.clear());

it('protects customized, malformed and unapplied JSON drafts but ignores an untouched editor', () => {
  expect(hasEditorDraft()).toBe(false);
  localStorage.setItem(
    StorageKeys.BLOCK_EDITOR_STATE,
    serializeEditorDraft({ guide: { id: 'new-guide', title: 'New guide', blocks: [] } })
  );
  expect(hasEditorDraft()).toBe(false);
  localStorage.setItem(StorageKeys.BLOCK_EDITOR_STATE, serializeEditorDraft({ guide }));
  expect(hasEditorDraft()).toBe(true);
  localStorage.setItem(StorageKeys.BLOCK_EDITOR_STATE, '{ malformed');
  expect(hasEditorDraft()).toBe(true);
});

it('replaces the working draft and detaches backend, recording and JSON state', () => {
  localStorage.setItem(
    StorageKeys.BLOCK_EDITOR_BACKEND_TRACKING,
    JSON.stringify({ resourceName: 'previous', lastPublishedJson: '{}' })
  );
  localStorage.setItem(StorageKeys.BLOCK_EDITOR_RECORDING_STATE, '{}');
  localStorage.setItem(
    StorageKeys.BLOCK_EDITOR_STATE,
    JSON.stringify({ guide, viewMode: 'json', jsonModeState: { json: 'bad' } })
  );
  replaceEditorDraft(guide);
  expect(JSON.parse(localStorage.getItem(StorageKeys.BLOCK_EDITOR_STATE)!)).toMatchObject({
    guide,
    viewMode: 'edit',
    version: 2,
  });
  expect(JSON.parse(localStorage.getItem(StorageKeys.BLOCK_EDITOR_STATE)!)).not.toHaveProperty('jsonModeState');
  expect(localStorage.getItem(StorageKeys.BLOCK_EDITOR_BACKEND_TRACKING)).toBeNull();
  expect(localStorage.getItem(StorageKeys.BLOCK_EDITOR_RECORDING_STATE)).toBeNull();
  expect(getEditorChromeStatus().publishedStatus).toBe('not-saved');
});

it('saves and publishes a new resource without targeting a previously edited private guide', async () => {
  localStorage.setItem(
    StorageKeys.BLOCK_EDITOR_BACKEND_TRACKING,
    JSON.stringify({ resourceName: 'previous', lastPublishedJson: '{}' })
  );
  replaceEditorDraft(guide);
  const backendGuides = {
    guides: [{ metadata: { name: 'previous' }, spec: { title: 'Previous', status: 'published' as const } }],
    saveGuide: jest.fn().mockResolvedValue(undefined),
    refreshGuides: jest.fn().mockResolvedValue([]),
    unpublishGuide: jest.fn(),
  };
  const { result } = renderHook(() => useBackendSaveFlow({ editor: { getGuide: () => guide }, backendGuides }));
  expect(result.current.publishedStatus).toBe('not-saved');
  expect(backendGuides.saveGuide).not.toHaveBeenCalled();
  await act(() => result.current.performSaveDraft());
  expect(backendGuides.saveGuide).toHaveBeenCalledWith(guide, undefined, undefined, 'draft', false);
  await act(() => result.current.handlePostToBackend());
  expect(backendGuides.saveGuide).toHaveBeenLastCalledWith(guide, guide.id, undefined, 'published', false);
});
