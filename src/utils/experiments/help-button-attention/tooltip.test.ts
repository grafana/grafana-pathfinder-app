import { createTheme } from '@grafana/data';
import { randomUUID } from 'crypto';
import { showHelpButtonTooltip } from './tooltip';

let cleanup: () => void;
beforeEach(() => {
  Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: randomUUID });
});
afterEach(() => {
  cleanup?.();
  document.body.replaceChildren();
});

it.each(['close', 'escape'])('dismisses with %s, restores focus and removes only its own description', (method) => {
  const anchor = document.createElement('button');
  anchor.setAttribute('aria-describedby', 'existing-description');
  document.body.append(anchor);
  const click = jest.fn();
  anchor.addEventListener('click', click);
  const dismiss = jest.fn(() => cleanup());
  cleanup = showHelpButtonTooltip(
    anchor,
    createTheme(),
    {
      message: 'Try interactive learning',
      dismiss: 'Dismiss learning hint',
    },
    dismiss
  );
  const close = document.querySelector<HTMLButtonElement>('[aria-label="Dismiss learning hint"]')!;
  expect(document.body.textContent).toContain('Try interactive learning');
  expect(anchor.getAttribute('aria-describedby')).toContain('existing-description help-button-hint-');
  close.focus();
  if (method === 'close') {
    close.click();
  } else {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }
  expect(dismiss).toHaveBeenCalledTimes(1);
  expect(click).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(anchor);
  expect(anchor.getAttribute('aria-describedby')).toBe('existing-description');
  expect(document.querySelector('[data-testid="help-button-learning-hint"]')).toBeNull();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  expect(dismiss).toHaveBeenCalledTimes(1);
});

it('keeps its pointer aligned when the toolbar moves without resizing', () => {
  const anchor = document.createElement('button');
  document.body.append(anchor);
  let anchorLeft = 500;
  let nextFrame: FrameRequestCallback | undefined;
  const raf = jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    nextFrame = callback;
    return 1;
  });
  const rect = jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement
  ) {
    return (
      this === anchor ? { left: anchorLeft, right: anchorLeft + 32, width: 32, bottom: 40 } : { width: 220 }
    ) as DOMRect;
  });
  try {
    cleanup = showHelpButtonTooltip(
      anchor,
      createTheme(),
      { message: 'Try interactive learning', dismiss: 'Dismiss learning hint' },
      jest.fn()
    );
    const hint = document.querySelector<HTMLElement>('[data-testid="help-button-learning-hint"]')!;
    expect(hint.style.left).toBe('406px');
    anchorLeft = 420;
    nextFrame!(0);
    expect(hint.style.left).toBe('326px');
    const pointerCenter =
      Number.parseFloat(hint.style.left) + Number.parseFloat(hint.style.getPropertyValue('--help-hint-arrow')) + 4;
    expect(pointerCenter).toBe(anchorLeft + 16);
  } finally {
    cleanup();
    raf.mockRestore();
    rect.mockRestore();
  }
});
