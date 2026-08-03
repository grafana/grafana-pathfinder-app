import { describeElement } from '../../lib/dom';
import {
  findStatefulControl,
  parseTargetState,
  resolveStateSource,
  satisfiesTargetState,
  type TargetState,
} from '../../lib/dom/toggle-state';
import { logger } from '../../lib/logging';

// Rendered as HTML in the comment box, so it needs a block wrapper to sit above
// the author's own comment rather than running into it.
const ALREADY_IN_STATE_NOTE = '<p>Already in the right position — nothing to change.</p>';

/** True when the control already satisfies the authored `targetState`. */
export function isAlreadyInTargetState(element: Element, rawTargetState?: boolean | string): boolean {
  const target = parseTargetState(rawTargetState);
  if (!target) {
    return false;
  }
  return satisfiesTargetState(resolveStateSource(element, target), target) === true;
}

/**
 * Explain that there is nothing to do, so the comment box stops instructing the
 * user to change something that is already correct. Mirrors the hidden-element
 * warning in `navigation-manager`.
 */
export function commentForTargetState(
  comment: string | undefined,
  element: Element,
  rawTargetState?: boolean | string
): string | undefined {
  if (!isAlreadyInTargetState(element, rawTargetState)) {
    return comment;
  }
  return comment ? `${ALREADY_IN_STATE_NOTE}${comment}` : ALREADY_IN_STATE_NOTE;
}

/**
 * Drive a control to the state the author asked for, instead of clicking it
 * blindly.
 *
 * A control that never reaches the requested state warns but still lets the
 * step complete. Blocking would strand the user on a step they cannot pass,
 * and it would make `targetState` the only action in the engine that fails
 * hard — every other handler logs and continues.
 */
export async function clickToTargetState(
  element: HTMLElement,
  target: TargetState,
  waitForReactUpdates: () => Promise<void>
): Promise<void> {
  const control = findStatefulControl(element);
  // Read where the state lives, click the control that changes it — they are
  // not always the same element.
  const stateSource = resolveStateSource(element, target);
  const satisfied = satisfiesTargetState(stateSource, target);

  if (satisfied === null) {
    logger.warn('targetState is set but the control exposes no readable state; clicking unconditionally', {
      element: describeElement(element),
      target,
    });
    element.click();
    return;
  }

  if (satisfied) {
    return;
  }

  (control as HTMLElement).click();
  await waitForReactUpdates();

  if (satisfiesTargetState(stateSource, target) === false) {
    logger.warn('Clicked to reach targetState but the control did not change', {
      element: describeElement(element),
      target,
    });
  }
}
