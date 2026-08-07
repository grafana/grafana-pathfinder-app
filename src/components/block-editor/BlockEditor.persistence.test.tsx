import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import { testIds } from '../../constants/testIds';
import type { JsonGuide } from './types';
import { editorTabStorageKey } from './editor-tab-storage';
import { BlockEditor } from './BlockEditor';
import blockEditorTutorial from '../../bundled-interactives/block-editor-tutorial/content.json';

const STORAGE_KEY = editorTabStorageKey('test-tab');

jest.mock('./BlockJsonEditor', () => {
  const React = jest.requireActual<typeof import('react')>('react');

  return {
    BlockJsonEditor: ({ jsonText, isValid, canUndo }: import('./types').BlockJsonEditorProps) =>
      React.createElement(
        'div',
        {
          'data-testid': 'block-editor-json-editor',
          'data-json-valid': String(isValid),
          'data-can-undo': String(Boolean(canUndo)),
        },
        jsonText
      ),
  };
});

describe('BlockEditor persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('writes preview mode immediately when selected', () => {
    render(<BlockEditor storageKey={STORAGE_KEY} />);

    fireEvent.click(screen.getByRole('radio', { name: 'Preview' }));

    expect(screen.queryByTestId(testIds.blockEditor.palette)).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).viewMode).toBe('preview');
  });

  it('persists a unique, unlocked ID for a new local guide', () => {
    const { unmount } = render(<BlockEditor storageKey={STORAGE_KEY} />);
    unmount();

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored.guide.id).toMatch(/^new-guide-[a-z0-9]+$/);
    expect(stored.idIsFinalized).toBe(false);
  });

  it('locks a title-derived ID after the first title commit', () => {
    const { unmount } = render(<BlockEditor storageKey={STORAGE_KEY} />);
    const title = screen.getByRole('textbox', { name: 'Guide title' });

    fireEvent.change(title, { target: { value: 'My useful guide' } });
    fireEvent.blur(title);
    unmount();

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored.guide.id).toMatch(/^my-useful-guide-[a-z0-9]+$/);
    expect(stored.idIsFinalized).toBe(true);
  });

  it('remints the bundled template ID for the local draft', () => {
    const { unmount } = render(<BlockEditor storageKey={STORAGE_KEY} />);

    fireEvent.click(screen.getByTestId(testIds.blockEditor.loadTemplateButton));
    unmount();

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored.guide.id).not.toBe(blockEditorTutorial.id);
    expect(stored.idIsFinalized).toBe(false);
  });

  it('restores preview mode after a remount', () => {
    const { unmount } = render(<BlockEditor storageKey={STORAGE_KEY} />);

    fireEvent.click(screen.getByRole('radio', { name: 'Preview' }));
    unmount();
    render(<BlockEditor storageKey={STORAGE_KEY} />);

    expect(screen.queryByTestId(testIds.blockEditor.palette)).not.toBeInTheDocument();
  });

  it('restores the exact unapplied JSON draft after a remount', () => {
    const guide: JsonGuide = { id: 'restored-guide', title: 'Restored guide', blocks: [] };
    const jsonModeState = {
      json: '{ invalid',
      originalBlockIds: [],
      originalJson: JSON.stringify(guide, null, 2),
    };
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        guide,
        blockIds: [],
        viewMode: 'json',
        jsonModeState,
        savedAt: new Date().toISOString(),
        version: 2,
      })
    );

    render(<BlockEditor storageKey={STORAGE_KEY} />);

    expect(screen.getByTestId(testIds.blockEditor.jsonEditor)).toHaveTextContent(jsonModeState.json);
    expect(screen.getByTestId(testIds.blockEditor.jsonEditor)).toHaveAttribute('data-json-valid', 'false');
    expect(screen.getByTestId(testIds.blockEditor.jsonEditor)).toHaveAttribute('data-can-undo', 'true');
  });

  it('does not publish the default title before restoring a saved guide', () => {
    const onGuideTitleChange = jest.fn();
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        guide: { id: 'restored-guide', title: 'Restored guide', blocks: [] },
      })
    );

    render(<BlockEditor storageKey={STORAGE_KEY} onGuideTitleChange={onGuideTitleChange} />);

    expect(onGuideTitleChange).toHaveBeenCalledWith('Restored guide');
    expect(onGuideTitleChange).not.toHaveBeenCalledWith('New guide');
  });
});
