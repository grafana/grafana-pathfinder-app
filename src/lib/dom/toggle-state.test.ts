import {
  findAttributeSource,
  findStatefulControl,
  hasStatefulControl,
  parseTargetState,
  readToggleState,
  satisfiesTargetState,
} from './toggle-state';

describe('parseTargetState', () => {
  it('treats absent, null and empty values as unset', () => {
    expect(parseTargetState(undefined)).toBeNull();
    expect(parseTargetState(null)).toBeNull();
    expect(parseTargetState('')).toBeNull();
  });

  it('accepts the boolean form', () => {
    expect(parseTargetState(true)).toEqual({ value: 'true' });
    expect(parseTargetState(false)).toEqual({ value: 'false' });
  });

  it('accepts the stringified boolean form the DOM attribute path produces', () => {
    expect(parseTargetState('true')).toEqual({ value: 'true' });
    expect(parseTargetState(' false ')).toEqual({ value: 'false' });
  });

  it('accepts the explicit attribute form', () => {
    expect(parseTargetState('aria-expanded:true')).toEqual({ attribute: 'aria-expanded', value: 'true' });
    expect(parseTargetState('data-state:open')).toEqual({ attribute: 'data-state', value: 'open' });
  });

  it('rejects malformed attribute forms', () => {
    expect(parseTargetState(':true')).toBeNull();
    expect(parseTargetState('aria-expanded:')).toBeNull();
  });

  // The data-targetstate DOM path bypasses the Zod schema, so a name that
  // would break a selector must be rejected here.
  it('rejects attribute names that are not selector-safe', () => {
    expect(parseTargetState('aria expanded:true')).toBeNull();
    expect(parseTargetState('[aria-expanded]:true')).toBeNull();
    expect(parseTargetState('1bad:true')).toBeNull();
    expect(parseTargetState('a"],[b:true')).toBeNull();
  });
});

describe('findAttributeSource', () => {
  it('prefers the element itself over a descendant', () => {
    const host = document.createElement('div');
    host.innerHTML = '<div data-state="open"><span data-state="closed"></span></div>';
    const outer = host.firstElementChild!;

    expect(findAttributeSource(outer, 'data-state')).toBe(outer);
  });

  it('falls back to a descendant carrying the attribute', () => {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = '<button aria-expanded="false"></button>';

    expect(findAttributeSource(wrapper, 'aria-expanded')).toBe(wrapper.firstElementChild);
  });

  it('returns null when the attribute is absent', () => {
    expect(findAttributeSource(document.createElement('div'), 'data-state')).toBeNull();
  });
});

