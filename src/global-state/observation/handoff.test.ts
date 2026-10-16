import { saveObservationHandoff, takeObservationHandoff } from './handoff';

beforeEach(() => {
  localStorage.clear();
});

const empty = { cursors: {}, started: [] };
const skipped = { id: 'guide/second/skipped', stepId: 'skipped', guideKey: 'guide-a', sectionId: 'second' };

it('transfers partial cursors and started steps once and only to the same guide', () => {
  saveObservationHandoff('guide-a', { cursors: { step: 1 }, started: [skipped] });
  expect(takeObservationHandoff('guide-b')).toEqual(empty);
  expect(takeObservationHandoff('guide-a')).toEqual({ cursors: { step: 1 }, started: [skipped] });
  expect(takeObservationHandoff('guide-a')).toEqual(empty);
});

it('expires abandoned handoffs before a later guide session', () => {
  jest.useFakeTimers();
  saveObservationHandoff('guide', { cursors: { step: 1 }, started: [] });
  jest.advanceTimersByTime(10_001);
  expect(takeObservationHandoff('guide')).toEqual(empty);
  jest.useRealTimers();
});

it('drops malformed started entries', () => {
  localStorage.setItem(
    'pathfinder-observation-handoff',
    JSON.stringify({
      contentKey: 'guide',
      cursors: {},
      started: [
        { id: 'ok', stepId: 'ok', sectionId: 'first', extra: 'dropped' },
        'bare-id',
        { id: 'x'.repeat(4097), stepId: 'long' },
        { id: 'no-step' },
        { id: 'bad-section', stepId: 's', sectionId: 7 },
      ],
      expires: Date.now() + 1000,
    })
  );
  expect(takeObservationHandoff('guide')).toEqual({
    cursors: {},
    started: [{ id: 'ok', stepId: 'ok', sectionId: 'first' }],
  });
});
