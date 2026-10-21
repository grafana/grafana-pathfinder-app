import { inspectRecovery, restoreRecovery, type RecoveryAdapter } from './section-recovery';
import type { RecoveryAction, RecoveryCheck, RecoveryCondition } from './section-recovery-plan';

const id = (condition: RecoveryCondition) =>
  condition.kind === 'requirement'
    ? condition.requirement
    : condition.kind === 'resume-location'
      ? 'resume-location'
      : condition.refTarget;

const visibleState = (refTarget: string): RecoveryCondition => ({
  kind: 'target-state',
  refTarget,
  targetAction: 'button',
  targetState: 'aria-expanded:true',
});
const toggle = (refTarget: string, objective: string): RecoveryAction => ({
  kind: 'toggle',
  refTarget,
  targetAction: 'button',
  targetState: 'aria-expanded:true',
  objectives: [visibleState(objective)],
});

const page: RecoveryCheck = { kind: 'requirement', requirement: 'on-page:/dashboards' };
const dialog: RecoveryCheck = {
  kind: 'target-present',
  refTarget: '#dialog',
  targetAction: 'button',
  recover: [toggle('#menu-button', '#menu'), toggle('#details', '#dialog')],
};
const checks = [page, dialog];

function fakeAdapter(initial: string[], replayable = true) {
  const ready = new Set(initial);
  const adapter: RecoveryAdapter = {
    check: jest.fn(async (condition) => ({
      passed: ready.has(id(condition)),
      canRestore: condition.kind === 'requirement' && !ready.has(id(condition)),
    })),
    restore: jest.fn(async (condition) => {
      ready.add(id(condition));
      return true;
    }),
    replay: jest.fn(async (action) => {
      ready.add(action.kind === 'toggle' && action.refTarget === '#menu-button' ? '#menu' : '#dialog');
      return true;
    }),
    canReplay: jest.fn(async () => replayable),
  };
  return { adapter, ready };
}

it('repairs the page, then replays only the toggles whose state no longer holds', async () => {
  const { adapter } = fakeAdapter(['#menu']);
  expect(await restoreRecovery(checks, adapter, new AbortController().signal)).toEqual({
    passed: true,
    canRestore: false,
  });
  expect(adapter.restore).toHaveBeenCalledWith(page);
  expect(adapter.replay).toHaveBeenCalledTimes(1);
  expect(adapter.replay).toHaveBeenCalledWith(dialog.recover![1]);
});

it('does not inspect later checks while the page is wrong', async () => {
  const { adapter } = fakeAdapter([]);
  expect(await inspectRecovery(checks, adapter)).toMatchObject({ passed: false, checkIndex: 0 });
  expect(adapter.check).toHaveBeenCalledTimes(1);
});

it('offers a recipe only when its first unmet step can actually be replayed', async () => {
  expect(await inspectRecovery(checks, fakeAdapter([page.requirement]).adapter)).toMatchObject({
    passed: false,
    canRestore: true,
    checkIndex: 1,
  });
  expect(await inspectRecovery(checks, fakeAdapter([page.requirement], false).adapter)).toMatchObject({
    canRestore: false,
  });
  const allSetUp = fakeAdapter([page.requirement, '#menu']);
  allSetUp.ready.delete('#dialog');
  const nothingToReplay: RecoveryCheck = { ...dialog, recover: [toggle('#menu-button', '#menu')] };
  expect(await inspectRecovery([page, nothingToReplay], allSetUp.adapter)).toMatchObject({ canRestore: false });
});

it('skips the whole recipe when the final view is already back', async () => {
  const { adapter } = fakeAdapter([page.requirement, '#dialog']);
  expect(await restoreRecovery(checks, adapter, new AbortController().signal)).toMatchObject({ passed: true });
  expect(adapter.replay).not.toHaveBeenCalled();
});

