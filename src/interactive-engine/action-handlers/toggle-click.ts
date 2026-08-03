import { describeElement } from '../../lib/dom';
import { findStatefulControl, satisfiesTargetState, type TargetState } from '../../lib/dom/toggle-state';
import { logger } from '../../lib/logging';

/**
 * Drive a control to the state the author asked for, instead of clicking it
 * blindly. Returns false when the click ran but the state did not change, so
 * the caller can surface a failure rather than reporting a false success.
 */
export async function clickToTargetState(
  element: HTMLElement,
  target: TargetState,
  waitForReactUpdates: () => Promise<void>
): Promise<boolean> {
  const control = findStatefulControl(element);
  const satisfied = satisfiesTargetState(control, target);

  if (satisfied === null) {
    logger.warn('targetState is set but the control exposes no readable state; clicking unconditionally', {
      element: describeElement(element),
      target,
    });
    element.click();
    return true;
  }

  if (satisfied) {
    return true;
  }

  (control as HTMLElement).click();
  await waitForReactUpdates();

  if (satisfiesTargetState(control, target) === false) {
    logger.warn('Clicked to reach targetState but the control did not change', {
      element: describeElement(element),
      target,
    });
    return false;
  }

  return true;
}
