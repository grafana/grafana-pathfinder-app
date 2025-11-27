/**
 * Tests for BaseInteractiveForm component
 */

import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import BaseInteractiveForm, { type BaseInteractiveFormConfig } from './BaseInteractiveForm';
import { DATA_ATTRIBUTES, ACTION_TYPES, DEFAULT_VALUES } from '../../../constants/interactive-config';
import type { Editor } from '@tiptap/react';

// Mock the selector capture hook
const mockStartCapture = jest.fn();
const mockStopCapture = jest.fn();
const mockIsActive = false;

jest.mock('../devtools/selector-capture.hook', () => ({
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

describe('BaseInteractiveForm', () => {
  const mockOnApply = jest.fn();
  const mockOnCancel = jest.fn();
  const mockOnSwitchType = jest.fn();
  const mockEditor = {
    chain: jest.fn(() => mockEditor),
    focus: jest.fn(() => mockEditor),
    run: jest.fn(),
  } as unknown as Editor;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  const createConfigWithSelectorField = (disableSelectorCapture?: boolean): BaseInteractiveFormConfig => ({
    title: 'Test Form',
    description: 'Test description',
    actionType: ACTION_TYPES.HIGHLIGHT,
    fields: [
      {
        id: DATA_ATTRIBUTES.REF_TARGET,
        label: 'Selector:',
        type: 'text',
        placeholder: 'e.g., [data-testid="panel"]',
        hint: 'CSS selector',
        required: true,
        disableSelectorCapture,
      },
      {
        id: DATA_ATTRIBUTES.REQUIREMENTS,
        label: 'Requirements:',
        type: 'text',
        placeholder: 'e.g., exists-reftarget',
        defaultValue: DEFAULT_VALUES.REQUIREMENT,
      },
    ],
    buildAttributes: (values) => ({
      [DATA_ATTRIBUTES.TARGET_ACTION]: ACTION_TYPES.HIGHLIGHT,
      [DATA_ATTRIBUTES.REF_TARGET]: values[DATA_ATTRIBUTES.REF_TARGET],
      [DATA_ATTRIBUTES.REQUIREMENTS]: values[DATA_ATTRIBUTES.REQUIREMENTS],
      class: DEFAULT_VALUES.CLASS,
    }),
  });

  const createConfigWithoutSelectorField = (): BaseInteractiveFormConfig => ({
    title: 'Test Form',
    description: 'Test description',
    actionType: ACTION_TYPES.NAVIGATE,
    fields: [
      {
        id: DATA_ATTRIBUTES.TARGET_VALUE,
        label: 'URL:',
        type: 'text',
        placeholder: 'e.g., /dashboard',
        required: true,
      },
    ],
    buildAttributes: (values) => ({
      [DATA_ATTRIBUTES.TARGET_ACTION]: ACTION_TYPES.NAVIGATE,
      [DATA_ATTRIBUTES.TARGET_VALUE]: values[DATA_ATTRIBUTES.TARGET_VALUE],
      class: DEFAULT_VALUES.CLASS,
    }),
  });

  it('should auto-start selector capture when form mounts with selector field', () => {
    const config = createConfigWithSelectorField(false);

    render(
      <BaseInteractiveForm
        editor={mockEditor}
        config={config}
        onApply={mockOnApply}
        onCancel={mockOnCancel}
        onSwitchType={mockOnSwitchType}
      />
    );

    expect(mockStartCapture).toHaveBeenCalledTimes(1);
  });

  it('should NOT auto-start selector capture when selector field has disableSelectorCapture=true', () => {
    const config = createConfigWithSelectorField(true);

    render(
      <BaseInteractiveForm
        editor={mockEditor}
        config={config}
        onApply={mockOnApply}
        onCancel={mockOnCancel}
        onSwitchType={mockOnSwitchType}
      />
    );

    expect(mockStartCapture).not.toHaveBeenCalled();
  });

  it('should NOT auto-start selector capture when form has no selector field', () => {
    const config = createConfigWithoutSelectorField();

    render(
      <BaseInteractiveForm
        editor={mockEditor}
        config={config}
        onApply={mockOnApply}
        onCancel={mockOnCancel}
        onSwitchType={mockOnSwitchType}
      />
    );

    expect(mockStartCapture).not.toHaveBeenCalled();
  });

  it('should stop selector capture when component unmounts', () => {
    const config = createConfigWithSelectorField(false);

    const { unmount } = render(
      <BaseInteractiveForm
        editor={mockEditor}
        config={config}
        onApply={mockOnApply}
        onCancel={mockOnCancel}
        onSwitchType={mockOnSwitchType}
      />
    );

    expect(mockStartCapture).toHaveBeenCalledTimes(1);
    expect(mockStopCapture).not.toHaveBeenCalled();

    unmount();

    expect(mockStopCapture).toHaveBeenCalledTimes(1);
  });

  it('should render selector capture button when selector field exists', () => {
    const config = createConfigWithSelectorField(false);

    render(
      <BaseInteractiveForm
        editor={mockEditor}
        config={config}
        onApply={mockOnApply}
        onCancel={mockOnCancel}
        onSwitchType={mockOnSwitchType}
      />
    );

    // Button now uses aria-label instead of title
    const captureButton = screen.getByRole('button', { name: 'Capture selector' });
    expect(captureButton).toBeInTheDocument();
  });

  it('should disable selector capture button when disableSelectorCapture is true', () => {
    const config = createConfigWithSelectorField(true);

    render(
      <BaseInteractiveForm
        editor={mockEditor}
        config={config}
        onApply={mockOnApply}
        onCancel={mockOnCancel}
        onSwitchType={mockOnSwitchType}
      />
    );

    // Button now uses aria-label instead of title, check it's disabled via aria-disabled
    const captureButton = screen.getByRole('button', { name: 'Capture selector' });
    expect(captureButton).toBeInTheDocument();
    expect(captureButton).toHaveAttribute('aria-disabled', 'true');
  });
});
