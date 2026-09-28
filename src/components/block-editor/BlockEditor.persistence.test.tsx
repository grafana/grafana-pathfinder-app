import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { testIds } from '../../constants/testIds';
import { StorageKeys } from '../../lib/storage-keys';
import type { JsonGuide } from './types';
import { BlockEditor } from './BlockEditor';

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
    render(<BlockEditor />);

    fireEvent.click(screen.getByRole('radio', { name: 'Preview' }));

    expect(screen.queryByTestId(testIds.blockEditor.palette)).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(StorageKeys.BLOCK_EDITOR_STATE)!).viewMode).toBe('preview');
  });

  it('restores preview mode after a remount', () => {
    const { unmount } = render(<BlockEditor />);

    fireEvent.click(screen.getByRole('radio', { name: 'Preview' }));
    unmount();
    render(<BlockEditor />);

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
      StorageKeys.BLOCK_EDITOR_STATE,
      JSON.stringify({
        guide,
        blockIds: [],
        viewMode: 'json',
        jsonModeState,
        savedAt: new Date().toISOString(),
        version: 2,
      })
    );

    render(<BlockEditor />);

    expect(screen.getByTestId(testIds.blockEditor.jsonEditor)).toHaveTextContent(jsonModeState.json);
    expect(screen.getByTestId(testIds.blockEditor.jsonEditor)).toHaveAttribute('data-json-valid', 'false');
    expect(screen.getByTestId(testIds.blockEditor.jsonEditor)).toHaveAttribute('data-can-undo', 'true');
  });

  it('persists a confirmed multi-selection delete and restores it with undo', async () => {
    const guide: JsonGuide = {
      id: 'bulk-delete-guide',
      title: 'Bulk delete guide',
      blocks: [
        { type: 'markdown', content: 'first' },
        { type: 'markdown', content: 'second' },
        { type: 'markdown', content: 'keep' },
      ],
    };
    const { container } = render(<BlockEditor initialGuide={guide} />);

    fireEvent.click(screen.getByTestId(testIds.blockEditor.moreActionsButton));
    fireEvent.click(screen.getByTestId(testIds.blockEditor.toggleSelectionButton));
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]!);
    fireEvent.click(checkboxes[1]!);
    fireEvent.click(screen.getByTestId(testIds.blockEditor.bulkDeleteButton));
    fireEvent.click(screen.getByRole('button', { name: /^Delete$/ }));

    expect(container.querySelectorAll('[data-block-card]')).toHaveLength(1);
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    await waitFor(
      () => {
        const stored = JSON.parse(localStorage.getItem(StorageKeys.BLOCK_EDITOR_STATE)!);
        expect(stored.guide.blocks).toEqual([{ type: 'markdown', content: 'keep' }]);
      },
      { timeout: 3_000 }
    );

    fireEvent.click(screen.getByRole('button', { name: 'Undo: Delete 2 blocks' }));
    expect(container.querySelectorAll('[data-block-card]')).toHaveLength(3);
    await waitFor(
      () => {
        const stored = JSON.parse(localStorage.getItem(StorageKeys.BLOCK_EDITOR_STATE)!);
        expect(stored.guide.blocks).toEqual(guide.blocks);
      },
      { timeout: 3_000 }
    );
  });
});
