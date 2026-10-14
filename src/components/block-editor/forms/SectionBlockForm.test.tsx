import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import { SectionBlockForm } from './SectionBlockForm';
import type { JsonSectionBlock } from '../../../types/json-guide.types';

describe('SectionBlockForm', () => {
  it('keeps a JSON-authored checkpoint when the section is edited', () => {
    const onSubmit = jest.fn();
    const section: JsonSectionBlock = {
      type: 'section',
      id: 'explore',
      title: 'Explore',
      blocks: [],
      checkpoint: { checks: [{ requirement: 'on-page:/explore' }], manualRecovery: 'Open Explore.' },
    };
    render(<SectionBlockForm initialData={section} onSubmit={onSubmit} onCancel={jest.fn()} isEditing />);

    fireEvent.change(screen.getByDisplayValue('Explore'), { target: { value: 'Explore metrics' } });
    fireEvent.click(screen.getByTestId('block-editor-submit-button'));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Explore metrics', checkpoint: section.checkpoint })
    );
  });
});

it('lists checkpoint targets with their live selector health', () => {
  document.body.insertAdjacentHTML(
    'beforeend',
    '<button class="row-toggle" aria-expanded="true"></button><button class="row-toggle" aria-expanded="true"></button>'
  );
  render(
    <SectionBlockForm
      initialData={{
        type: 'section',
        blocks: [],
        checkpoint: { checks: [{ requirement: 'on-page:/explore' }, { target: '.row-toggle', state: 'expanded' }] },
      }}
      onSubmit={jest.fn()}
      onCancel={jest.fn()}
      isEditing
    />
  );
  expect(screen.getByTestId('section-block-checkpoint-targets')).toHaveTextContent('.row-toggle');
});
