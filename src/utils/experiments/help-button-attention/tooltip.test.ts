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
