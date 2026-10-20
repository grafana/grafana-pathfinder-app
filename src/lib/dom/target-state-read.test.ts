import { readTargetState } from './target-state-read';

jest.mock('./selector-resolver', () => ({ resolveSelector: (value: string) => value }));
jest.mock('./element-validator', () => ({
  ...jest.requireActual('./element-validator'),
  isElementVisible: () => true,
}));

beforeEach(() => document.body.replaceChildren());

function add(html: string): HTMLElement {
  document.body.insertAdjacentHTML('beforeend', html);
  return document.body.lastElementChild as HTMLElement;
}

it('reports a control already in its target state', async () => {
  add('<button type="button" id="row" aria-expanded="true">Row</button>');
  expect(await readTargetState('#row', 'button', 'aria-expanded:true')).toEqual({ state: 'satisfied' });
});

it('offers a replay-safe control that is in the other state', async () => {
  const row = add('<button type="button" id="row" aria-expanded="false">Row</button>');
  expect(await readTargetState('#row', 'highlight', 'aria-expanded:true')).toEqual({
    state: 'replayable',
    control: row,
  });
});

it.each([
  ['the state cannot be read', '<button type="button" id="row">Row</button>'],
  ['the control would submit a form', '<form><button id="row" aria-expanded="false">Row</button></form>'],
  ['the control is a link', '<a href="/x" id="row" role="button" aria-expanded="false">Row</a>'],
])('never offers a click when %s', async (_name, html) => {
  add(html);
  expect(await readTargetState('#row', 'button', 'aria-expanded:true')).toEqual({ state: 'blocked' });
});

it('blocks ambiguous, missing and malformed targets', async () => {
  add('<button type="button" class="row" aria-expanded="false"></button>');
  add('<button type="button" class="row" aria-expanded="false"></button>');
  expect(await readTargetState('.row', 'button', 'aria-expanded:true')).toEqual({ state: 'blocked' });
  expect(await readTargetState('#missing', 'button', 'aria-expanded:true')).toEqual({ state: 'blocked' });
  expect(await readTargetState('.row', 'button', '')).toEqual({ state: 'blocked' });
});
