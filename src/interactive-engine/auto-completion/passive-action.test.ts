import { matchesPassiveAction } from './passive-action';

jest.mock('../../lib/dom', () => ({
  querySelectorAllEnhanced: (selector: string) => ({ elements: [...document.querySelectorAll(selector)] }),
  findButtonByText: (text: string) =>
    [...document.querySelectorAll('button')].filter((element) => element.textContent === text),
}));
jest.mock('../../lib/dom/selector-resolver', () => ({ resolveSelector: (selector: string) => selector }));

function eventOn(element: Element, type = 'click') {
  const event = new MouseEvent(type, { bubbles: true, clientX: 10, clientY: 10 });
  element.dispatchEvent(event);
  return event;
}

afterEach(() => {
  document.body.replaceChildren();
});

it('matches a child of the target button, but never a nearby unrelated element', () => {
  document.body.innerHTML = '<button id="save"><span>Save</span></button><button id="other">Other</button>';
  const action = { targetAction: 'button', refTarget: '#save' };
  expect(matchesPassiveAction(action, eventOn(document.querySelector('span')!))).toBe(true);
  expect(matchesPassiveAction(action, eventOn(document.querySelector('#other')!))).toBe(false);
});

it('requires the authored form value and a real value-change event', () => {
  document.body.innerHTML = '<input id="name">';
  const input = document.querySelector('input')!;
  const action = { targetAction: 'formfill', refTarget: '#name', targetValue: '@@CLEAR@@example' };
  input.value = 'wrong';
  expect(matchesPassiveAction(action, eventOn(input, 'input'))).toBe(false);
  input.value = 'example';
  expect(matchesPassiveAction(action, eventOn(input))).toBe(false);
  expect(matchesPassiveAction(action, eventOn(input, 'change'))).toBe(true);
});

it('excludes clicks inside the guide itself', () => {
  document.body.innerHTML = '<div class="interactive-step"><button id="save">Save</button></div>';
  expect(
    matchesPassiveAction({ targetAction: 'button', refTarget: '#save' }, eventOn(document.querySelector('button')!))
  ).toBe(false);
});

it('treats input and change for the same edit as one observed action', () => {
  const { observePassiveActions } = jest.requireActual('./passive-action');
  document.body.innerHTML = '<input id="name">';
  const input = document.querySelector('input')!;
  const events = jest.fn();
  const stop = observePassiveActions(events);
  input.value = 'first';
  eventOn(input, 'input');
  eventOn(input, 'change');
  expect(events).toHaveBeenCalledTimes(1);
  input.value = 'second';
  eventOn(input, 'input');
  expect(events).toHaveBeenCalledTimes(2);
  stop();
  eventOn(input, 'click');
  expect(events).toHaveBeenCalledTimes(2);
});
