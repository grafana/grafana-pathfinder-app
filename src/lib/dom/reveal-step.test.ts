import { REVEALED_STEP_CLASS, revealStep } from './reveal-step';

beforeEach(() => {
  jest.useFakeTimers();
  document.body.innerHTML = '<div data-step-id="s-1"></div><div data-step-id="s-2"></div>';
  Element.prototype.scrollIntoView = jest.fn();
});

afterEach(() => {
  jest.useRealTimers();
});

it('scrolls to the matching step and highlights it briefly', () => {
  const target = document.querySelector<HTMLElement>('[data-step-id="s-2"]')!;
  expect(revealStep('s-2')).toBe(true);
  expect(target.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
  expect(target.classList.contains(REVEALED_STEP_CLASS)).toBe(true);
  expect(document.querySelector('[data-step-id="s-1"]')!.classList.contains(REVEALED_STEP_CLASS)).toBe(false);
  jest.advanceTimersByTime(2000);
  expect(target.classList.contains(REVEALED_STEP_CLASS)).toBe(false);
});

it('restarts the highlight when revealed again', () => {
  const target = document.querySelector<HTMLElement>('[data-step-id="s-1"]')!;
  revealStep('s-1');
  jest.advanceTimersByTime(1500);
  revealStep('s-1');
  jest.advanceTimersByTime(1500);
  expect(target.classList.contains(REVEALED_STEP_CLASS)).toBe(true);
});

it('matches ids literally and reports a missing step', () => {
  expect(revealStep('"], *')).toBe(false);
  expect(revealStep('s-3')).toBe(false);
});
