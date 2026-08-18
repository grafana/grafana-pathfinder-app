/**
 * The editor tab's strip title and badge are owned by the docs panel, which
 * renders outside this component. These cover the two channels that keep them
 * in sync: the `onGuideTitleChange` callback and the published chrome status.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import { StorageKeys } from '../../lib/storage-keys';
import type { JsonGuide } from './types';
import { BlockEditor } from './BlockEditor';
import { DEFAULT_GUIDE_METADATA } from './constants';
import {
  getEditorChromeStatus,
  resetEditorChromeStatus,
  subscribeEditorChromeStatus,
  type EditorChromeStatus,
} from './editor-chrome-status';

function storeGuide(guide: JsonGuide) {
  localStorage.setItem(
    StorageKeys.BLOCK_EDITOR_STATE,
    JSON.stringify({ guide, blockIds: [], savedAt: new Date().toISOString(), version: 2 })
  );
}

describe('BlockEditor tab chrome', () => {
  beforeEach(() => {
    localStorage.clear();
    resetEditorChromeStatus();
  });

  it('reports the working guide title on mount and after a rename', () => {
    const onGuideTitleChange = jest.fn();
    render(<BlockEditor onGuideTitleChange={onGuideTitleChange} />);

    expect(onGuideTitleChange).toHaveBeenCalledWith(DEFAULT_GUIDE_METADATA.title);

    const titleInput = screen.getByLabelText('Guide title');
    fireEvent.change(titleInput, { target: { value: 'Renamed guide' } });
    fireEvent.blur(titleInput);

    expect(onGuideTitleChange).toHaveBeenLastCalledWith('Renamed guide');
  });

  it.each(['Restored guide', DEFAULT_GUIDE_METADATA.title])(
    'reports the restored title without publishing the pre-restore default first: %s',
    (title) => {
      storeGuide({ id: 'restored-guide', title, blocks: [] });
      const onGuideTitleChange = jest.fn();

      render(<BlockEditor onGuideTitleChange={onGuideTitleChange} />);

      expect(onGuideTitleChange).toHaveBeenCalledTimes(1);
      expect(onGuideTitleChange).toHaveBeenCalledWith(title);
    }
  );

  it('still reports chrome when a malformed stored draft fails to restore', () => {
    localStorage.setItem(
      StorageKeys.BLOCK_EDITOR_STATE,
      JSON.stringify({ guide: { id: 'broken-guide', title: 'Broken guide' }, version: 2 })
    );
    const onGuideTitleChange = jest.fn();

    render(<BlockEditor onGuideTitleChange={onGuideTitleChange} />);

    expect(onGuideTitleChange).toHaveBeenCalledWith(DEFAULT_GUIDE_METADATA.title);
  });

  it('never publishes a dirty status from the pre-restore default guide', () => {
    const guide: JsonGuide = { id: 'tracked-guide', title: 'Tracked guide', blocks: [] };
    storeGuide(guide);
    localStorage.setItem(
      StorageKeys.BLOCK_EDITOR_BACKEND_TRACKING,
      JSON.stringify({
        resourceName: 'tracked-guide',
        backendStatus: 'draft',
        lastPublishedJson: JSON.stringify(guide),
      })
    );
    const published: EditorChromeStatus[] = [];
    const unsubscribe = subscribeEditorChromeStatus(() => published.push(getEditorChromeStatus()));

    render(<BlockEditor />);
    unsubscribe();

    expect(published.every((s) => !s.hasUnsyncedChanges)).toBe(true);
  });

  it('publishes an unsaved guide as not-saved so the strip badge reads Draft', () => {
    render(<BlockEditor />);

    expect(getEditorChromeStatus()).toEqual({ publishedStatus: 'not-saved', hasUnsyncedChanges: false });
  });

  it('wakes the strip after the unmount draft flush, not before', () => {
    const guide: JsonGuide = { id: 'tracked-guide', title: 'Tracked guide', blocks: [] };
    storeGuide(guide);
    localStorage.setItem(
      StorageKeys.BLOCK_EDITOR_BACKEND_TRACKING,
      JSON.stringify({
        resourceName: 'tracked-guide',
        backendStatus: 'draft',
        lastPublishedJson: JSON.stringify(guide),
      })
    );
    const { unmount } = render(<BlockEditor />);

    const titleInput = screen.getByLabelText('Guide title');
    fireEvent.change(titleInput, { target: { value: 'Renamed guide' } });
    fireEvent.blur(titleInput);

    // The rename is still inside the auto-save debounce, so only the unmount
    // flush can put it in storage before subscribers read the fallback.
    const seen: EditorChromeStatus[] = [];
    const unsubscribe = subscribeEditorChromeStatus(() => seen.push(getEditorChromeStatus()));
    unmount();
    unsubscribe();

    expect(seen[seen.length - 1]).toEqual({ publishedStatus: 'draft', hasUnsyncedChanges: true });
  });
});
