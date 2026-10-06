import { matchesFormfillState, matchesPassiveAction, observePassiveActions } from './passive-action';
import { findButtonByText, querySelectorAllEnhanced } from '../../lib/dom';

jest.mock('../../lib/dom', () => ({
  querySelectorAllEnhanced: jest.fn((selector: string) => ({ elements: [...document.querySelectorAll(selector)] })),
  findButtonByText: jest.fn((text: string) =>
    [...document.querySelectorAll('button')].filter((element) => element.textContent === text)
  ),
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

it('rejects an event the action cannot use before resolving any elements', () => {
  document.body.innerHTML = '<button id="save">Save</button>';
  jest.mocked(querySelectorAllEnhanced).mockClear();
  jest.mocked(findButtonByText).mockClear();
  const save = document.querySelector('#save')!;
  expect(matchesPassiveAction({ targetAction: 'button', refTarget: 'Save' }, eventOn(save, 'mouseover'))).toBe(false);
  expect(matchesPassiveAction({ targetAction: 'noop', refTarget: '#save' }, eventOn(save))).toBe(false);
  expect(querySelectorAllEnhanced).not.toHaveBeenCalled();
  expect(findButtonByText).not.toHaveBeenCalled();
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

describe('formfill state', () => {
  const formfill = (refTarget: string, targetValue: string) => ({ targetAction: 'formfill', refTarget, targetValue });

  it('reads the choice a select renders beside its cleared input', () => {
    document.body.innerHTML = `
      <div class="value-container">
        <div>Random Walk</div>
        <div data-value=""><input role="combobox" aria-autocomplete="list" aria-label="scenario" value=""></div>
      </div>`;
    expect(matchesFormfillState(formfill('input[aria-label="scenario"]', 'Random Walk'))).toBe(true);
    expect(matchesFormfillState(formfill('input[aria-label="scenario"]', 'CSV Content'))).toBe(false);
  });

  it('reads a picker that shows its selection as the input placeholder', () => {
    document.body.innerHTML =
      '<input aria-autocomplete="list" aria-label="data source" placeholder="TestData" value="">';
    expect(matchesFormfillState(formfill('input[aria-label="data source"]', 'TestData'))).toBe(true);
  });

  it('does not treat a plain input hint as a value', () => {
    document.body.innerHTML = '<input aria-label="title" placeholder="My dashboard" value="">';
    expect(matchesFormfillState(formfill('input[aria-label="title"]', 'My dashboard'))).toBe(false);
  });

  it('reads native select options and typed values', () => {
    document.body.innerHTML = `
      <select aria-label="unit"><option value="ms">Milliseconds</option><option value="s" selected>Seconds</option></select>
      <input aria-label="name" value="walker=jack">`;
    expect(matchesFormfillState(formfill('select[aria-label="unit"]', 'Seconds'))).toBe(true);
    expect(matchesFormfillState(formfill('input[aria-label="name"]', 'walker=jack'))).toBe(true);
  });

  it('never reads a field inside the guide or a clear-only value', () => {
    document.body.innerHTML = '<div class="interactive-step"><input aria-label="inside" value="TestData"></div>';
    expect(matchesFormfillState(formfill('input[aria-label="inside"]', 'TestData'))).toBe(false);
    document.body.innerHTML = '<input aria-label="cleared" value="">';
    expect(matchesFormfillState(formfill('input[aria-label="cleared"]', '@@CLEAR@@'))).toBe(false);
  });

  it('settles once after clicks and keys, but not after mouse movement', () => {
    jest.useFakeTimers();
    try {
      document.body.innerHTML = '<button id="option">Random Walk</button>';
      const settled = jest.fn();
      const stop = observePassiveActions(() => {}, settled);
      const option = document.querySelector('#option')!;
      eventOn(option, 'mouseover');
      jest.advanceTimersByTime(500);
      expect(settled).not.toHaveBeenCalled();
      eventOn(option);
      option.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
      jest.advanceTimersByTime(500);
      expect(settled).toHaveBeenCalledTimes(1);
      stop();
      eventOn(option);
      jest.advanceTimersByTime(500);
      expect(settled).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
