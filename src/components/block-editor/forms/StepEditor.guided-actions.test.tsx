/**
 * Guided-step action picker.
 *
 * `guide-lint.ts` rejects a guided step whose verb `GuidedHandler` cannot drive,
 * so the picker must not offer one. The option set is derived from
 * `GUIDED_ACTION_TYPES`, which these tests pin.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import { StepEditor } from './StepEditor';
import type { JsonStep } from '../types';
import { GUIDED_ACTION_TYPES } from '../../../types/interactive-actions.types';
import { INTERACTIVE_ACTIONS } from '../constants';

// `Combobox` renders a virtualized listbox over a <canvas> text measurement,
// neither of which jsdom drives. A <select> exposes the option set instead.
jest.mock('@grafana/ui', () => {
  const actual = jest.requireActual('@grafana/ui');
  return {
    ...actual,
    Combobox: ({
      id,
      value,
      options,
      onChange,
      placeholder,
    }: {
      id?: string;
      value?: string;
      options?: Array<{ value: string; label?: string }>;
      onChange: (option: { value: string }) => void;
      placeholder?: string;
    }) => {
      const list = options ?? [];
      return (
        <select
          id={id}
          aria-label={placeholder ?? 'combobox'}
          value={value ?? ''}
          onChange={(e) => onChange({ value: e.target.value })}
        >
          {list.some((o) => o.value === (value ?? '')) ? null : <option value={value ?? ''} />}
          {list.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label ?? o.value}
            </option>
          ))}
        </select>
      );
    },
  };
});

function renderEditor(steps: JsonStep[], isGuided: boolean) {
  render(<StepEditor steps={steps} onChange={jest.fn()} showRecordMode={false} isGuided={isGuided} />);
}

// `Field` does not forward its generated id to the control, so the action picker
// is reached through the one option only it offers.
const HIGHLIGHT_LABEL = INTERACTIVE_ACTIONS.find((a) => a.value === 'highlight')!.label;

function offeredActions(): string[] {
  const picker = screen.getByRole('option', { name: HIGHLIGHT_LABEL }).closest('select');
  return Array.from(picker!.querySelectorAll('option'))
    .map((o) => o.value)
    .filter((v) => v !== '');
}

describe('step action picker', () => {
  describe('guided parent', () => {
    it('offers exactly the verbs the guided handler can drive', () => {
      renderEditor([], true);
      fireEvent.click(screen.getByRole('button', { name: 'Add step manually' }));

      expect(offeredActions().sort()).toEqual([...GUIDED_ACTION_TYPES].sort());
    });

    it('offers the same set when editing an existing step', () => {
      renderEditor([{ action: 'highlight', reftarget: '#drawer' }], true);
      fireEvent.click(screen.getByRole('button', { name: 'Edit step' }));

      expect(offeredActions().sort()).toEqual([...GUIDED_ACTION_TYPES].sort());
    });

    // A pre-gate guide can carry an undrivable verb, and the author opened the
    // editor to change it — dropping it from the list shows no action at all.
    it('keeps a pre-gate step its own verb so the author can see and change it', () => {
      renderEditor([{ action: 'navigate', reftarget: '/explore' }], true);
      fireEvent.click(screen.getByRole('button', { name: 'Edit step' }));

      expect(offeredActions()).toContain('navigate');
      expect(offeredActions()).not.toContain('popout');
    });
  });

  describe('multistep parent', () => {
    it('keeps the full authorable set', () => {
      renderEditor([], false);
      fireEvent.click(screen.getByRole('button', { name: 'Add step manually' }));

      const offered = offeredActions();
      expect(offered).toContain('navigate');
      expect(offered).toContain('popout');
    });
  });
});
