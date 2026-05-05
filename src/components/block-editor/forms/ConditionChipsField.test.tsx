/**
 * Tests for the chip-list editor for requirements / objectives.
 *
 * Focus: the picker's contract with its parent — render existing chips,
 * add new ones via the inline panel, remove via the chip's × button,
 * round-trip through raw mode without data loss, and persist the user's
 * raw-vs-chip preference in localStorage.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConditionChipsField } from './ConditionChipsField';

// `Combobox` from @grafana/ui uses a virtualized listbox that's awkward to
// drive from RTL fireEvent. Replace it with a plain <select> for the
// purposes of these tests — we only need to assert the parent's behaviour
// when an option is picked.
jest.mock('@grafana/ui', () => {
  const actual = jest.requireActual('@grafana/ui');
  return {
    ...actual,
    Combobox: ({
      options,
      value,
      onChange,
      placeholder,
      'data-testid': dataTestId,
    }: {
      options: Array<{ value: string; label?: string }>;
      value?: string;
      onChange: (option: { value: string } | null) => void;
      placeholder?: string;
      'data-testid'?: string;
    }) => (
      <select
        data-testid={dataTestId}
        aria-label={placeholder ?? 'Select an option'}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value ? { value: e.target.value } : null)}
      >
        <option value="" disabled>
          {placeholder ?? 'Select…'}
        </option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label ?? opt.value}
          </option>
        ))}
      </select>
    ),
  };
});

// `getDataSourceSrv` is queried by HasDatasourceHelper but not on the
// initial render of the chip picker — mock it just in case the picker is
// opened with `has-datasource:` in a test.
jest.mock('@grafana/runtime', () => ({
  ...jest.requireActual('@grafana/runtime'),
  getDataSourceSrv: () => ({ getList: () => [] }),
}));

beforeEach(() => {
  window.localStorage.clear();
});

describe('ConditionChipsField — chip rendering', () => {
  it('renders one chip per token in the comma-separated value', () => {
    render(
      <ConditionChipsField
        value="exists-reftarget, on-page:/explore"
        onChange={jest.fn()}
        mode="requirements"
        testId="rf"
      />
    );
    expect(screen.getByText('exists-reftarget')).toBeInTheDocument();
    expect(screen.getByText('on-page:/explore')).toBeInTheDocument();
  });

  it('removing a chip emits the new comma-separated value without that token', () => {
    const onChange = jest.fn();
    render(
      <ConditionChipsField
        value="exists-reftarget, on-page:/explore, is-admin"
        onChange={onChange}
        mode="requirements"
      />
    );
    fireEvent.click(screen.getByLabelText('Remove on-page:/explore'));
    expect(onChange).toHaveBeenCalledWith('exists-reftarget, is-admin');
  });

  it('shows a placeholder hint when there are no tokens', () => {
    render(<ConditionChipsField value="" onChange={jest.fn()} mode="requirements" />);
    expect(screen.getByText(/exists-reftarget/i)).toBeInTheDocument();
  });
});

describe('ConditionChipsField — adding a chip', () => {
  it('adds a fixed requirement directly when picked', () => {
    const onChange = jest.fn();
    render(<ConditionChipsField value="" onChange={onChange} mode="requirements" testId="rf" />);

    fireEvent.click(screen.getByRole('button', { name: /Add condition/i }));
    fireEvent.change(screen.getByTestId('rf-add-type'), { target: { value: 'exists-reftarget' } });
    fireEvent.click(screen.getByRole('button', { name: /^Add$/i }));

    expect(onChange).toHaveBeenCalledWith('exists-reftarget');
  });

  it('keeps the Add button disabled until a parameterized prefix has a value', () => {
    const onChange = jest.fn();
    render(<ConditionChipsField value="" onChange={onChange} mode="requirements" testId="rf" />);

    fireEvent.click(screen.getByRole('button', { name: /Add condition/i }));
    fireEvent.change(screen.getByTestId('rf-add-type'), { target: { value: 'has-permission:' } });

    const addButton = screen.getByRole('button', { name: /^Add$/i });
    expect(addButton).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('joins the prefix and value into a complete token on add', () => {
    const onChange = jest.fn();
    render(<ConditionChipsField value="exists-reftarget" onChange={onChange} mode="requirements" testId="rf" />);

    fireEvent.click(screen.getByRole('button', { name: /Add condition/i }));
    fireEvent.change(screen.getByTestId('rf-add-type'), { target: { value: 'has-permission:' } });
    const argInput = screen.getByTestId('rf-add-arg');
    fireEvent.change(argInput, { target: { value: 'dashboards:write' } });
    fireEvent.click(screen.getByRole('button', { name: /^Add$/i }));

    expect(onChange).toHaveBeenCalledWith('exists-reftarget, has-permission:dashboards:write');
  });

  it('cancel discards the in-progress entry without calling onChange', () => {
    const onChange = jest.fn();
    render(<ConditionChipsField value="" onChange={onChange} mode="requirements" testId="rf" />);

    fireEvent.click(screen.getByRole('button', { name: /Add condition/i }));
    fireEvent.change(screen.getByTestId('rf-add-type'), { target: { value: 'is-admin' } });
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByTestId('rf-add-type')).not.toBeInTheDocument();
  });

  it('does not duplicate a token that is already present', () => {
    const onChange = jest.fn();
    render(<ConditionChipsField value="is-admin" onChange={onChange} mode="requirements" testId="rf" />);

    fireEvent.click(screen.getByRole('button', { name: /Add condition/i }));
    fireEvent.change(screen.getByTestId('rf-add-type'), { target: { value: 'is-admin' } });
    fireEvent.click(screen.getByRole('button', { name: /^Add$/i }));

    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('ConditionChipsField — raw mode toggle', () => {
  it('shows a raw <Input> when toggled into raw mode', () => {
    render(
      <ConditionChipsField
        value="exists-reftarget, on-page:/explore"
        onChange={jest.fn()}
        mode="requirements"
        testId="rf"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /View raw/i }));
    const input = screen.getByDisplayValue('exists-reftarget, on-page:/explore') as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.tagName).toBe('INPUT');
  });

  it('round-trips chip ↔ raw without altering the value', () => {
    const TestHarness = () => {
      const [value, setValue] = React.useState('exists-reftarget, on-page:/explore, is-admin');
      return <ConditionChipsField value={value} onChange={setValue} mode="requirements" />;
    };
    render(<TestHarness />);

    fireEvent.click(screen.getByRole('button', { name: /View raw/i }));
    expect(screen.getByDisplayValue('exists-reftarget, on-page:/explore, is-admin')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Use chip editor/i }));
    expect(screen.getByText('exists-reftarget')).toBeInTheDocument();
    expect(screen.getByText('on-page:/explore')).toBeInTheDocument();
    expect(screen.getByText('is-admin')).toBeInTheDocument();
  });

  it('persists the raw-mode preference to localStorage', () => {
    render(<ConditionChipsField value="" onChange={jest.fn()} mode="requirements" />);

    expect(window.localStorage.getItem('pathfinder.blockEditor.conditionField.rawMode')).toBe(null);
    fireEvent.click(screen.getByRole('button', { name: /View raw/i }));
    expect(window.localStorage.getItem('pathfinder.blockEditor.conditionField.rawMode')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /Use chip editor/i }));
    expect(window.localStorage.getItem('pathfinder.blockEditor.conditionField.rawMode')).toBe('false');
  });

  it('initializes raw mode from a previously stored preference', () => {
    window.localStorage.setItem('pathfinder.blockEditor.conditionField.rawMode', 'true');
    render(<ConditionChipsField value="exists-reftarget" onChange={jest.fn()} mode="requirements" />);
    expect(screen.getByDisplayValue('exists-reftarget')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Use chip editor/i })).toBeInTheDocument();
  });
});

describe('ConditionChipsField — auto-recoverable presentation', () => {
  it('renders chips for each token, including auto-recoverable ones', () => {
    render(
      <ConditionChipsField
        value="exists-reftarget, is-admin, on-page:/explore"
        onChange={jest.fn()}
        mode="requirements"
      />
    );
    expect(screen.getByLabelText('Remove exists-reftarget')).toBeInTheDocument();
    expect(screen.getByLabelText('Remove on-page:/explore')).toBeInTheDocument();
    expect(screen.getByLabelText('Remove is-admin')).toBeInTheDocument();
  });
});
