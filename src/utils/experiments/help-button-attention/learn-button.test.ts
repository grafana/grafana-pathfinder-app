import { createTheme } from '@grafana/data';
import { showLearnButton } from './learn-button';

afterEach(() => {
  document.body.replaceChildren();
});

it('renders a labelled Learn button before Help, toggles its sparkle, and cleans up', () => {
  const help = document.createElement('button');
  document.body.append(help);
  const onClick = jest.fn();
  const learn = showLearnButton(help, createTheme(), 'Learn', onClick);
  expect(learn.element.nextElementSibling).toBe(help);
  expect(learn.element.type).toBe('button');
  expect(learn.element.textContent).toBe('Learn');
  expect(learn.element.querySelectorAll('[data-sparkle]')).toHaveLength(3);
  expect(learn.element.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(4);
  learn.setAttention(true);
  expect(learn.element.dataset.attention).toBe('true');
  learn.setAttention(false);
  expect(learn.element.dataset.attention).toBe('false');
  learn.element.click();
  expect(onClick).toHaveBeenCalledTimes(1);
  learn.remove();
  expect(document.querySelector('[data-testid="help-button-learn"]')).toBeNull();
  learn.element.click();
  expect(onClick).toHaveBeenCalledTimes(1);
});
