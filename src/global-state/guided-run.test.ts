import { acquireGuidedRun } from './guided-run';

it('holds one run per tab and ignores release from an older cancelled run', () => {
  const first = acquireGuidedRun()!;
  expect(acquireGuidedRun()).toBeNull();
  first.cancel();
  expect(first.signal.aborted).toBe(true);
  const second = acquireGuidedRun()!;
  expect(second).not.toBeNull();
  first.release();
  expect(acquireGuidedRun()).toBeNull();
  second.release();
});
