import { locationService } from '@grafana/runtime';
import type { ObservedAction } from '../../global-state/observation/coordinator';
import { resolveSelector } from '../../lib/dom/selector-resolver';
import { querySelectorAllEnhanced, findButtonByText } from '../../lib/dom';
import { matchFormValue } from './action-matcher';

const MATCHING_EVENTS: Partial<Record<string, readonly string[]>> = {
  button: ['click'],
  highlight: ['click'],
  hover: ['mouseover'],
  formfill: ['input', 'change'],
};

export function matchesPassiveAction(action: ObservedAction, event: Event): boolean {
  if (
    !(event.target instanceof Element) ||
    !action.refTarget ||
    !MATCHING_EVENTS[action.targetAction]?.includes(event.type)
  ) {
    return false;
  }
  const target = event.target;
  if (target.closest('.interactive-section, [data-pathfinder-guide], .interactive-step')) {
    return false;
  }
  const selector = resolveSelector(action.refTarget);
  let elements: Element[] = [];
  try {
    elements = querySelectorAllEnhanced(selector).elements;
  } catch {
    /* Button labels are not CSS selectors. */
  }
  if (!elements.length && action.targetAction === 'button') {
    elements = findButtonByText(action.refTarget);
  }
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
      return matchFormValue(matched.value, action.targetValue?.replace(/^@@CLEAR@@/, '')).isMatch;
    }
    default:
      return false;
  }
}

export function observePassiveActions(onEvent: (event: Event) => void): () => void {
  const values = new WeakMap<Element, string>();
  const listener = (event: Event) => {
    const target = event.target;
    if (
      (event.type === 'input' || event.type === 'change') &&
      (target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement)
    ) {
      if (values.get(target) === target.value) {
        return;
      }
      values.set(target, target.value);
    }
    onEvent(event);
  };
  const events = ['click', 'input', 'change', 'mouseover'];
  events.forEach((event) => document.addEventListener(event, listener, true));
  return () => events.forEach((event) => document.removeEventListener(event, listener, true));
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
