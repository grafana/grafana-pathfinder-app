import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import { DividerBlockForm } from './DividerBlockForm';
import type { BlockType } from '../types';

jest.mock('./TypeSwitchDropdown', () => ({
  TypeSwitchDropdown: ({ onSwitch }: { onSwitch: (type: BlockType) => void }) => (
    <button type="button" onClick={() => onSwitch('markdown')}>
      Switch type
    </button>
  ),
}));

describe('DividerBlockForm', () => {
  it('offers type switching while editing', () => {
    const onSwitchBlockType = jest.fn();

    render(
      <DividerBlockForm
        initialData={{ type: 'divider', id: 'divider-1' }}
        onSubmit={jest.fn()}
        onCancel={jest.fn()}
        onSwitchBlockType={onSwitchBlockType}
        isEditing
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Switch type' }));

    expect(onSwitchBlockType).toHaveBeenCalledWith('markdown');
  });

  it('does not offer type switching while creating a divider', () => {
    render(<DividerBlockForm onSubmit={jest.fn()} onCancel={jest.fn()} onSwitchBlockType={jest.fn()} />);

    expect(screen.queryByRole('button', { name: 'Switch type' })).not.toBeInTheDocument();
  });
});
