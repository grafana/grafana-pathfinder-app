import { act, renderHook } from '@testing-library/react';
import { useSectionRecovery } from './use-section-recovery';
import { createRecoveryAdapter } from '../../../requirements-manager';
import { inspectRecovery, restoreRecovery, type RecoveryResult } from '../../../recovery/section-recovery';
import type { SectionRecoveryPlan } from '../../../recovery/section-recovery-plan';

jest.mock('../../../requirements-manager', () => ({
  createRecoveryAdapter: jest.fn(() => ({})),
  useGuideRequirements: () => ({ checkPostconditions: jest.fn() }),
}));
jest.mock('../../../recovery/section-recovery', () => ({ inspectRecovery: jest.fn(), restoreRecovery: jest.fn() }));

const { locationService } = jest.requireActual('@grafana/runtime');
const inspect = jest.mocked(inspectRecovery);
const restore = jest.mocked(restoreRecovery);

const plan = (key = 'step-1'): SectionRecoveryPlan => ({
  cursorStepId: key,
  cursorAction: 'button',
  checks: [{ kind: 'requirement', requirement: 'on-page:/explore' }],
  key,
});
const PASS: RecoveryResult = { passed: true, canRestore: false };
const DRIFT: RecoveryResult = { passed: false, canRestore: true, checkIndex: 0 };
const STUCK: RecoveryResult = { passed: false, canRestore: false, checkIndex: 0 };

function render(options: { suspended?: boolean; enabled?: boolean; controllerMode?: boolean; key?: string } = {}) {
  const onEvent = jest.fn();
  const hook = renderHook(
    ({ suspended = false, enabled = true, controllerMode = false, key = 'step-1' }) =>
      useSectionRecovery(plan(key), 'section', enabled, controllerMode, { onEvent, suspended }),
    { initialProps: options }
  );
  return { ...hook, onEvent, events: () => onEvent.mock.calls.map(([event]) => event) };
}

async function settle(ms = 0) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

async function drift(hook: ReturnType<typeof render>) {
  inspect.mockResolvedValue(DRIFT);
  await act(async () => {
    await hook.result.current.recheck();
  });
  await settle(750);
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  inspect.mockResolvedValue(PASS);
});
afterEach(() => jest.useRealTimers());

it('never pauses a section whose plan has not passed yet', async () => {
  inspect.mockResolvedValue(DRIFT);
  const hook = render();
  await settle();
  await settle(750);
  await settle(750);
  expect(hook.result.current.paused).toBe(false);
  expect(hook.onEvent).not.toHaveBeenCalled();
});

it('pauses only after drift is seen twice, then reports the pause once', async () => {
  const hook = render();
  await settle();
  inspect.mockResolvedValue(DRIFT);
  await act(async () => {
    await hook.result.current.recheck();
  });
  expect(hook.result.current.paused).toBe(false);
  await settle(750);
  expect(hook.result.current.paused).toBe(true);
  await act(async () => {
    await hook.result.current.recheck();
  });
  expect(hook.events().filter((event) => event.kind === 'paused')).toEqual([
    { kind: 'paused', check: plan().checks[0], locationRestore: false },
  ]);
});

it('ignores drift that clears before it is confirmed', async () => {
  const hook = render();
  await settle();
  inspect.mockResolvedValueOnce(DRIFT);
  await act(async () => {
    await hook.result.current.recheck();
  });
  await settle(750);
  expect(hook.result.current.paused).toBe(false);
});

it('leaves the step to explain itself when nothing can be restored', async () => {
  const hook = render();
  await settle();
  inspect.mockResolvedValue(STUCK);
  await act(async () => {
    await hook.result.current.recheck();
  });
  await settle(750);
  expect(hook.result.current.paused).toBe(false);
});

