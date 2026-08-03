export type ToggleState = 'true' | 'false' | 'unknown';

export interface TargetState {
  /** Attribute to compare, when the author named one explicitly. */
  attribute?: string;
  /** Value the state must equal. `'true'` / `'false'` for the boolean form. */
  value: string;
}

const STATEFUL_SELECTOR =
  'input[role="switch"], input[type="checkbox"], input[type="radio"], [aria-pressed], [aria-expanded], [aria-checked], [aria-selected]';

/**
 * Parse the authored `targetState` field. Accepts `true` / `false` (auto-detect
 * the control's state signal) or `"<attribute>:<value>"` (author names it).
 */
export function parseTargetState(raw: boolean | string | undefined | null): TargetState | null {
  if (raw === undefined || raw === null || raw === '') {
    return null;
  }
  if (typeof raw === 'boolean') {
    return { value: String(raw) };
  }
  const trimmed = raw.trim();
  if (trimmed === 'true' || trimmed === 'false') {
    return { value: trimmed };
  }
  const separator = trimmed.indexOf(':');
  if (separator <= 0 || separator === trimmed.length - 1) {
    return null;
  }
  const attribute = trimmed.slice(0, separator).trim();
  // The `data-targetstate` DOM path bypasses the Zod schema, so the name is
  // validated here too before it reaches a selector.
  if (!/^[A-Za-z][\w-]*$/.test(attribute)) {
    return null;
  }
  return {
    attribute,
    value: trimmed.slice(separator + 1).trim(),
  };
}

/**
 * Grafana's `Switch` renders its state on an inner `<input>`; clicking the
 * wrapper that carries the stable `data-testid` does nothing. Descend so we
 * read and click the element that actually holds the state.
 */
export function findStatefulControl(element: Element): Element {
  if (element.matches(STATEFUL_SELECTOR)) {
    return element;
  }
  // RadioButtonGroup and Switch put the input beside the label, not inside it.
  if (element instanceof HTMLLabelElement && element.control) {
    return element.control;
  }
  return element.querySelector(STATEFUL_SELECTOR) ?? element;
}

export function hasStatefulControl(element: Element): boolean {
  return findStatefulControl(element).matches(STATEFUL_SELECTOR);
}

/**
 * Locate the element carrying an explicitly named state attribute.
 *
 * Authors reach for the `"<attribute>:<value>"` form precisely when a control
 * has no standard state signal, so `findStatefulControl` would descend past the
 * attribute they named — or onto an unrelated inner checkbox. Resolve by the
 * attribute instead, checking the selected element before its descendants.
 */
export function findAttributeSource(element: Element, attribute: string): Element | null {
  if (element.hasAttribute(attribute)) {
    return element;
  }
  return element.querySelector(`[${attribute}]`);
}

/**
 * Read a control's on/off state. Probes `checked` before ARIA because Grafana's
 * `Switch` sets `role="switch"` without `aria-checked`, and reads the property
 * rather than the attribute because the attribute goes stale on
 * `RadioButtonGroup` — it keeps pointing at the previously selected option.
 */
export function readToggleState(element: Element): ToggleState {
  if (element instanceof HTMLInputElement) {
    const type = element.type.toLowerCase();
    if (type === 'checkbox' || type === 'radio') {
      return element.checked ? 'true' : 'false';
    }
  }

  for (const attribute of ['aria-pressed', 'aria-expanded', 'aria-checked', 'aria-selected']) {
    const value = element.getAttribute(attribute);
    if (value === 'true' || value === 'false') {
      return value;
    }
  }

  // Grafana labels these buttons by the action they perform, so "Collapse X"
  // means X is currently expanded.
  const label = element.getAttribute('aria-label')?.toLowerCase() ?? '';
  if (label.includes('collapse')) {
    return 'true';
  }
  if (label.includes('expand')) {
    return 'false';
  }

  return 'unknown';
}

/**
 * Where the state for a given target lives, relative to the selected element.
 * An explicitly named attribute is resolved by that attribute; otherwise we
 * descend to the nearest control that carries a standard signal.
 */
export function resolveStateSource(element: Element, target: TargetState): Element {
  if (target.attribute) {
    return findAttributeSource(element, target.attribute) ?? element;
  }
  return findStatefulControl(element);
}

/** `null` when the control exposes no readable state. */
export function satisfiesTargetState(element: Element, target: TargetState): boolean | null {
  if (target.attribute) {
    const actual = element.getAttribute(target.attribute);
    return actual === null ? null : actual === target.value;
  }

  const state = readToggleState(element);
  return state === 'unknown' ? null : state === target.value;
}
