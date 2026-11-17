import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { BlockFormModal } from './BlockFormModal';
import type { JsonInteractiveBlock } from '../../types/json-guide.types';

describe('BlockFormModal with the element picker (real modal and picker)', () => {
  // Grafana's Combobox (used by the interactive form) measures text on a canvas, which jsdom lacks.
  beforeAll(() => {
    HTMLCanvasElement.prototype.getContext = jest.fn(() => ({
      measureText: () => ({ width: 0 }),
      font: '',
    })) as unknown as HTMLCanvasElement['getContext'];
  });

  it('closes the picker on Escape when focus is on Pick element inside the modal', () => {
    const onCancel = jest.fn();
    const initialData: JsonInteractiveBlock = {
      type: 'interactive',
      action: 'highlight',
      reftarget: '',
      content: 'Keep me',
    } as JsonInteractiveBlock;

    render(
      <BlockFormModal
        blockType="interactive"
        initialData={initialData}
        onSubmit={jest.fn()}
        onCancel={onCancel}
        isEditing
      />
    );

    const pickButton = screen.getByRole('button', { name: /Pick element/ });
    fireEvent.click(pickButton);
    expect(screen.getByRole('button', { name: 'Cancel (Esc)' })).toBeInTheDocument();

    act(() => pickButton.focus());
    fireEvent.keyDown(pickButton, { key: 'Escape' });

    expect(screen.queryByRole('button', { name: 'Cancel (Esc)' })).toBeNull();
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Pick element/ })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Keep me')).toBeInTheDocument();
  });

  it('closes the picker on Escape when focus is on the page body', () => {
    const onCancel = jest.fn();
    const initialData = {
      type: 'interactive',
      action: 'highlight',
      reftarget: '',
      content: 'Keep me',
    } as JsonInteractiveBlock;

    render(
      <BlockFormModal
        blockType="interactive"
        initialData={initialData}
        onSubmit={jest.fn()}
        onCancel={onCancel}
        isEditing
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Pick element/ }));
    expect(screen.getByRole('button', { name: 'Cancel (Esc)' })).toBeInTheDocument();

    act(() => document.body.focus());
    fireEvent.keyDown(document.body, { key: 'Escape' });

    expect(screen.queryByRole('button', { name: 'Cancel (Esc)' })).toBeNull();
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('Keep me')).toBeInTheDocument();
  });
});
