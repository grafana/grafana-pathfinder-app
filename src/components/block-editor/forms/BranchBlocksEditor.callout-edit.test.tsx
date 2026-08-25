import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import { BranchBlocksEditor } from './BranchBlocksEditor';
import type { JsonBlock } from '../types';

describe('BranchBlocksEditor inline callout editing', () => {
  it('preserves id and authorNote when an existing callout is edited and saved unchanged', () => {
    const onChange = jest.fn();
    const existing: JsonBlock = {
      type: 'callout',
      id: 'callout-1',
      title: 'Objective',
      content: 'Learn the thing.',
      authorNote: 'TODO: revisit wording',
    };

    render(
      <BranchBlocksEditor label="When conditions pass" variant="success" blocks={[existing]} onChange={onChange} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit block' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onChange).toHaveBeenCalledWith([
      {
        type: 'callout',
        id: 'callout-1',
        title: 'Objective',
        content: 'Learn the thing.',
        authorNote: 'TODO: revisit wording',
      },
    ]);
  });
});
