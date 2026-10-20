import { isElementVisible, isReplaySafeControl } from './element-validator';
import { resolveSelectorPipeline } from './selector-pipeline';
import { findStatefulControl, parseTargetState, resolveStateSource, satisfiesTargetState } from './toggle-state';

export type TargetStateRead =
  { state: 'satisfied' } | { state: 'replayable'; control: HTMLElement } | { state: 'blocked' };

const BLOCKED: TargetStateRead = { state: 'blocked' };

export async function readTargetState(
  refTarget: string,
  targetAction: string,
  rawState: boolean | string
): Promise<TargetStateRead> {
  const target = parseTargetState(rawState);
  if (!target) {
    return BLOCKED;
  }
  try {
    const resolved = await resolveSelectorPipeline({
      reftarget: refTarget,
      action: targetAction,
      delays: [],
      relaxOnRetry: false,
    });
    if (resolved?.elements.length !== 1) {
      return BLOCKED;
    }
    const element = resolved.element;
    const satisfied = satisfiesTargetState(resolveStateSource(element, target), target);
    if (satisfied === true) {
      return { state: 'satisfied' };
    }
    if (satisfied === null) {
      return BLOCKED;
    }
    const control = [element, findStatefulControl(element)].find(
      (candidate): candidate is HTMLElement =>
        candidate instanceof HTMLElement && isElementVisible(candidate) && isReplaySafeControl(candidate)
    );
    return control ? { state: 'replayable', control } : BLOCKED;
  } catch {
    return BLOCKED;
  }
}
