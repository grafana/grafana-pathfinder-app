import { describeElement } from '../../lib/dom';
import {
  findStatefulControl,
  resolveStateSource,
  satisfiesTargetState,
  type TargetState,
} from '../../lib/dom/toggle-state';
import { logger } from '../../lib/logging';

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
