import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import { StepEditor } from './StepEditor';
import type { JsonStep } from '../types';

// `Combobox` from @grafana/ui measures option text on a <canvas> and renders a
// virtualized listbox, neither of which jsdom drives. A plain text input keeps
// the value round-trip these tests care about, including the custom
// "<attribute>:<value>" target states the real control accepts.
jest.mock('@grafana/ui', () => {
  const actual = jest.requireActual('@grafana/ui');
  return {
    ...actual,
    Combobox: ({
      value,
      onChange,
      placeholder,
    }: {
      value?: string;
      onChange: (option: { value: string } | null) => void;
      placeholder?: string;
    }) => (
      <input
        aria-label={placeholder ?? 'combobox'}
        value={value ?? ''}
        onChange={(e) => onChange({ value: e.target.value })}
      />
    ),
  };
});

function renderEditor(steps: JsonStep[], onChange: (steps: JsonStep[]) => void = jest.fn()) {
  render(<StepEditor steps={steps} onChange={onChange} showRecordMode={false} />);
}

function openFirstStepForEditing() {
  fireEvent.click(screen.getByRole('button', { name: 'Edit step' }));
}

function save() {
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
}

const targetStateField = () => screen.getByLabelText('Click unconditionally');

describe('StepEditor', () => {
  it('round-trips targetstate through an open-then-save with no other edit', () => {
    const onChange = jest.fn();
    renderEditor([{ action: 'highlight', reftarget: '#drawer', targetstate: 'true' }], onChange);

    openFirstStepForEditing();
    expect(targetStateField()).toHaveValue('true');
    save();

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ action: 'highlight', reftarget: '#drawer', targetstate: 'true' }),
    ]);
  });

  it('reads the camelCase alias and writes back the canonical field', () => {
    const onChange = jest.fn();
    renderEditor([{ action: 'button', reftarget: 'Add', targetState: 'aria-expanded:true' }], onChange);

    openFirstStepForEditing();
    save();

    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ targetstate: 'aria-expanded:true' })]);
  });

  // The save used to rebuild the step from an enumerated field list, so any
  // field the form does not render was deleted on the author's behalf.
  it('preserves fields the form does not render', () => {
    const onChange = jest.fn();
    renderEditor([{ id: 'step-7', action: 'highlight', reftarget: '#drawer' }], onChange);

    openFirstStepForEditing();
    save();

    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ id: 'step-7' })]);
  });

  it('drops targetstate when the author clears it', () => {
    const onChange = jest.fn();
    renderEditor([{ action: 'highlight', reftarget: '#drawer', targetstate: 'true' }], onChange);

    openFirstStepForEditing();
    fireEvent.change(targetStateField(), { target: { value: '' } });
    save();

    expect(onChange).toHaveBeenCalledWith([expect.not.objectContaining({ targetstate: expect.anything() })]);
  });

  it('sets targetstate on a step that did not have one', () => {
    const onChange = jest.fn();
    renderEditor([{ action: 'button', reftarget: 'Add' }], onChange);

    openFirstStepForEditing();
    fireEvent.change(targetStateField(), { target: { value: 'false' } });
    save();

    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ targetstate: 'false' })]);
  });

  it('does not persist targetstate for actions that cannot toggle', () => {
    const onChange = jest.fn();
    renderEditor([{ action: 'formfill', reftarget: '#name', targetstate: 'true' }], onChange);

    openFirstStepForEditing();
    save();

    expect(onChange).toHaveBeenCalledWith([expect.not.objectContaining({ targetstate: expect.anything() })]);
  });
});
