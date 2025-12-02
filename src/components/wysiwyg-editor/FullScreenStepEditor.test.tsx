/**
 * Tests for FullScreenStepEditor component
 * Tests create mode, edit mode, selector capture, and nested steps functionality
 */

import React from 'react';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { FullScreenStepEditor, type EditElementData, type NestedStepData } from './FullScreenStepEditor';
import type { PendingClickInfo } from './hooks/useFullScreenMode';
import { ACTION_TYPES } from '../../constants/interactive-config';
import { testIds } from '../testIds';

// Mock the selector capture hook
const mockStartCapture = jest.fn();
const mockStopCapture = jest.fn();
let mockIsActive = false;

jest.mock('./devtools/selector-capture.hook', () => ({
  useSelectorCapture: jest.fn(() => ({
    isActive: mockIsActive,
    startCapture: mockStartCapture,
    stopCapture: mockStopCapture,
    capturedSelector: null,
    selectorInfo: null,
    hoveredElement: null,
    domPath: null,
    cursorPosition: null,
  })),
}));

// Mock DomPathTooltip
jest.mock('../DomPathTooltip/DomPathTooltip', () => ({
  DomPathTooltip: () => null,
}));

describe('FullScreenStepEditor', () => {
  const mockOnSaveAndClick = jest.fn();
  const mockOnSkip = jest.fn();
  const mockOnSaveEdit = jest.fn();
  const mockOnDelete = jest.fn();
  const mockOnCancel = jest.fn();
  const mockOnConfirmBundling = jest.fn();

  // Create mock HTML element and event for PendingClickInfo
  const mockElement = document.createElement('button');
  const mockEvent = new MouseEvent('click') as MouseEvent;

  const defaultPendingClick: PendingClickInfo = {
    element: mockElement,
    event: mockEvent,
    selector: 'button[data-testid="save"]',
    action: ACTION_TYPES.HIGHLIGHT,
    description: 'Save button',
    selectorInfo: {
      method: 'testid',
      isUnique: true,
      matchCount: 1,
      contextStrategy: 'testid',
    },
    warnings: [],
  };

  const defaultEditData: EditElementData = {
    type: 'listItem' as const,
    attributes: {
      'data-targetaction': ACTION_TYPES.HIGHLIGHT,
      'data-reftarget': 'button.edit',
      'data-requirements': 'exists-reftarget',
    },
    pos: 10,
    textContent: 'Click the edit button',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockIsActive = false;
  });

  afterEach(() => {
    cleanup();
  });

  describe('Create Mode', () => {
    it('should render modal in create mode with pending click', async () => {
      await act(async () => {
        render(
          <FullScreenStepEditor
            isOpen={true}
            pendingClick={defaultPendingClick}
            onSaveAndClick={mockOnSaveAndClick}
            onSkip={mockOnSkip}
            onCancel={mockOnCancel}
          />
        );
      });

      await waitFor(() => {
        // Modal renders with role="dialog"
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });
    });

    it('should display detected selector in input field', async () => {
      await act(async () => {
        render(
          <FullScreenStepEditor
            isOpen={true}
            pendingClick={defaultPendingClick}
            onSaveAndClick={mockOnSaveAndClick}
            onSkip={mockOnSkip}
            onCancel={mockOnCancel}
          />
        );
      });

      await waitFor(() => {
        // Find the input in the selector box
        const selectorInput = screen.getByPlaceholderText('CSS selector or element reference');
        expect(selectorInput).toHaveValue(defaultPendingClick.selector);
      });
    });

    it('should render selector capture button in create mode', async () => {
      await act(async () => {
        render(
          <FullScreenStepEditor
            isOpen={true}
            pendingClick={defaultPendingClick}
            onSaveAndClick={mockOnSaveAndClick}
            onSkip={mockOnSkip}
            onCancel={mockOnCancel}
          />
        );
      });

      await waitFor(() => {
        const captureButton = screen.getByTestId(testIds.wysiwygEditor.fullScreen.stepEditor.selectorCaptureButton);
        expect(captureButton).toBeInTheDocument();
      });
    });

    it('should allow editing the selector in create mode', async () => {
      await act(async () => {
        render(
          <FullScreenStepEditor
            isOpen={true}
            pendingClick={defaultPendingClick}
            onSaveAndClick={mockOnSaveAndClick}
            onSkip={mockOnSkip}
            onCancel={mockOnCancel}
          />
        );
      });

      await waitFor(() => {
        const selectorInput = screen.getByPlaceholderText('CSS selector or element reference');
        expect(selectorInput).toBeInTheDocument();
      });

      const selectorInput = screen.getByPlaceholderText('CSS selector or element reference');
      await act(async () => {
        fireEvent.change(selectorInput, { target: { value: 'button.new-selector' } });
      });
      expect(selectorInput).toHaveValue('button.new-selector');
    });

    it('should include edited selector in save data', async () => {
      await act(async () => {
        render(
          <FullScreenStepEditor
            isOpen={true}
            pendingClick={defaultPendingClick}
            onSaveAndClick={mockOnSaveAndClick}
            onSkip={mockOnSkip}
            onCancel={mockOnCancel}
          />
        );
      });

      await waitFor(() => {
        expect(screen.getByPlaceholderText('CSS selector or element reference')).toBeInTheDocument();
      });

      // Edit the selector
      const selectorInput = screen.getByPlaceholderText('CSS selector or element reference');
      await act(async () => {
        fireEvent.change(selectorInput, { target: { value: 'button.custom-selector' } });
      });

      // Fill in required description
      const descriptionInput = screen.getByTestId(testIds.wysiwygEditor.fullScreen.stepEditor.descriptionInput);
      await act(async () => {
        fireEvent.change(descriptionInput, { target: { value: 'Test description' } });
      });

      // Click save
      const saveButton = screen.getByTestId(testIds.wysiwygEditor.fullScreen.stepEditor.saveButton);
      await act(async () => {
        fireEvent.click(saveButton);
      });

      // Verify the edited selector is passed
      expect(mockOnSaveAndClick).toHaveBeenCalledWith(
        expect.objectContaining({
          selector: 'button.custom-selector',
          description: 'Test description',
        })
      );
    });

    it('should call onSkip when skip button is clicked', async () => {
      await act(async () => {
        render(
          <FullScreenStepEditor
            isOpen={true}
            pendingClick={defaultPendingClick}
            onSaveAndClick={mockOnSaveAndClick}
            onSkip={mockOnSkip}
            onCancel={mockOnCancel}
          />
        );
      });

      await waitFor(() => {
        expect(screen.getByTestId(testIds.wysiwygEditor.fullScreen.stepEditor.skipButton)).toBeInTheDocument();
      });

      const skipButton = screen.getByTestId(testIds.wysiwygEditor.fullScreen.stepEditor.skipButton);
      await act(async () => {
        fireEvent.click(skipButton);
      });

      expect(mockOnSkip).toHaveBeenCalledTimes(1);
    });
  });

  describe('Edit Mode', () => {
    it('should render modal in edit mode with edit data', async () => {
      await act(async () => {
        render(
          <FullScreenStepEditor
            isOpen={true}
            editData={defaultEditData}
            onSaveEdit={mockOnSaveEdit}
            onDelete={mockOnDelete}
            onCancel={mockOnCancel}
          />
        );
      });

      await waitFor(() => {
        // Modal renders with role="dialog"
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });
    });

    it('should render selector capture button in edit mode', async () => {
      await act(async () => {
        render(
          <FullScreenStepEditor
            isOpen={true}
            editData={defaultEditData}
            onSaveEdit={mockOnSaveEdit}
            onDelete={mockOnDelete}
            onCancel={mockOnCancel}
          />
        );
      });

      await waitFor(() => {
        const captureButton = screen.getByTestId(testIds.wysiwygEditor.fullScreen.stepEditor.selectorCaptureButton);
        expect(captureButton).toBeInTheDocument();
      });
    });

    it('should pre-fill form with existing attributes', async () => {
      await act(async () => {
        render(
          <FullScreenStepEditor
            isOpen={true}
            editData={defaultEditData}
            onSaveEdit={mockOnSaveEdit}
            onDelete={mockOnDelete}
            onCancel={mockOnCancel}
          />
        );
      });

      await waitFor(() => {
        const selectorInput = screen.getByPlaceholderText('CSS selector or element reference');
        expect(selectorInput).toHaveValue(defaultEditData.attributes['data-reftarget']);

        const requirementsInput = screen.getByTestId(testIds.wysiwygEditor.fullScreen.stepEditor.requirementsInput);
        expect(requirementsInput).toHaveValue(defaultEditData.attributes['data-requirements']);
      });
    });

    it('should call onSaveEdit with updated data when save is clicked', async () => {
      await act(async () => {
        render(
          <FullScreenStepEditor
            isOpen={true}
            editData={defaultEditData}
            onSaveEdit={mockOnSaveEdit}
            onDelete={mockOnDelete}
            onCancel={mockOnCancel}
          />
        );
      });

      await waitFor(() => {
        expect(screen.getByPlaceholderText('CSS selector or element reference')).toBeInTheDocument();
      });

      // Modify the selector
      const selectorInput = screen.getByPlaceholderText('CSS selector or element reference');
      await act(async () => {
        fireEvent.change(selectorInput, { target: { value: 'button.updated' } });
      });

      // Click save
      const saveButton = screen.getByTestId(testIds.wysiwygEditor.fullScreen.stepEditor.saveButton);
      await act(async () => {
        fireEvent.click(saveButton);
      });

      expect(mockOnSaveEdit).toHaveBeenCalledWith(
        expect.objectContaining({
          refTarget: 'button.updated',
          actionType: ACTION_TYPES.HIGHLIGHT,
        })
      );
    });

    it('should call onDelete when delete button is clicked', async () => {
      await act(async () => {
        render(
          <FullScreenStepEditor
            isOpen={true}
            editData={defaultEditData}
            onSaveEdit={mockOnSaveEdit}
            onDelete={mockOnDelete}
            onCancel={mockOnCancel}
          />
        );
      });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();
      });

      const deleteButton = screen.getByRole('button', { name: /delete/i });
      await act(async () => {
        fireEvent.click(deleteButton);
      });

      expect(mockOnDelete).toHaveBeenCalledTimes(1);
    });
  });

  describe('Edit Mode with Nested Steps', () => {
    const nestedSteps: NestedStepData[] = [
      {
        actionType: ACTION_TYPES.HIGHLIGHT,
        refTarget: 'button.step1',
        requirements: 'exists-reftarget',
        interactiveComment: 'First step comment',
      },
      {
        actionType: ACTION_TYPES.BUTTON,
        refTarget: 'button.step2',
        targetValue: 'Click me',
      },
    ];

    const multistepEditData: EditElementData = {
      type: 'listItem' as const,
      attributes: {
        'data-targetaction': ACTION_TYPES.MULTISTEP,
        'data-requirements': '',
      },
      pos: 10,
      textContent: 'Follow these steps',
      nestedSteps,
    };

    it('should display nested steps in edit mode for multistep', async () => {
      await act(async () => {
        render(
          <FullScreenStepEditor
            isOpen={true}
            editData={multistepEditData}
            onSaveEdit={mockOnSaveEdit}
            onDelete={mockOnDelete}
            onCancel={mockOnCancel}
          />
        );
      });

      await waitFor(() => {
        // Should show nested steps section
        expect(screen.getByText('Steps (2)')).toBeInTheDocument();
      });
    });

    it('should include nested steps in save data', async () => {
      await act(async () => {
        render(
          <FullScreenStepEditor
            isOpen={true}
            editData={multistepEditData}
            onSaveEdit={mockOnSaveEdit}
            onDelete={mockOnDelete}
            onCancel={mockOnCancel}
          />
        );
      });

      await waitFor(() => {
        expect(screen.getByTestId(testIds.wysiwygEditor.fullScreen.stepEditor.saveButton)).toBeInTheDocument();
      });

      // Click save
      const saveButton = screen.getByTestId(testIds.wysiwygEditor.fullScreen.stepEditor.saveButton);
      await act(async () => {
        fireEvent.click(saveButton);
      });

      expect(mockOnSaveEdit).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: ACTION_TYPES.MULTISTEP,
          nestedSteps: expect.arrayContaining([
            expect.objectContaining({
              actionType: ACTION_TYPES.HIGHLIGHT,
              refTarget: 'button.step1',
              interactiveComment: 'First step comment',
            }),
            expect.objectContaining({
              actionType: ACTION_TYPES.BUTTON,
              refTarget: 'button.step2',
            }),
          ]),
        })
      );
    });
  });

  describe('Bundling Review Mode', () => {
    const bundledNestedSteps: NestedStepData[] = [
      {
        actionType: ACTION_TYPES.HIGHLIGHT,
        refTarget: 'a[href="/admin"]',
        textContent: 'Click admin link',
      },
      {
        actionType: ACTION_TYPES.BUTTON,
        refTarget: 'button.submit',
        textContent: 'Submit form',
      },
    ];

    it('should render in bundling review mode', async () => {
      await act(async () => {
        render(
          <FullScreenStepEditor
            isOpen={true}
            isBundlingReview={true}
            bundlingActionType={ACTION_TYPES.MULTISTEP}
            bundledNestedSteps={bundledNestedSteps}
            onConfirmBundling={mockOnConfirmBundling}
            onCancel={mockOnCancel}
          />
        );
      });

      await waitFor(() => {
        expect(screen.getByText(/Review.*Recorded Steps/i)).toBeInTheDocument();
      });
    });

    it('should call onConfirmBundling with steps when confirmed', async () => {
      await act(async () => {
        render(
          <FullScreenStepEditor
            isOpen={true}
            isBundlingReview={true}
            bundlingActionType={ACTION_TYPES.MULTISTEP}
            bundledNestedSteps={bundledNestedSteps}
            onConfirmBundling={mockOnConfirmBundling}
            onCancel={mockOnCancel}
          />
        );
      });

      await waitFor(() => {
        expect(screen.getByTestId(testIds.wysiwygEditor.fullScreen.stepEditor.descriptionInput)).toBeInTheDocument();
      });

      // Fill description (required)
      const descriptionInput = screen.getByTestId(testIds.wysiwygEditor.fullScreen.stepEditor.descriptionInput);
      await act(async () => {
        fireEvent.change(descriptionInput, { target: { value: 'Complete the flow' } });
      });

      // Click create button
      const createButton = screen.getByTestId(testIds.wysiwygEditor.fullScreen.stepEditor.saveButton);
      await act(async () => {
        fireEvent.click(createButton);
      });

      expect(mockOnConfirmBundling).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Complete the flow',
          actionType: ACTION_TYPES.MULTISTEP,
        }),
        expect.arrayContaining([
          expect.objectContaining({ refTarget: 'a[href="/admin"]' }),
          expect.objectContaining({ refTarget: 'button.submit' }),
        ])
      );
    });
  });

  describe('Cancel behavior', () => {
    it('should call onCancel when cancel button is clicked', async () => {
      await act(async () => {
        render(
          <FullScreenStepEditor
            isOpen={true}
            pendingClick={defaultPendingClick}
            onSaveAndClick={mockOnSaveAndClick}
            onCancel={mockOnCancel}
          />
        );
      });

      await waitFor(() => {
        expect(screen.getByTestId(testIds.wysiwygEditor.fullScreen.stepEditor.cancelButton)).toBeInTheDocument();
      });

      const cancelButton = screen.getByTestId(testIds.wysiwygEditor.fullScreen.stepEditor.cancelButton);
      await act(async () => {
        fireEvent.click(cancelButton);
      });

      expect(mockOnCancel).toHaveBeenCalledTimes(1);
    });
  });

  describe('Modal visibility', () => {
    it('should not render when isOpen is false', async () => {
      await act(async () => {
        render(
          <FullScreenStepEditor
            isOpen={false}
            pendingClick={defaultPendingClick}
            onSaveAndClick={mockOnSaveAndClick}
            onCancel={mockOnCancel}
          />
        );
      });

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('should not render without pendingClick or editData', async () => {
      await act(async () => {
        render(<FullScreenStepEditor isOpen={true} onSaveAndClick={mockOnSaveAndClick} onCancel={mockOnCancel} />);
      });

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
});
