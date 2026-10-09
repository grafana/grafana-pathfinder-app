import { locationService } from '@grafana/runtime';
import type { ObservedAction } from '../../global-state/observation/coordinator';
import { nextObservationStamp } from '../../global-state/observation/action-progress';
import { resolveSelector } from '../../lib/dom/selector-resolver';
import { querySelectorAllEnhanced, findButtonByText } from '../../lib/dom';
import { matchFormValue } from './action-matcher';

const MATCHING_EVENTS: Partial<Record<string, readonly string[]>> = {
  button: ['click'],
  highlight: ['click'],
  hover: ['mouseover'],
  formfill: ['input', 'change'],
};
const GUIDE_CONTENT = '.interactive-section, [data-pathfinder-guide], .interactive-step';
const FORM_FIELDS = 'input, textarea, select';
const SETTLE_MS = 150;

function resolveTargets(action: ObservedAction): Element[] {
  let elements: Element[] = [];
  try {
    elements = querySelectorAllEnhanced(resolveSelector(action.refTarget!)).elements;
  } catch {
    /* Button labels are not CSS selectors. */
  }
  if (!elements.length && action.targetAction === 'button') {
    elements = findButtonByText(action.refTarget!);
  }
  return elements;
}

function isComboboxInput(field: Element): boolean {
  return (
    field.hasAttribute('aria-autocomplete') ||
    field.getAttribute('role') === 'combobox' ||
    field.parentElement?.getAttribute('role') === 'combobox'
  );
}

// Select-style pickers clear their input once an option is chosen and render
// the choice beside it, as text or, for a compact data source picker, only as
// a logo labelled "<name> logo". Read the nearest ancestor that holds only this field.
function renderedSelection(field: Element): string[] {
  let container = field.parentElement;
  for (let depth = 0; container && depth < 3; depth++, container = container.parentElement) {
    if (container.querySelectorAll(FORM_FIELDS).length > 1) {
      return [];
    }
    const text = container.textContent?.trim();
    const logos = Array.from(container.querySelectorAll('img[alt]'), (img) =>
      img.getAttribute('alt')!.replace(/\s+logo$/i, '')
    );
    if (text || logos.length) {
      return [
        ...(text ? [text, ...Array.from(container.children, (child) => child.textContent?.trim() ?? '')] : []),
        ...logos,
      ];
    }
  }
  return [];
}

type FormField = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

function isFormField(element: unknown): element is FormField {
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  );
}

function formFieldOf(element: Element): FormField | undefined {
  const field = element.matches(FORM_FIELDS) ? element : element.querySelector(FORM_FIELDS);
  return isFormField(field) ? field : undefined;
}

export function formFieldValues(element: Element): string[] {
  const field = formFieldOf(element);
  if (!field) {
    return [];
  }
  const values = [field.value];
  if (field instanceof HTMLSelectElement) {
    values.push(...Array.from(field.selectedOptions, (option) => option.text));
  } else if (isComboboxInput(field)) {
    if (!field.value) {
      values.push(field.placeholder);
    }
    values.push(...renderedSelection(field));
  }
  return values.map((value) => value.trim()).filter(Boolean);
}

export function matchesFormfillState(action: ObservedAction, touched: (field: Element) => boolean): boolean {
  const expected = action.targetValue?.replace(/^@@CLEAR@@\s*/, '');
  if (action.targetAction !== 'formfill' || !action.refTarget || !expected) {
    return false;
  }
  return resolveTargets(action).some((element) => {
    const field = formFieldOf(element);
    return (
      !!field &&
      touched(field) &&
      !element.closest(GUIDE_CONTENT) &&
      formFieldValues(field).some((value) => matchFormValue(value, expected).isMatch)
    );
  });
}

export function matchesPassiveAction(action: ObservedAction, event: Event): boolean {
  if (
    !(event.target instanceof Element) ||
    !action.refTarget ||
    !MATCHING_EVENTS[action.targetAction]?.includes(event.type)
  ) {
    return false;
  }
  const target = event.target;
  if (target.closest(GUIDE_CONTENT)) {
    return false;
  }
  const elements = resolveTargets(action);
  const matched = elements.find((element) => element === target || element.contains(target));
  if (!matched) {
    return false;
  }
  switch (action.targetAction) {
    case 'button':
    case 'highlight':
      return event.type === 'click';
    case 'hover':
      return (
        event.type === 'mouseover' &&
        (!(event instanceof MouseEvent) ||
          !(event.relatedTarget instanceof Node) ||
          !matched.contains(event.relatedTarget))
      );
    case 'formfill': {
      if (event.type !== 'input' && event.type !== 'change') {
        return false;
      }
      if (!(
        matched instanceof HTMLInputElement ||
        matched instanceof HTMLTextAreaElement ||
        matched instanceof HTMLSelectElement
      )) {
        return false;
      }
      return matchFormValue(matched.value, action.targetValue?.replace(/^@@CLEAR@@\s*/, '')).isMatch;
    }
    default:
      return false;
  }
}

export function observePassiveActions(
  onEvent: (event: Event) => void,
  onSettled?: (touched: (field: Element, since?: number) => boolean) => void
): () => void {
  const values = new WeakMap<Element, string>();
  const touchedFields = new WeakMap<Element, number>();
  const touched = (field: Element, since = 0) => (touchedFields.get(field) ?? 0) > since;
  let settling: ReturnType<typeof setTimeout> | undefined;
  const settle = () => {
    if (onSettled) {
      clearTimeout(settling);
      settling = setTimeout(() => onSettled(touched), SETTLE_MS);
    }
  };
  const touch = (event: Event) => {
    if (isFormField(event.target)) {
      touchedFields.set(event.target, nextObservationStamp());
    }
  };
  const listener = (event: Event) => {
    if (event.type !== 'mouseover') {
      settle();
    }
    const target = event.target;
    if ((event.type === 'input' || event.type === 'change') && isFormField(target)) {
      touchedFields.set(target, nextObservationStamp());
      if (values.get(target) === target.value) {
        return;
      }
      values.set(target, target.value);
    }
    onEvent(event);
  };
  const events = ['click', 'input', 'change', 'mouseover'];
  events.forEach((event) => document.addEventListener(event, listener, true));
  document.addEventListener('keydown', settle, true);
  document.addEventListener('focusin', touch, true);
  return () => {
    clearTimeout(settling);
    events.forEach((event) => document.removeEventListener(event, listener, true));
    document.removeEventListener('keydown', settle, true);
    document.removeEventListener('focusin', touch, true);
  };
}

export function matchesPassiveNavigation(action: ObservedAction): boolean {
  if (action.targetAction !== 'navigate' || !action.refTarget) {
    return false;
  }
  try {
    const destination = new URL(action.refTarget, window.location.origin);
    return (
      destination.origin === window.location.origin &&
      destination.pathname === window.location.pathname &&
      destination.search === window.location.search
    );
  } catch {
    return false;
  }
}

export function observePassiveNavigation(onNavigate: () => void): () => void {
  let previousUrl = window.location.href;
  const changed = () => {
    if (previousUrl !== window.location.href) {
      previousUrl = window.location.href;
      onNavigate();
    }
  };
  const history = locationService?.getHistory?.().listen(changed);
  window.addEventListener('popstate', changed);
  window.addEventListener('hashchange', changed);
  return () => {
    history?.();
    window.removeEventListener('popstate', changed);
    window.removeEventListener('hashchange', changed);
  };
}
