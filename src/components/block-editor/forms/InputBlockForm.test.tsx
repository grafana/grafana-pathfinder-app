import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import { InputBlockForm, getPatternValidationError } from './InputBlockForm';

describe('getPatternValidationError', () => {
  it('accepts empty patterns', () => {
    expect(getPatternValidationError('')).toBeUndefined();
    expect(getPatternValidationError('   ')).toBeUndefined();
  });

  it('reports invalid regex syntax', () => {
    expect(getPatternValidationError('[')).toMatch(/unterminated character class/i);
  });
});

describe('InputBlockForm', () => {
  it('blocks submit and shows an inline error for invalid regex patterns', () => {
    const onSubmit = jest.fn();

    render(
      <InputBlockForm
        onSubmit={onSubmit}
        onCancel={jest.fn()}
      />
    );

    fireEvent.change(screen.getByPlaceholderText(/what is the name of your prometheus data source/i), {
      target: { value: 'Enter a datasource name' },
    });
    fireEvent.change(screen.getByPlaceholderText(/prometheusDataSource/i), {
      target: { value: 'datasourceName' },
    });
    fireEvent.change(screen.getByPlaceholderText(/\^\[a-z\]\[a-z0-9-\]\*\$/i), {
      target: { value: '[' },
    });

    expect(screen.getByText(/invalid regex:/i)).toBeInTheDocument();

    const submitButton = screen.getByRole('button', { name: /add block/i });
    expect(submitButton).toBeDisabled();

    fireEvent.click(submitButton);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