it('stops immediately when an earlier action restores the final view', async () => {
  const { adapter, ready } = fakeAdapter([page.requirement]);
  adapter.replay = jest.fn(async () => {
    ready.add('#dialog');
    return true;
  });
  expect(await restoreRecovery(checks, adapter, new AbortController().signal)).toMatchObject({ passed: true });
  expect(adapter.replay).toHaveBeenCalledTimes(1);
});

it('gives up with a reason when a repair does not take', async () => {
  jest.useFakeTimers();
  const { adapter } = fakeAdapter([]);
  adapter.restore = jest.fn(async () => true);
  const result = restoreRecovery(checks, adapter, new AbortController().signal);
  await jest.runAllTimersAsync();
  expect(await result).toMatchObject({ passed: false, canRestore: false, gaveUp: true, failure: 'drifted' });
  expect(adapter.restore).toHaveBeenCalledTimes(1);
  jest.useRealTimers();
});

it('gives up without replaying the next action when an objective never appears', async () => {
  jest.useFakeTimers();
  const { adapter } = fakeAdapter([page.requirement]);
  adapter.replay = jest.fn(async () => true);
  const result = restoreRecovery(checks, adapter, new AbortController().signal);
  await jest.runAllTimersAsync();
  expect(await result).toMatchObject({ passed: false, gaveUp: true, failure: 'repair_failed' });
  expect(adapter.replay).toHaveBeenCalledTimes(1);
  jest.useRealTimers();
});

it('waits for a recipe target to mount before giving up', async () => {
  const { adapter } = fakeAdapter([page.requirement, '#menu']);
  const replay = adapter.replay;
  let attempts = 0;
  adapter.replay = jest.fn(async (action) => (++attempts < 3 ? false : replay(action)));
  expect(await restoreRecovery(checks, adapter, new AbortController().signal)).toMatchObject({ passed: true });
  expect(adapter.replay).toHaveBeenCalledTimes(3);
});

it('waits for controls to mount after a page repair before repairing the next check', async () => {
  jest.useFakeTimers();
  let mounted = false;
  const { adapter, ready } = fakeAdapter(['#menu']);
  adapter.restore = jest.fn(async (condition) => {
    ready.add(id(condition));
    setTimeout(() => {
      mounted = true;
    }, 700);
    return true;
  });
  adapter.canReplay = jest.fn(async () => mounted);
  const result = restoreRecovery(checks, adapter, new AbortController().signal);
  await jest.runAllTimersAsync();
  expect(await result).toMatchObject({ passed: true });
  jest.useRealTimers();
});

it('stops without repairing anything once cancelled', async () => {
  const controller = new AbortController();
  const { adapter } = fakeAdapter([]);
  adapter.check = jest.fn(async () => {
    controller.abort();
    return { passed: false, canRestore: true };
  });
  expect(await restoreRecovery(checks, adapter, controller.signal)).toEqual({ passed: false, canRestore: false });
  expect(adapter.restore).not.toHaveBeenCalled();
});

it('never replays on a page the learner moved to while it waited for a control to mount', async () => {
  let page = '/explore';
  const destinationClicks: string[] = [];
  const onPage: RecoveryAction = { kind: 'resume-location', objectives: [{ kind: 'resume-location' }] };
  const row = toggle('#row', '#row-open');
  const target: RecoveryCheck = {
    kind: 'target-present',
    refTarget: '#run',
    targetAction: 'button',
    recover: [onPage, row],
  };
  const adapter: RecoveryAdapter = {
    check: jest.fn(async (condition) => ({
      passed: condition.kind === 'resume-location' ? page === '/explore' : false,
      canRestore: false,
    })),
    restore: jest.fn(async () => false),
    canReplay: jest.fn(async () => true),
    replay: jest.fn(async () => {
      if (page === '/explore') {
        page = '/dashboards';
        return false;
      }
      destinationClicks.push(page);
      return true;
    }),
  };
  expect(await restoreRecovery([target], adapter, new AbortController().signal)).toMatchObject({
    passed: false,
    gaveUp: true,
  });
  expect(destinationClicks).toEqual([]);
});
