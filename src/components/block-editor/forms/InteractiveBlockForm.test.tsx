import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';

import { InteractiveBlockForm } from './InteractiveBlockForm';
import type { JsonBlock } from '../types';
import type { JsonInteractiveBlock } from '../../../types/json-guide.types';

// Grafana's Combobox (Action Type picker) measures text via a <canvas> 2d
// context, which jsdom doesn't implement. Stub the methods it calls.
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = jest.fn(() => ({
    measureText: () => ({ width: 0 }),
    font: '',
  })) as unknown as HTMLCanvasElement['getContext'];
});

function renderForm(opts: { onSubmit?: (block: JsonBlock) => void; initialData?: JsonInteractiveBlock } = {}) {
  const onSubmit = opts.onSubmit ?? jest.fn();
  render(<InteractiveBlockForm onSubmit={onSubmit} onCancel={jest.fn()} initialData={opts.initialData} />);
  return { onSubmit };
}

const FALLBACK_PLACEHOLDER = "e.g., button[data-testid='save-dashboard']";
const primaryInput = () => screen.getByPlaceholderText("e.g., button[data-testid='save'], .my-class");
const fallbackInputs = () => screen.getAllByPlaceholderText(FALLBACK_PLACEHOLDER);
const descriptionInput = () => screen.getByPlaceholderText('Click the **Save** button to save your changes.');
const submitButton = () => screen.getByRole('button', { name: 'Add block' });

describe('InteractiveBlockForm — element picker', () => {
  it('populates the primary and fallback chain from the picker selection', () => {
    let captured: ((selector: string, fallbacks?: string[]) => void) | undefined;
    const onPickerModeChange = jest.fn(
      (_active: boolean, onSelect?: (selector: string, fallbacks?: string[]) => void) => {
        captured = onSelect;
      }
    );
    const onSubmit = jest.fn();
    render(<InteractiveBlockForm onSubmit={onSubmit} onCancel={jest.fn()} onPickerModeChange={onPickerModeChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Pick element' }));
    expect(captured).toBeDefined();

    act(() => {
      captured!("button[data-testid='save']", ["button:contains('Save')"]);
    });

    fireEvent.change(descriptionInput(), { target: { value: 'Save your work' } });
    fireEvent.click(submitButton());

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        reftarget: ["button[data-testid='save']", "button:contains('Save')"],
      })
    );
  });
});

describe('InteractiveBlockForm — fallback selectors', () => {
  it('serializes the primary plus fallbacks as an ordered array', () => {
    const { onSubmit } = renderForm();

    fireEvent.change(primaryInput(), { target: { value: 'Save dashboard' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add fallback selector' }));
    fireEvent.change(fallbackInputs()[0]!, { target: { value: "button[data-testid='save']" } });
    fireEvent.change(descriptionInput(), { target: { value: 'Save your work' } });
    fireEvent.click(submitButton());

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ reftarget: ['Save dashboard', "button[data-testid='save']"] })
    );
  });

  it('serializes a primary-only selector as a plain string', () => {
    const { onSubmit } = renderForm();

    fireEvent.change(primaryInput(), { target: { value: '#only' } });
    fireEvent.change(descriptionInput(), { target: { value: 'Do it' } });
    fireEvent.click(submitButton());

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ reftarget: '#only' }));
  });

  it('drops empty fallback rows on submit', () => {
    const { onSubmit } = renderForm();

    fireEvent.change(primaryInput(), { target: { value: '#primary' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add fallback selector' }));
    // Leave the new fallback row blank.
    fireEvent.change(descriptionInput(), { target: { value: 'Do it' } });
    fireEvent.click(submitButton());

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ reftarget: '#primary' }));
  });

  it('loads an existing array into the primary field plus fallback rows', () => {
    renderForm({
      initialData: { type: 'interactive', action: 'highlight', content: 'c', reftarget: ['#a', '#b', '#c'] },
    });

    expect(primaryInput()).toHaveValue('#a');
    const rows = fallbackInputs();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveValue('#b');
    expect(rows[1]).toHaveValue('#c');
  });

  it('removes a fallback row', () => {
    renderForm({
      initialData: { type: 'interactive', action: 'highlight', content: 'c', reftarget: ['#a', '#b'] },
    });

    expect(fallbackInputs()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Remove fallback' }));
    expect(screen.queryAllByPlaceholderText(FALLBACK_PLACEHOLDER)).toHaveLength(0);
  });
});
