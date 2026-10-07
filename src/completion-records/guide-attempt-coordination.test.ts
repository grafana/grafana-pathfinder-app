jest.mock('../utils/openfeature', () => ({ getFeatureFlagValue: () => true }));
import {
  clearAttempt,
  getOrMintAttempt,
  readAttempt,
  resolveAttemptMode,
  withAttemptLock,
  __resetAttemptsForTests,
} from './guide-attempts';
import { __setProgressRecordsCapabilityForTests } from './progress-records-capability';

const key = { guideSource: 'bundled', guideId: 'g' };

beforeEach(() => {
  localStorage.clear();
  __resetAttemptsForTests();
  __setProgressRecordsCapabilityForTests('yes');
});
afterEach(() => {
  Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
});

it('serializes competing mint operations before either caller can publish an attempt', async () => {
  let pending = Promise.resolve();
  const request = jest.fn((_name: string, work: () => void) => {
    pending = pending.then(work);
    return pending;
  });
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } });
  const ids: string[] = [];
  withAttemptLock(() =>
    ids.push(getOrMintAttempt(key, resolveAttemptMode, { nextId: () => 'a'.repeat(32) }).attempt.attemptId)
  );
  withAttemptLock(() =>
    ids.push(getOrMintAttempt(key, resolveAttemptMode, { nextId: () => 'b'.repeat(32) }).attempt.attemptId)
  );
  expect(ids).toEqual([]);
  await pending;
  expect(ids).toEqual(['a'.repeat(32), 'a'.repeat(32)]);
  expect(request.mock.calls.map(([name]) => name)).toEqual(['pathfinder-guide-attempts', 'pathfinder-guide-attempts']);
});

it('orders a reset between pending old progress and a new attempt', async () => {
  let pending = Promise.resolve();
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: (_name: string, work: () => void) => {
        pending = pending.then(work);
        return pending;
      },
    },
  });
  withAttemptLock(() => {
    getOrMintAttempt(key, resolveAttemptMode, { nextId: () => 'a'.repeat(32) });
  });
  withAttemptLock(() => clearAttempt(key));
  withAttemptLock(() => {
    getOrMintAttempt(key, resolveAttemptMode, { nextId: () => 'b'.repeat(32) });
  });
  await pending;
  expect(readAttempt(key)?.attemptId).toBe('b'.repeat(32));
});

it('preserves the completion path in analytics mode when lock acquisition fails', async () => {
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: () => Promise.reject(new Error('denied')),
    },
  });
  const modes: string[] = [];
  withAttemptLock(() => {
    modes.push(resolveAttemptMode());
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(modes).toEqual(['analytics']);
});

it('never replays work that throws after acquiring the lock', async () => {
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: (_name: string, work: () => void) => Promise.resolve().then(work),
    },
  });
  const work = jest.fn(() => {
    throw new Error('callback failed');
  });
  withAttemptLock(work);
  await Promise.resolve();
  await Promise.resolve();
  expect(work).toHaveBeenCalledTimes(1);
});

it('does not mint records-mode attempts without cross-tab coordination', () => {
  Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
  const work = jest.fn();
  withAttemptLock(work);
  expect(work).toHaveBeenCalledTimes(1);
  expect(resolveAttemptMode()).toBe('analytics');
});
