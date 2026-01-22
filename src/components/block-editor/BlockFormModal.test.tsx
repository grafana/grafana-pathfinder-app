/**
 * Tests for BlockFormModal type switch integration
 *
 * Tests focus on the type switch routing and confirmation flow.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BlockFormModal } from './BlockFormModal';
import type { ConversionWarning } from './forms/TypeSwitchDropdown';
import type { JsonMarkdownBlock } from '../../types/json-guide.types';

// Mock the form components to simplify testing
jest.mock('./forms/MarkdownBlockForm', () => ({
  MarkdownBlockForm: ({
    onSwitchBlockType,
    initialData,
  }: {
    onSwitchBlockType?: (type: string, warning?: ConversionWarning) => void;
    initialData?: { type: string };
  }) => (
    <div data-testid="markdown-form">
      <button data-testid="switch-no-warning" onClick={() => onSwitchBlockType?.('html')}>
        Switch to HTML (no warning)
      </button>
      <button
        data-testid="switch-with-warning"
        onClick={() =>
          onSwitchBlockType?.('image', {
            message: 'Converting will lose data',
            lostFields: ['someField'],
          })
        }
      >
        Switch to Image (with warning)
      </button>
    </div>
  ),
}));

jest.mock('./forms/HtmlBlockForm', () => ({
  HtmlBlockForm: () => <div data-testid="html-form">HTML Form</div>,
}));

jest.mock('./forms/ImageBlockForm', () => ({
  ImageBlockForm: () => <div data-testid="image-form">Image Form</div>,
}));

// Mock other form components to prevent import errors
jest.mock('./forms/VideoBlockForm', () => ({ VideoBlockForm: () => null }));
jest.mock('./forms/SectionBlockForm', () => ({ SectionBlockForm: () => null }));
jest.mock('./forms/ConditionalBlockForm', () => ({ ConditionalBlockForm: () => null }));
jest.mock('./forms/InteractiveBlockForm', () => ({ InteractiveBlockForm: () => null }));
jest.mock('./forms/MultistepBlockForm', () => ({ MultistepBlockForm: () => null }));
jest.mock('./forms/GuidedBlockForm', () => ({ GuidedBlockForm: () => null }));
jest.mock('./forms/QuizBlockForm', () => ({ QuizBlockForm: () => null }));
jest.mock('./forms/InputBlockForm', () => ({ InputBlockForm: () => null }));

// Mock ElementPicker and RecordModeOverlay
jest.mock('./ElementPicker', () => ({
  ElementPicker: () => null,
}));

jest.mock('./RecordModeOverlay', () => ({
  RecordModeOverlay: () => null,
}));

describe('BlockFormModal type switch integration', () => {
  const initialMarkdownBlock: JsonMarkdownBlock = { type: 'markdown', content: 'Test content' };

  const defaultProps = {
    blockType: 'markdown' as const,
    initialData: initialMarkdownBlock,
    onSubmit: jest.fn(),
    onCancel: jest.fn(),
    isEditing: true,
    onSwitchBlockType: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('handleTypeSwitchRequest routing', () => {
    it('calls onSwitchBlockType directly when no warning is provided', () => {
      render(<BlockFormModal {...defaultProps} />);

      // Click the switch button that doesn't provide a warning
      const switchButton = screen.getByTestId('switch-no-warning');
      fireEvent.click(switchButton);

      // Should call onSwitchBlockType directly
      expect(defaultProps.onSwitchBlockType).toHaveBeenCalledWith('html');
      expect(defaultProps.onSwitchBlockType).toHaveBeenCalledTimes(1);

      // Should not show confirmation modal
      expect(screen.queryByText('Converting will lose data')).not.toBeInTheDocument();
    });

    it('shows confirmation modal when warning is provided', () => {
      render(<BlockFormModal {...defaultProps} />);

      // Click the switch button that provides a warning
      const switchButton = screen.getByTestId('switch-with-warning');
      fireEvent.click(switchButton);

      // Should NOT call onSwitchBlockType yet
      expect(defaultProps.onSwitchBlockType).not.toHaveBeenCalled();

      // Should show the confirmation modal with warning message
      expect(screen.getByText('Converting will lose data')).toBeInTheDocument();
      expect(screen.getByText('someField')).toBeInTheDocument();
    });

    it('does not call onSwitchBlockType when onSwitchBlockType prop is not provided', () => {
      const propsWithoutSwitch = { ...defaultProps, onSwitchBlockType: undefined };
      render(<BlockFormModal {...propsWithoutSwitch} />);

      // Form should still render
      expect(screen.getByTestId('markdown-form')).toBeInTheDocument();
    });
  });

  describe('confirmation flow', () => {
    it('calls onSwitchBlockType and clears pending state when confirmed', async () => {
      render(<BlockFormModal {...defaultProps} />);

      // Trigger the warning flow
      fireEvent.click(screen.getByTestId('switch-with-warning'));

      // Verify confirmation modal is shown
      expect(screen.getByText('Converting will lose data')).toBeInTheDocument();

      // Click confirm button
      const confirmButton = screen.getByText('Convert anyway');
      fireEvent.click(confirmButton);

      // Wait for async state updates to complete
      await waitFor(() => {
        // Should call onSwitchBlockType with the pending type
        expect(defaultProps.onSwitchBlockType).toHaveBeenCalledWith('image');
      });
      expect(defaultProps.onSwitchBlockType).toHaveBeenCalledTimes(1);

      // Confirmation modal should be dismissed (warning message gone)
      await waitFor(() => {
        expect(screen.queryByText('Converting will lose data')).not.toBeInTheDocument();
      });
    });

    it('clears pending state without calling onSwitchBlockType when cancelled', async () => {
      render(<BlockFormModal {...defaultProps} />);

      // Trigger the warning flow
      fireEvent.click(screen.getByTestId('switch-with-warning'));

      // Verify confirmation modal is shown
      expect(screen.getByText('Converting will lose data')).toBeInTheDocument();

      // Click cancel button
      const cancelButton = screen.getByText('Cancel');
      fireEvent.click(cancelButton);

      // Wait for state updates and verify modal is dismissed
      await waitFor(() => {
        expect(screen.queryByText('Converting will lose data')).not.toBeInTheDocument();
      });

      // Should NOT call onSwitchBlockType
      expect(defaultProps.onSwitchBlockType).not.toHaveBeenCalled();
    });

    it('shows correct target type name in confirmation modal title', () => {
      render(<BlockFormModal {...defaultProps} />);

      // Trigger the warning flow
      fireEvent.click(screen.getByTestId('switch-with-warning'));

      // Modal title should include the target type name
      expect(screen.getByText(/Convert to Image\?/)).toBeInTheDocument();
    });

    it('displays all lost fields in the warning details', () => {
      // Mock with multiple lost fields
      jest.doMock('./forms/MarkdownBlockForm', () => ({
        MarkdownBlockForm: ({
          onSwitchBlockType,
        }: {
          onSwitchBlockType?: (type: string, warning?: ConversionWarning) => void;
        }) => (
          <button
            data-testid="switch-multiple-fields"
            onClick={() =>
              onSwitchBlockType?.('image', {
                message: 'Will lose multiple fields',
                lostFields: ['field1', 'field2', 'field3'],
              })
            }
          >
            Switch
          </button>
        ),
      }));

      render(<BlockFormModal {...defaultProps} />);

      // Trigger the warning flow
      fireEvent.click(screen.getByTestId('switch-with-warning'));

      // Should show the lost field
      expect(screen.getByText('someField')).toBeInTheDocument();
    });
  });

  describe('modal state management', () => {
    it('maintains pending state correctly through re-renders', () => {
      const { rerender } = render(<BlockFormModal {...defaultProps} />);

      // Trigger the warning flow
      fireEvent.click(screen.getByTestId('switch-with-warning'));

      // Verify pending state is set
      expect(screen.getByText('Converting will lose data')).toBeInTheDocument();

      // Re-render with same props
      rerender(<BlockFormModal {...defaultProps} />);

      // Pending state should still be visible
      expect(screen.getByText('Converting will lose data')).toBeInTheDocument();
    });
  });
});
