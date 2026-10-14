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
  expect(await result).toMatchObject({ passed: false, canRestore: false, gaveUp: true });
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

const dialogCheckpoint: JsonSectionCheckpoint = {
  checks: [
    { requirement: 'on-page:/dashboards' },
    {
      target: '#dialog',
      state: 'visible',
      recover: [
        {
          action: 'button',
          reftarget: '#menu-button',
          replaySafe: true,
          objectives: [{ target: '#menu', state: 'visible' }],
        },
        {
          action: 'button',
          reftarget: '#details',
          replaySafe: true,
          objectives: [{ target: '#dialog', state: 'visible' }],
        },
      ],
    },
  ],
};

function dialogAdapter(initial: string[]) {
  const visible = new Set(initial);
  const adapter: CheckpointAdapter = {
    check: jest.fn(async (check) => ({
      passed: 'requirement' in check || visible.has(check.target),
      canRestore: false,
    })),
    restore: jest.fn(),
    replay: jest.fn(async (step) => {
      visible.add(step.reftarget === '#menu-button' ? '#menu' : '#dialog');
      return true;
    }),
  };
  return { adapter, visible };
}

it('offers an authored recovery recipe and skips actions whose live objectives already hold', async () => {
  const { adapter } = dialogAdapter(['#menu']);
  const signal = new AbortController().signal;
  expect(await inspectCheckpoint(dialogCheckpoint, adapter, signal)).toMatchObject({ canRestore: true });
  expect(await restoreCheckpoint(dialogCheckpoint, adapter, signal)).toMatchObject({ passed: true });
  expect(adapter.replay).toHaveBeenCalledTimes(1);
  expect(adapter.replay).toHaveBeenCalledWith(dialogCheckpoint.checks[1]!.recover![1]);
});

it('skips the entire recipe when the final view is ready, even if its setup menu has closed', async () => {
  const { adapter } = dialogAdapter(['#dialog']);
  expect(await restoreCheckpoint(dialogCheckpoint, adapter, new AbortController().signal)).toMatchObject({
    passed: true,
  });
  expect(adapter.replay).not.toHaveBeenCalled();
});

it('stops immediately when an earlier action achieves the final checkpoint', async () => {
  const { adapter, visible } = dialogAdapter([]);
  adapter.replay = jest.fn(async () => {
    visible.add('#dialog');
    return true;
  });
  expect(await restoreCheckpoint(dialogCheckpoint, adapter, new AbortController().signal)).toMatchObject({
    passed: true,
  });
  expect(adapter.replay).toHaveBeenCalledTimes(1);
});

it('does not replay the next action when an objective never appears', async () => {
  jest.useFakeTimers();
  const { adapter } = dialogAdapter([]);
  adapter.replay = jest.fn(async () => true);
  const result = restoreCheckpoint(dialogCheckpoint, adapter, new AbortController().signal);
  await jest.runAllTimersAsync();
  expect(await result).toMatchObject({ passed: false, canRestore: false, gaveUp: true });
  expect(adapter.replay).toHaveBeenCalledTimes(1);
  jest.useRealTimers();
});

it('cancels while waiting for a replay objective without running the next action', async () => {
  const { adapter } = dialogAdapter([]);
  const controller = new AbortController();
  adapter.replay = jest.fn(async () => {
    controller.abort();
    return true;
  });
  expect(await restoreCheckpoint(dialogCheckpoint, adapter, controller.signal)).toMatchObject({ passed: false });
  expect(adapter.replay).toHaveBeenCalledTimes(1);
});

it('passes over checks the guide cannot verify and reports them', async () => {
  const adapter = {
    check: jest.fn(async (check) =>
      'target' in check
        ? { passed: true, canRestore: false, unverifiable: 'ambiguous' }
        : { passed: true, canRestore: false }
    ),
    restore: jest.fn(),
  };
  expect(await inspectCheckpoint(checkpoint, adapter)).toEqual({
    passed: true,
    canRestore: false,
    unverifiableChecks: [{ checkIndex: 1, reason: 'ambiguous' }],
  });
});
