import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import { InputBlockForm } from './InputBlockForm';
import type { JsonBlock } from '../types';

function renderForm(onSubmit: (block: JsonBlock) => void = jest.fn()) {
  render(<InputBlockForm onSubmit={onSubmit} onCancel={jest.fn()} />);
  return {
    promptInput: screen.getByPlaceholderText('e.g., What is the name of your Prometheus data source?'),
    variableNameInput: screen.getByPlaceholderText('e.g., prometheusDataSource'),
    submitButton: screen.getByRole('button', { name: 'Add block' }),
  };
}

describe('InputBlockForm', () => {
  it('keeps submit disabled until required fields are filled', () => {
    const { promptInput, variableNameInput, submitButton } = renderForm();

    expect(submitButton).toBeDisabled();

    fireEvent.change(promptInput, { target: { value: 'Enter a name' } });
    expect(submitButton).toBeDisabled();

    fireEvent.change(variableNameInput, { target: { value: 'datasourceName' } });
    expect(submitButton).toBeEnabled();
  });

  it('rejects invalid variable names before submit', () => {
    const onSubmit = jest.fn();
    const { promptInput, variableNameInput, submitButton } = renderForm(onSubmit);

    fireEvent.change(promptInput, { target: { value: 'Enter a name' } });
    fireEvent.change(variableNameInput, { target: { value: '123bad' } });

    expect(
      screen.getByText('Must start with letter/underscore, contain only letters, numbers, underscores')
    ).toBeInTheDocument();
    expect(submitButton).toBeDisabled();

    fireEvent.click(submitButton);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('rejects an invalid regex pattern before submit', () => {
    const onSubmit = jest.fn();
    const { promptInput, variableNameInput, submitButton } = renderForm(onSubmit);
    const patternInput = screen.getByPlaceholderText('e.g., ^[a-z][a-z0-9-]*$');

    fireEvent.change(promptInput, { target: { value: 'Enter a name' } });
    fireEvent.change(variableNameInput, { target: { value: 'datasourceName' } });
    fireEvent.change(patternInput, { target: { value: '[unclosed' } });
    fireEvent.blur(patternInput);

    expect(screen.getByText('Invalid regex pattern')).toBeInTheDocument();
    expect(submitButton).toBeDisabled();

    fireEvent.click(submitButton);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('does not block submit when switching away from text with an invalid pattern', () => {
    const onSubmit = jest.fn();
    const { promptInput, variableNameInput, submitButton } = renderForm(onSubmit);
    const patternInput = screen.getByPlaceholderText('e.g., ^[a-z][a-z0-9-]*$');

    fireEvent.change(promptInput, { target: { value: 'Enter a name' } });
    fireEvent.change(variableNameInput, { target: { value: 'datasourceName' } });
    fireEvent.change(patternInput, { target: { value: '[unclosed' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Checkbox' }));

    expect(submitButton).toBeEnabled();
    fireEvent.click(submitButton);
    expect(onSubmit).toHaveBeenCalledWith({
      type: 'input',
      prompt: 'Enter a name',
      inputType: 'boolean',
      variableName: 'datasourceName',
    });
  });

  it('surfaces an inline error for an initially invalid pattern', () => {
    const onSubmit = jest.fn();
    render(
      <InputBlockForm
        initialData={{
          type: 'input',
          prompt: 'Enter a name',
          inputType: 'text',
          variableName: 'datasourceName',
          pattern: '[unclosed',
        }}
        onSubmit={onSubmit}
        onCancel={jest.fn()}
        isEditing
      />
    );

    expect(screen.getByText('Invalid regex pattern')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update block' })).toBeDisabled();
  });

  it('submits trimmed required fields', () => {
    const onSubmit = jest.fn();
    const { promptInput, variableNameInput, submitButton } = renderForm(onSubmit);

    fireEvent.change(promptInput, { target: { value: '  Enter a name  ' } });
    fireEvent.change(variableNameInput, { target: { value: '  datasourceName  ' } });
    fireEvent.click(submitButton);

    expect(onSubmit).toHaveBeenCalledWith({
      type: 'input',
      prompt: 'Enter a name',
      inputType: 'text',
      variableName: 'datasourceName',
    });
  });
});