it('restores, reports the outcome, and resolves the pause', async () => {
  const hook = render();
  await settle();
  await drift(hook);
  restore.mockResolvedValue(PASS);
  await act(async () => {
    await hook.result.current.restore();
  });
  expect(hook.result.current.paused).toBe(false);
  expect(hook.events().slice(-2)).toEqual([
    expect.objectContaining({ kind: 'restore', outcome: 'restored' }),
    { kind: 'resolved', resolvedBy: 'restore' },
  ]);
});

it('hands the UI back to the step after a failed restore until the check changes', async () => {
  const hook = render();
  await settle();
  await drift(hook);
  restore.mockResolvedValue({ ...DRIFT, canRestore: false, gaveUp: true, failure: 'repair_failed' });
  await act(async () => {
    await hook.result.current.restore();
  });
  expect(hook.result.current.paused).toBe(false);
  expect(hook.events()).toContainEqual(
    expect.objectContaining({ kind: 'restore', outcome: 'failed', failure: 'repair_failed' })
  );
  expect(hook.events().at(-1)).toEqual({ kind: 'resolved', resolvedBy: 'unrestorable' });
  await drift(hook);
  expect(hook.result.current.paused).toBe(false);
  inspect.mockResolvedValue(PASS);
  await act(async () => {
    await hook.result.current.recheck();
  });
  await drift(hook);
  expect(hook.result.current.paused).toBe(true);
});

it('reports how a pause ended without a restore', async () => {
  const hook = render();
  await settle();
  await drift(hook);
  inspect.mockResolvedValue(PASS);
  await act(async () => {
    await hook.result.current.recheck();
  });
  expect(hook.events().at(-1)).toEqual({ kind: 'resolved', resolvedBy: 'self' });

  await drift(hook);
  hook.rerender({ key: 'step-2' });
  await settle();
  expect(hook.result.current.paused).toBe(false);
  expect(hook.events()).toContainEqual({ kind: 'resolved', resolvedBy: 'step_completed' });
});

it('reports a pause the learner closed the guide on', async () => {
  const hook = render();
  await settle();
  await drift(hook);
  hook.unmount();
  expect(hook.events().at(-1)).toEqual({ kind: 'resolved', resolvedBy: 'unmount' });
});

it('rechecks on in-app navigation and once more after the page settles', async () => {
  render();
  await settle();
  expect(inspect).toHaveBeenCalledTimes(1);
  await act(async () => {
    locationService.push('/dashboards');
  });
  expect(inspect).toHaveBeenCalledTimes(2);
  await settle(750);
  expect(inspect).toHaveBeenCalledTimes(3);
});

it('skips rechecks while a step runs and checks once when it finishes', async () => {
  const hook = render({ suspended: true });
  await settle();
  expect(inspect).not.toHaveBeenCalled();
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
  });
  expect(inspect).not.toHaveBeenCalled();
  hook.rerender({ suspended: false });
  await settle();
  expect(inspect).toHaveBeenCalledTimes(1);
});

it('keeps an in-flight restore when the section requirements flicker', async () => {
  let finish!: (result: RecoveryResult) => void;
  restore.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
  const hook = render();
  await settle();
  await drift(hook);
  let restoring!: Promise<boolean>;
  act(() => {
    restoring = hook.result.current.restore();
  });
  hook.rerender({ enabled: false });
  hook.rerender({ enabled: true });
  await act(async () => {
    finish(PASS);
    await restoring;
  });
  expect(await restoring).toBe(true);
  expect(hook.result.current.paused).toBe(false);
});

it('stays inactive in the controller tab', async () => {
  render({ controllerMode: true });
  await settle(6000);
  expect(inspect).not.toHaveBeenCalled();
});

it('gives the adapter the URL the plan last passed on', async () => {
  locationService.push('/explore?panes=abc');
  render();
  await settle();
  const lastReadyUrl = jest.mocked(createRecoveryAdapter).mock.calls.at(-1)![3];
  expect(lastReadyUrl()).toBe('/explore?panes=abc');
});
