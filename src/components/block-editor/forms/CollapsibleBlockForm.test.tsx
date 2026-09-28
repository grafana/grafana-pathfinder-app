import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import { CollapsibleBlockForm } from './CollapsibleBlockForm';

jest.mock('@grafana/ui', () => {
  const actual = jest.requireActual('@grafana/ui');
  const React = jest.requireActual('react');
  type Option = { value: string; label: string };

  return {
    ...actual,
    Combobox: ({
      options,
      value,
      onChange,
    }: {
      options: Option[];
      value: string;
      onChange: (option: Option) => void;
    }) =>
      React.createElement(
        'select',
        {
          'aria-label': 'Block type',
          value,
          onChange: (event: import('react').ChangeEvent<HTMLSelectElement>) => {
            const option = options.find((candidate) => candidate.value === event.currentTarget.value);
            if (option) {
              onChange(option);
            }
          },
        },
        options.map((option) => React.createElement('option', { key: option.value, value: option.value }, option.label))
      ),
  };
});

describe('CollapsibleBlockForm', () => {
  it('adds a divider to the collapsible content', () => {
    const onSubmit = jest.fn();
    render(<CollapsibleBlockForm onSubmit={onSubmit} onCancel={jest.fn()} />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Add block' })[0]!);
    fireEvent.change(screen.getByRole('combobox', { name: 'Block type' }), { target: { value: 'divider' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add block' })[0]!);
    fireEvent.click(screen.getByTestId('block-editor-submit-button'));

    expect(onSubmit).toHaveBeenCalledWith({
      type: 'collapsible',
      blocks: [{ type: 'divider' }],
    });
  });
});
