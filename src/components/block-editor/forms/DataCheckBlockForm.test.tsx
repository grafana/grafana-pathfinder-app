import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import { DataCheckBlockForm } from './DataCheckBlockForm';
import type { JsonBlock } from '../types';
import type { JsonDataCheckBlock } from '../../../types/json-guide.types';

const existingBlock: JsonDataCheckBlock = {
  type: 'data-check',
  id: 'dc-1',
  datasourceType: 'prometheus',
  mode: 'query',
  query: 'up',
  objectives: ['has-datasource:prometheus'],
  authorNote: 'revisit this query',
};

function renderEditing(onSubmit: (block: JsonBlock) => void) {
  render(<DataCheckBlockForm initialData={existingBlock} onSubmit={onSubmit} onCancel={jest.fn()} isEditing={true} />);
  return { submitButton: screen.getByRole('button', { name: 'Update block' }) };
}

describe('DataCheckBlockForm', () => {
  it('carries over fields the form does not own', () => {
    const onSubmit = jest.fn();
    const { submitButton } = renderEditing(onSubmit);

    fireEvent.click(submitButton);

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'dc-1',
        objectives: ['has-datasource:prometheus'],
        authorNote: 'revisit this query',
      })
    );
  });

  it('keeps carrying them over when an owned field changes', () => {
    const onSubmit = jest.fn();
    const { submitButton } = renderEditing(onSubmit);

    fireEvent.change(screen.getByPlaceholderText('container_cpu_usage_seconds_total'), {
      target: { value: 'container_cpu_usage_seconds_total' },
    });
    fireEvent.click(submitButton);

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'container_cpu_usage_seconds_total',
        objectives: ['has-datasource:prometheus'],
        authorNote: 'revisit this query',
      })
    );
  });

  it('drops an owned field the author cleared', () => {
    const onSubmit = jest.fn();
    render(
      <DataCheckBlockForm
        initialData={{ ...existingBlock, mode: 'either', aiPrompt: 'has kube metrics', title: 'Check' }}
        onSubmit={onSubmit}
        onCancel={jest.fn()}
        isEditing={true}
      />
    );

    fireEvent.change(screen.getByPlaceholderText('Check you have container metrics'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update block' }));

    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty('title');
  });
});
