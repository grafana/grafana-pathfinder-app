/**
 * CalloutBlockForm Tests
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { CalloutBlockForm } from './CalloutBlockForm';
import type { JsonCalloutBlock } from '../../../types/json-guide.types';

// Mock Grafana UI to avoid theme issues
jest.mock('@grafana/ui', () => ({
  ...jest.requireActual('@grafana/ui'),
  useStyles2: () => ({
    form: 'form',
    row: 'row',
    footer: 'footer',
    footerLeft: 'footerLeft',
  }),
}));

describe('CalloutBlockForm', () => {
  const mockOnSubmit = jest.fn();
  const mockOnCancel = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should render with empty defaults for new blocks', () => {
    render(<CalloutBlockForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

    expect(screen.getByText('Add block')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter callout content (supports markdown)')).toBeInTheDocument();
  });

  it('should submit a callout block with correct data', () => {
    render(<CalloutBlockForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

    // Fill in content
    const contentInput = screen.getByPlaceholderText('Enter callout content (supports markdown)');
    fireEvent.change(contentInput, { target: { value: 'This is important!' } });

    // Fill in title
    const titleInput = screen.getByPlaceholderText('e.g., Watch out, Tip, Important');
    fireEvent.change(titleInput, { target: { value: 'Warning' } });

    // Submit
    fireEvent.click(screen.getByText('Add block'));

    expect(mockOnSubmit).toHaveBeenCalledWith({
      type: 'callout',
      variant: 'info',
      content: 'This is important!',
      title: 'Warning',
    });
  });

  it('should disable submit when content is empty', () => {
    render(<CalloutBlockForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

    // Grafana Button wraps text in a span, so find the button element
    const submitButton = screen.getByText('Add block').closest('button');
    expect(submitButton).toBeDisabled();
  });

  it('should populate form when editing an existing block', () => {
    const existingBlock: JsonCalloutBlock = {
      type: 'callout',
      variant: 'warning',
      content: 'Be careful!',
      title: 'Caution',
    };

    render(
      <CalloutBlockForm initialData={existingBlock} onSubmit={mockOnSubmit} onCancel={mockOnCancel} isEditing={true} />
    );

    expect(screen.getByText('Update block')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Caution')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Be careful!')).toBeInTheDocument();
  });

  it('should call onCancel when cancel is clicked', () => {
    render(<CalloutBlockForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

    fireEvent.click(screen.getByText('Cancel'));
    expect(mockOnCancel).toHaveBeenCalled();
  });

  it('should not include title if empty', () => {
    render(<CalloutBlockForm onSubmit={mockOnSubmit} onCancel={mockOnCancel} />);

    const contentInput = screen.getByPlaceholderText('Enter callout content (supports markdown)');
    fireEvent.change(contentInput, { target: { value: 'No title callout' } });

    fireEvent.click(screen.getByText('Add block'));

    const submitted = mockOnSubmit.mock.calls[0][0];
    expect(submitted.title).toBeUndefined();
    expect(submitted.content).toBe('No title callout');
  });
});
