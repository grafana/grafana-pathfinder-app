import { act, renderHook } from '@testing-library/react';
import { useSectionRecovery } from './use-section-recovery';
import { createRecoveryAdapter } from '../../../requirements-manager';
import { inspectRecovery, restoreRecovery, type RecoveryResult } from '../../../recovery/section-recovery';
import type { SectionRecoveryPlan } from '../../../recovery/section-recovery-plan';

const mockCheckPostconditions = jest.fn();
jest.mock('../../../requirements-manager', () => ({
  createRecoveryAdapter: jest.fn(() => ({})),
  useGuideRequirements: () => ({ checkPostconditions: mockCheckPostconditions }),
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

it('waits for a new page to settle before checking it', async () => {
  render();
  await settle();
  expect(inspect).toHaveBeenCalledTimes(1);
  await act(async () => {
    locationService.push('/dashboards');
    window.dispatchEvent(new Event('focus'));
  });
  await settle(500);
  expect(inspect).toHaveBeenCalledTimes(1);
  await settle(250);
  expect(inspect).toHaveBeenCalledTimes(2);
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

it('never confirms a pause once a step starts running', async () => {
  const hook = render();
  await settle();
  inspect.mockResolvedValue(DRIFT);
  await act(async () => {
    await hook.result.current.recheck();
  });
  hook.rerender({ suspended: true });
  await settle(750);
  expect(hook.result.current.paused).toBe(false);
});

it('does not pause from a check that finishes after a step starts running', async () => {
  const hook = render();
  await settle();
  inspect.mockResolvedValue(DRIFT);
  await act(async () => {
    await hook.result.current.recheck();
  });
  let finish!: (result: RecoveryResult) => void;
  inspect.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
  await settle(700);
  act(() => {
    void hook.result.current.recheck();
  });
  hook.rerender({ suspended: true });
  await act(async () => {
    finish(DRIFT);
  });
  await settle(750);
  expect(hook.result.current.paused).toBe(false);
  expect(hook.onEvent).not.toHaveBeenCalled();
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

it('does not remember a page the learner reached while the check was running', async () => {
  locationService.push('/explore?panes=abc');
  render();
  await settle();
  let finish!: (result: RecoveryResult) => void;
  inspect.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
  act(() => {
    window.dispatchEvent(new Event('focus'));
  });
  await act(async () => {
    locationService.push('/dashboards');
    finish(PASS);
  });
  const lastReadyUrl = jest.mocked(createRecoveryAdapter).mock.calls.at(-1)![3];
  expect(lastReadyUrl()).toBe('/explore?panes=abc');
});

it('keeps the page a step was ready on when Grafana fills in its query mid-check', async () => {
  locationService.push('/explore?panes=abc');
  render();
  await settle();
  let finish!: (result: RecoveryResult) => void;
  inspect.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
  act(() => {
    window.dispatchEvent(new Event('focus'));
  });
  await act(async () => {
    locationService.replace('/explore?panes=abc&orgId=1');
    finish(PASS);
  });
  const lastReadyUrl = jest.mocked(createRecoveryAdapter).mock.calls.at(-1)![3];
  expect(lastReadyUrl()).toBe('/explore?panes=abc&orgId=1');
});

describe('readiness answers for Do Section', () => {
  it('checks the new page once it settles instead of answering from the old one', async () => {
    const hook = render();
    await settle();
    inspect.mockResolvedValue(DRIFT);
    await act(async () => {
      locationService.push('/dashboards');
    });
    let ready!: Promise<boolean>;
    act(() => {
      ready = hook.result.current.recheck();
    });
    expect(inspect).toHaveBeenCalledTimes(1);
    await settle(750);
    expect(inspect).toHaveBeenCalledTimes(2);
    expect(await ready).toBe(false);
  });

  it('checks a query-only URL change right away', async () => {
    locationService.push('/explore?panes=abc');
    const hook = render();
    await settle();
    await act(async () => {
      locationService.replace('/explore?panes=abc&orgId=1');
    });
    await act(async () => {
      await hook.result.current.recheck();
    });
    expect(inspect).toHaveBeenCalledTimes(2);
  });

  it('drops a check waiting for the page to settle when the section unmounts', async () => {
    const hook = render();
    await settle();
    await act(async () => {
      locationService.push('/dashboards');
    });
    act(() => {
      void hook.result.current.recheck();
    });
    hook.unmount();
    await settle(750);
    expect(inspect).toHaveBeenCalledTimes(1);
  });

  it('does not remember a page reached while a step started during the settle wait', async () => {
    locationService.push('/explore?panes=abc');
    const hook = render();
    await settle();
    await act(async () => {
      locationService.push('/dashboards');
      window.dispatchEvent(new Event('focus'));
    });
    hook.rerender({ suspended: true });
    await settle(750);
    expect(inspect).toHaveBeenCalledTimes(1);
    const lastReadyUrl = jest.mocked(createRecoveryAdapter).mock.calls.at(-1)![3];
    expect(lastReadyUrl()).toBe('/explore?panes=abc');
  });

  it('remembers the page Do Section confirmed before its run starts', async () => {
    locationService.push('/explore?panes=abc');
    const hook = render();
    await settle();
    locationService.replace('/explore?panes=edited');
    hook.rerender({ suspended: true });
    await act(async () => {
      await hook.result.current.recheck();
    });
    const lastReadyUrl = jest.mocked(createRecoveryAdapter).mock.calls.at(-1)![3];
    expect(lastReadyUrl()).toBe('/explore?panes=edited');
  });

  it('does not restart an in-flight check when the event handler changes', async () => {
    const first = jest.fn();
    const hook = renderHook(({ onEvent }) => useSectionRecovery(plan(), 'section', true, false, { onEvent }), {
      initialProps: { onEvent: first },
    });
    await settle();
    let finish!: (result: RecoveryResult) => void;
    inspect.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    let ready!: Promise<boolean>;
    act(() => {
      ready = hook.result.current.recheck();
    });
    hook.rerender({ onEvent: jest.fn() });
    await act(async () => {
      finish(DRIFT);
    });
    expect(await ready).toBe(false);
  });

  it('answers an aborted check with the check that replaced it, never a blind yes', async () => {
    const hook = render();
    await settle();
    let finish!: (result: RecoveryResult) => void;
    inspect.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    restore.mockResolvedValue(DRIFT);
    let ready!: Promise<boolean>;
    act(() => {
      ready = hook.result.current.recheck();
    });
    await act(async () => {
      await hook.result.current.restore();
      finish(PASS);
    });
    expect(await ready).toBe(false);
  });
});
