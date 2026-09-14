import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { BlockEditorContent, type BlockEditorContentProps } from './BlockEditorContent';
import type { BlockOperations, JsonGuide } from './types';
import { testIds } from '../../constants/testIds';

jest.mock('./BlockList', () => ({ BlockList: () => <div data-testid="mock-block-list" /> }));
jest.mock('./BlockPreview', () => ({ BlockPreview: () => <div data-testid="mock-block-preview" /> }));
jest.mock('./BlockJsonEditor', () => ({ BlockJsonEditor: () => <div data-testid="mock-json-editor" /> }));
jest.mock('./NotificationModals', () => ({
  ConfirmModal: ({
    isOpen,
    title,
    message,
    confirmText = 'OK',
    cancelText = 'Cancel',
    onConfirm,
    onCancel,
  }: {
    isOpen: boolean;
    title: string;
    message: React.ReactNode;
    confirmText?: string;
    cancelText?: string;
    onConfirm: () => void;
    onCancel: () => void;
  }) =>
    isOpen ? (
      <div role="dialog">
        <h1>{title}</h1>
        <div>{message}</div>
        <button onClick={onCancel}>{cancelText}</button>
        <button onClick={onConfirm}>{confirmText}</button>
      </div>
    ) : null,
}));

const guide: JsonGuide = { id: 'guide', title: 'Guide', blocks: [] };
const styles = {
  content: 'content',
  selectionControls: 'selection-controls',
  selectionCount: 'selection-count',
  emptyState: 'empty-state',
  emptyStateIcon: 'empty-state-icon',
  emptyStateText: 'empty-state-text',
  blockPreviewContainer: 'block-preview-container',
};

function operations(selectedBlockIds: Set<string>): BlockOperations {
  return {
    isSelectionMode: true,
    selectedBlockIds,
  } as BlockOperations;
}

function renderContent(
  selectedBlockIds: Set<string>,
  overrides: Partial<
    Pick<BlockEditorContentProps, 'canMergeSelection' | 'onDeleteSelected' | 'onMergeToMultistep' | 'onMergeToGuided'>
  > = {}
) {
  const props: BlockEditorContentProps = {
    viewMode: 'edit',
    blocks: [{ id: 'one', block: { type: 'markdown', content: 'one' } }],
    guide,
    operations: operations(selectedBlockIds),
    hasBlocks: true,
    styles,
    onMergeToMultistep: jest.fn(),
    onMergeToGuided: jest.fn(),
    canMergeSelection: false,
    onDeleteSelected: jest.fn(),
    onClearSelection: jest.fn(),
    onLoadTemplate: jest.fn(),
    onOpenTour: jest.fn(),
    jsonModeState: null,
    onJsonChange: jest.fn(),
    jsonValidationErrors: [],
    isJsonValid: true,
    ...overrides,
  };
  return render(<BlockEditorContent {...props} />);
}

describe('BlockEditorContent selection toolbar', () => {
  it('offers a confirmed bulk delete for one selected block', () => {
    const onDeleteSelected = jest.fn();
    renderContent(new Set(['one']), { onDeleteSelected });

    fireEvent.click(screen.getByTestId(testIds.blockEditor.bulkDeleteButton));
    expect(screen.getByRole('dialog')).toHaveTextContent('You can undo this as one change.');

    fireEvent.click(screen.getByRole('button', { name: /^Delete$/ }));
    expect(onDeleteSelected).toHaveBeenCalledTimes(1);
  });

  it('keeps merge actions disabled when the selection includes an ineligible block', () => {
    const onMergeToMultistep = jest.fn();
    const onMergeToGuided = jest.fn();
    renderContent(new Set(['one', 'two']), { canMergeSelection: false, onMergeToMultistep, onMergeToGuided });

    const multistepButton = screen.getByTestId(testIds.blockEditor.mergeMultistepButton);
    const guidedButton = screen.getByTestId(testIds.blockEditor.mergeGuidedButton);
    expect(multistepButton).toHaveAttribute('aria-disabled', 'true');
    expect(guidedButton).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(multistepButton);
    fireEvent.click(guidedButton);
    expect(onMergeToMultistep).not.toHaveBeenCalled();
    expect(onMergeToGuided).not.toHaveBeenCalled();
    expect(screen.getByTestId(testIds.blockEditor.bulkDeleteButton)).toHaveTextContent('Delete 2 blocks');
  });

  it('enables merge actions for an eligible selection while retaining bulk delete', () => {
    renderContent(new Set(['one', 'two']), { canMergeSelection: true });

    expect(screen.getByTestId(testIds.blockEditor.mergeMultistepButton)).toBeEnabled();
    expect(screen.getByTestId(testIds.blockEditor.mergeGuidedButton)).toBeEnabled();
    expect(screen.getByTestId(testIds.blockEditor.bulkDeleteButton)).toBeInTheDocument();
  });
});
