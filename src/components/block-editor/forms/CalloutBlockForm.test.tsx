import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import { CalloutBlockForm } from './CalloutBlockForm';
import type { JsonBlock } from '../types';

function renderForm(onSubmit: (block: JsonBlock) => void = jest.fn()) {
  render(<CalloutBlockForm onSubmit={onSubmit} onCancel={jest.fn()} />);
  return {
    titleInput: screen.getByPlaceholderText('Objective'),
    contentInput: screen.getByPlaceholderText('In this section you will learn...'),
    submitButton: screen.getByRole('button', { name: 'Add block' }),
  };
}

describe('CalloutBlockForm', () => {
  it('disables submit until both label and content are entered', () => {
    const { titleInput, submitButton } = renderForm();
    expect(submitButton).toBeDisabled();

    fireEvent.change(titleInput, { target: { value: 'Objective' } });
    expect(submitButton).toBeDisabled();
  });

  it('submits a callout block with the author-supplied label and content', () => {
    const onSubmit = jest.fn();
    const { titleInput, contentInput, submitButton } = renderForm(onSubmit);

    fireEvent.change(titleInput, { target: { value: '  Objective  ' } });
    fireEvent.change(contentInput, { target: { value: '  Learn the thing.  ' } });
    fireEvent.click(submitButton);

    expect(onSubmit).toHaveBeenCalledWith({
      type: 'callout',
      title: 'Objective',
      content: 'Learn the thing.',
    });
  });

  it('preserves the id and authorNote of the block being edited', () => {
    const onSubmit = jest.fn();
    const initialData: JsonBlock = {
      type: 'callout',
      id: 'callout-1',
      title: 'Objective',
      content: 'Learn the thing.',
      authorNote: 'TODO: revisit wording',
    };
    render(<CalloutBlockForm initialData={initialData} onSubmit={onSubmit} onCancel={jest.fn()} isEditing />);

    fireEvent.click(screen.getByRole('button', { name: 'Update block' }));

    expect(onSubmit).toHaveBeenCalledWith({
      type: 'callout',
      id: 'callout-1',
      title: 'Objective',
      content: 'Learn the thing.',
      authorNote: 'TODO: revisit wording',
    });
  });
});
