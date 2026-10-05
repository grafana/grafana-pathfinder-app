import { saveObservationHandoff, takeObservationHandoff } from './handoff';

beforeEach(() => {
  localStorage.clear();
});

it('transfers partial cursors once and only to the same guide', () => {
  saveObservationHandoff('guide-a', { step: 1 });
  expect(takeObservationHandoff('guide-b')).toEqual({});
  expect(takeObservationHandoff('guide-a')).toEqual({ step: 1 });
  expect(takeObservationHandoff('guide-a')).toEqual({});
});

it('expires abandoned handoffs before a later guide session', () => {
  jest.useFakeTimers();
  saveObservationHandoff('guide', { step: 1 });
  jest.advanceTimersByTime(10_001);
  expect(takeObservationHandoff('guide')).toEqual({});
  jest.useRealTimers();
});
