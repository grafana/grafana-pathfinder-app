export const REVEALED_STEP_CLASS = 'interactive-step-revealed';
const REVEAL_MS = 2000;

const revealTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

export function revealStep(stepId: string): boolean {
  const step = Array.from(document.querySelectorAll<HTMLElement>('[data-step-id]')).find(
    (element) => element.dataset.stepId === stepId
  );
  if (!step) {
    return false;
  }
  step.scrollIntoView({ behavior: 'smooth', block: 'center' });
  step.classList.add(REVEALED_STEP_CLASS);
  clearTimeout(revealTimers.get(step));
  revealTimers.set(
    step,
    setTimeout(() => step.classList.remove(REVEALED_STEP_CLASS), REVEAL_MS)
  );
  return true;
}
