import { inspectCheckpoint, restoreCheckpoint, type CheckpointAdapter } from './section-checkpoint';
import type { JsonSectionCheckpoint } from '../types/json-guide.types';

const checkpoint: JsonSectionCheckpoint = {
  checks: [{ requirement: 'on-page:/dashboards' }, { target: '#options', state: 'expanded' }],
};

it('restores in order, verifies each action and never replays satisfied conditions', async () => {
  const ready = new Set<unknown>();
  const adapter: CheckpointAdapter = {
    check: jest.fn(async (check) => ({ passed: ready.has(check), canRestore: !ready.has(check) })),
    restore: jest.fn(async (check) => {
      ready.add(check);
      return true;
    }),
  };
  expect(await restoreCheckpoint(checkpoint, adapter, new AbortController().signal)).toEqual({
    passed: true,
    canRestore: false,
  });
  expect(adapter.restore).toHaveBeenNthCalledWith(1, checkpoint.checks[0]);
  expect(adapter.restore).toHaveBeenNthCalledWith(2, checkpoint.checks[1]);
  await restoreCheckpoint(checkpoint, adapter, new AbortController().signal);
  expect(adapter.restore).toHaveBeenCalledTimes(2);
});

it('does not inspect later controls on the wrong page', async () => {
  const adapter = { check: jest.fn(async () => ({ passed: false, canRestore: true })), restore: jest.fn() };
  expect(await inspectCheckpoint(checkpoint, adapter)).toMatchObject({ passed: false, checkIndex: 0 });
  expect(adapter.check).toHaveBeenCalledTimes(1);
});

it('stops at manual recovery without replaying later actions', async () => {
  const adapter = { check: jest.fn(async () => ({ passed: false, canRestore: false })), restore: jest.fn() };
  expect(await restoreCheckpoint(checkpoint, adapter, new AbortController().signal)).toMatchObject({ passed: false });
  expect(adapter.restore).not.toHaveBeenCalled();
});

it('aborts after an in-flight check without performing a repair', async () => {
  const controller = new AbortController();
  const adapter = {
    check: jest.fn(async () => {
      controller.abort();
      return { passed: false, canRestore: true };
    }),
    restore: jest.fn(),
  };
  expect(await restoreCheckpoint(checkpoint, adapter, controller.signal)).toMatchObject({
    passed: false,
    canRestore: false,
  });
  expect(adapter.restore).not.toHaveBeenCalled();
});

it('does not declare success when an action never establishes its condition', async () => {
  jest.useFakeTimers();
  const adapter = {
    check: jest.fn(async () => ({ passed: false, canRestore: true })),
    restore: jest.fn(async () => true),
  };
  const result = restoreCheckpoint(checkpoint, adapter, new AbortController().signal);
  await jest.runAllTimersAsync();
  expect(await result).toMatchObject({ passed: false });
  expect(adapter.restore).toHaveBeenCalledTimes(1);
  jest.useRealTimers();
});

it('rechecks earlier conditions and stops if they drift again', async () => {
  let stage = 0;
  const adapter: CheckpointAdapter = {
    check: async (check) => ({ passed: check === checkpoint.checks[0] ? stage === 1 : stage === 2, canRestore: true }),
    restore: jest.fn(async () => {
      stage++;
      return true;
    }),
  };
  expect(await restoreCheckpoint(checkpoint, adapter, new AbortController().signal)).toMatchObject({
    passed: false,
    checkIndex: 0,
  });
  expect(adapter.restore).toHaveBeenCalledTimes(2);
});

it('waits for controls to mount after navigation before restoring the next condition', async () => {
  jest.useFakeTimers();
  let navigated = false;
  let mounted = false;
  let expanded = false;
  const adapter: CheckpointAdapter = {
    check: async (check) =>
      check === checkpoint.checks[0]
        ? { passed: navigated, canRestore: !navigated }
        : { passed: expanded, canRestore: mounted && !expanded },
    restore: jest.fn(async (check) => {
      if (check === checkpoint.checks[0]) {
        navigated = true;
        setTimeout(() => {
          mounted = true;
        }, 700);
      } else {
        expanded = true;
      }
      return true;
    }),
  };
  const result = restoreCheckpoint(checkpoint, adapter, new AbortController().signal);
  await jest.runAllTimersAsync();
  expect(await result).toMatchObject({ passed: true });
  expect(adapter.restore).toHaveBeenCalledTimes(2);
  jest.useRealTimers();
});
