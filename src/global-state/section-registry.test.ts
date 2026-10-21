import {
  arePreviousSectionsDone,
  clearSectionDone,
  registerSectionSteps,
  resetRegistry,
  setSectionDone,
  subscribeSectionDone,
} from './section-registry';

beforeEach(() => {
  resetRegistry();
  ['first', 'second', 'third'].forEach(clearSectionDone);
});

it('is reached only once every earlier reporting section is done', () => {
  registerSectionSteps('first', 1, 0);
  registerSectionSteps('standalone', 2, 1);
  registerSectionSteps('second', 1, 2);
  registerSectionSteps('third', 1, 3);
  expect(arePreviousSectionsDone('first')).toBe(true);
  setSectionDone('first', false);
  setSectionDone('second', false);
  expect(arePreviousSectionsDone('second')).toBe(false);
  expect(arePreviousSectionsDone('third')).toBe(false);
  setSectionDone('first', true);
  expect(arePreviousSectionsDone('second')).toBe(true);
  expect(arePreviousSectionsDone('third')).toBe(false);
  clearSectionDone('second');
  expect(arePreviousSectionsDone('third')).toBe(true);
});

it('notifies subscribers only when a section changes', () => {
  const listener = jest.fn();
  const unsubscribe = subscribeSectionDone(listener);
  setSectionDone('first', false);
  setSectionDone('first', false);
  setSectionDone('first', true);
  unsubscribe();
  setSectionDone('first', false);
  expect(listener).toHaveBeenCalledTimes(2);
});

it('keeps what mounted sections reported when new content resets the registry', () => {
  const listener = jest.fn();
  const unsubscribe = subscribeSectionDone(listener);
  registerSectionSteps('first', 1, 0);
  registerSectionSteps('second', 1, 1);
  setSectionDone('first', false);
  listener.mockClear();
  resetRegistry();
  registerSectionSteps('first', 1, 0);
  registerSectionSteps('second', 1, 1);
  expect(arePreviousSectionsDone('second')).toBe(false);
  expect(listener).not.toHaveBeenCalled();
  unsubscribe();
});