describe('readToggleState', () => {
  it('reads a Grafana Switch, which exposes no aria-checked and no checked attribute', () => {
    const container = document.createElement('div');
    container.innerHTML = '<input role="switch" aria-invalid="false" type="checkbox">';
    const input = container.querySelector('input')!;

    expect(input.hasAttribute('checked')).toBe(false);
    expect(input.getAttribute('aria-checked')).toBeNull();
    expect(readToggleState(input)).toBe('false');

    input.checked = true;
    expect(readToggleState(input)).toBe('true');
    // The attribute never appears, so an attribute-based read would miss this.
    expect(input.hasAttribute('checked')).toBe(false);
  });

  it('ignores the stale checked attribute a RadioButtonGroup leaves behind', () => {
    const container = document.createElement('div');
    container.innerHTML = `
      <input type="radio" name="style" title="Lines" checked>
      <input type="radio" name="style" title="Bars">
    `;
    const lines = container.querySelector<HTMLInputElement>('[title="Lines"]')!;
    const bars = container.querySelector<HTMLInputElement>('[title="Bars"]')!;

    bars.checked = true;

    // The attribute still points at the previously selected option.
    expect(lines.hasAttribute('checked')).toBe(true);
    expect(readToggleState(lines)).toBe('false');
    expect(readToggleState(bars)).toBe('true');
  });

  it('reads the aria families', () => {
    const make = (html: string) => {
      const host = document.createElement('div');
      host.innerHTML = html;
      return host.firstElementChild!;
    };

    expect(readToggleState(make('<button aria-expanded="true"></button>'))).toBe('true');
    expect(readToggleState(make('<button aria-expanded="false"></button>'))).toBe('false');
    expect(readToggleState(make('<button aria-pressed="true"></button>'))).toBe('true');
    expect(readToggleState(make('<div aria-checked="false"></div>'))).toBe('false');
    expect(readToggleState(make('<div aria-selected="true"></div>'))).toBe('true');
  });

  it('falls back to the action described by aria-label', () => {
    const host = document.createElement('div');
    host.innerHTML = `
      <button aria-label="Collapse section: More apps"></button>
      <button aria-label="Expand section: Bookmarks"></button>
      <button aria-label="Add"></button>
    `;
    const byLabel = (label: string) => host.querySelector(`[aria-label^="${label}"]`)!;

    expect(readToggleState(byLabel('Collapse'))).toBe('true');
    expect(readToggleState(byLabel('Expand'))).toBe('false');
    expect(readToggleState(byLabel('Add'))).toBe('unknown');
  });

  it('returns unknown for a control with no state signal', () => {
    expect(readToggleState(document.createElement('div'))).toBe('unknown');
  });

  it('prefers checked over aria, because a Switch sets role=switch without aria-checked', () => {
    const host = document.createElement('div');
    host.innerHTML = '<input role="switch" type="checkbox" aria-checked="true">';
    const input = host.querySelector('input')!;

    input.checked = false;
    expect(readToggleState(input)).toBe('false');
  });
});

describe('findStatefulControl', () => {
  it('descends from the Switch wrapper to the inner input', () => {
    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-testid', 'data-testid prometheus explain switch wrapper');
    wrapper.innerHTML = `
      <div data-testid="data-testid Switch container">
        <input role="switch" type="checkbox">
        <label></label>
      </div>
    `;

    const control = findStatefulControl(wrapper);
    expect(control.tagName).toBe('INPUT');
    expect(hasStatefulControl(wrapper)).toBe(true);
  });

  it('returns the element itself when it already holds the state', () => {
    const host = document.createElement('div');
    host.innerHTML = '<button aria-expanded="true"></button>';
    const button = host.firstElementChild!;

    expect(findStatefulControl(button)).toBe(button);
  });

  it('returns the element unchanged when nothing stateful is found', () => {
    const div = document.createElement('div');
    expect(findStatefulControl(div)).toBe(div);
    expect(hasStatefulControl(div)).toBe(false);
  });
});

describe('satisfiesTargetState', () => {
  it('compares against the auto-detected state', () => {
    const host = document.createElement('div');
    host.innerHTML = '<button aria-expanded="true"></button>';
    const button = host.firstElementChild!;

    expect(satisfiesTargetState(button, { value: 'true' })).toBe(true);
    expect(satisfiesTargetState(button, { value: 'false' })).toBe(false);
  });

  it('compares against an explicitly named attribute', () => {
    const host = document.createElement('div');
    host.innerHTML = '<div data-state="open"></div>';
    const el = host.firstElementChild!;

    expect(satisfiesTargetState(el, { attribute: 'data-state', value: 'open' })).toBe(true);
    expect(satisfiesTargetState(el, { attribute: 'data-state', value: 'closed' })).toBe(false);
  });

  it('reads an attribute the auto-detector would not probe', () => {
    const host = document.createElement('div');
    host.innerHTML = '<div data-collapsed="no"></div>';
    const el = host.firstElementChild!;

    expect(readToggleState(el)).toBe('unknown');
    expect(satisfiesTargetState(el, { attribute: 'data-collapsed', value: 'no' })).toBe(true);
  });

  it('returns null when the state cannot be read', () => {
    const div = document.createElement('div');

    expect(satisfiesTargetState(div, { value: 'true' })).toBeNull();
    expect(satisfiesTargetState(div, { attribute: 'aria-expanded', value: 'true' })).toBeNull();
  });
});
