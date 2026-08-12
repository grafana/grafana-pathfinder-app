/**
 * Tests for the status shared by the editor header badge and the tab strip.
 */

import {
  editorStatusBadge,
  editorTabStatusBadge,
  getEditorChromeStatus,
  getEditorChromeStatusVersion,
  publishEditorChromeStatus,
  resetEditorChromeStatus,
  subscribeEditorChromeStatus,
} from './editor-chrome-status';

const GUIDE = { id: 'g', title: 'My Guide', blocks: [{ type: 'markdown', content: 'hi' }] };

function persist(tracking: Record<string, unknown>, guide: unknown = GUIDE) {
  localStorage.setItem('pathfinder-block-editor-state', JSON.stringify({ guide }));
  localStorage.setItem('pathfinder-block-editor-backend-tracking', JSON.stringify(tracking));
}

beforeEach(() => {
  localStorage.clear();
  resetEditorChromeStatus();
});

describe('badge derivation', () => {
  it('labels the header badge by publish state and dirtiness', () => {
    expect(editorStatusBadge({ publishedStatus: 'not-saved', hasUnsyncedChanges: false }).text).toBe('Draft');
    expect(editorStatusBadge({ publishedStatus: 'draft', hasUnsyncedChanges: true }).text).toBe('Draft (modified)');
    expect(editorStatusBadge({ publishedStatus: 'published', hasUnsyncedChanges: false }).text).toBe('Published');
    expect(editorStatusBadge({ publishedStatus: 'published', hasUnsyncedChanges: true }).text).toBe(
      'Published (modified)'
    );
  });

  it('drops the "(modified)" suffix for the strip, which italicizes the title instead', () => {
    expect(editorTabStatusBadge({ publishedStatus: 'draft', hasUnsyncedChanges: true })).toEqual({
      text: 'Draft',
      color: 'blue',
      tooltip: 'Draft has unsaved changes',
    });
    expect(editorTabStatusBadge({ publishedStatus: 'published', hasUnsyncedChanges: true }).text).toBe('Published');
  });
});

describe('published status', () => {
  it('prefers what the mounted editor published over persisted state', () => {
    persist({ resourceName: 'g', backendStatus: 'published', lastPublishedJson: JSON.stringify(GUIDE) });

    publishEditorChromeStatus({ publishedStatus: 'draft', hasUnsyncedChanges: true });

    expect(getEditorChromeStatus()).toEqual({ publishedStatus: 'draft', hasUnsyncedChanges: true });
  });

  it('notifies subscribers only when the status actually changes', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeEditorChromeStatus(listener);

    publishEditorChromeStatus({ publishedStatus: 'draft', hasUnsyncedChanges: false });
    const versionAfterFirst = getEditorChromeStatusVersion();
    publishEditorChromeStatus({ publishedStatus: 'draft', hasUnsyncedChanges: false });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(getEditorChromeStatusVersion()).toBe(versionAfterFirst);

    unsubscribe();
    publishEditorChromeStatus({ publishedStatus: 'published', hasUnsyncedChanges: false });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('persisted fallback', () => {
  it('reads not-saved when no backend tracking exists', () => {
    expect(getEditorChromeStatus()).toEqual({ publishedStatus: 'not-saved', hasUnsyncedChanges: false });
  });

  it('reports the persisted publish state when the draft matches the last save', () => {
    persist({ resourceName: 'g', backendStatus: 'published', lastPublishedJson: JSON.stringify(GUIDE) });

    expect(getEditorChromeStatus()).toEqual({ publishedStatus: 'published', hasUnsyncedChanges: false });
  });

  it('flags unsynced changes when the persisted draft has diverged', () => {
    persist(
      { resourceName: 'g', backendStatus: 'draft', lastPublishedJson: JSON.stringify(GUIDE) },
      { ...GUIDE, title: 'Renamed' }
    );

    expect(getEditorChromeStatus()).toEqual({ publishedStatus: 'draft', hasUnsyncedChanges: true });
  });

  it('treats a missing sync baseline as clean rather than guessing', () => {
    persist({ resourceName: 'g', backendStatus: 'draft' });

    expect(getEditorChromeStatus()).toEqual({ publishedStatus: 'draft', hasUnsyncedChanges: false });
  });

  it('flags a tracked guide with no local draft, since the editor opens empty', () => {
    localStorage.setItem(
      'pathfinder-block-editor-backend-tracking',
      JSON.stringify({ resourceName: 'g', backendStatus: 'published', lastPublishedJson: JSON.stringify(GUIDE) })
    );

    expect(getEditorChromeStatus()).toEqual({ publishedStatus: 'published', hasUnsyncedChanges: true });
  });

  it('ignores malformed tracking data', () => {
    localStorage.setItem('pathfinder-block-editor-backend-tracking', 'not json');

    expect(getEditorChromeStatus()).toEqual({ publishedStatus: 'not-saved', hasUnsyncedChanges: false });
  });
});
