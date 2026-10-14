import { act, renderHook, waitFor } from '@testing-library/react';
import { useSectionCheckpoint } from './use-section-checkpoint';
import { createCheckpointAdapter } from '../../../requirements-manager';

jest.mock('../../../requirements-manager', () => ({
  createCheckpointAdapter: jest.fn(),
  useGuideRequirements: () => ({ checkPostconditions: mockCheck }),
}));
const mockCheck = jest.fn();
const checkpoint = { checks: [{ requirement: 'on-page:/dashboards' }] };

beforeEach(() => jest.clearAllMocks());

it('gates actions, restores, and detects later drift without writing completion', async () => {
  let ready = false;
  const adapter = {
    check: jest.fn(async () => ({ passed: ready, canRestore: !ready })),
    restore: jest.fn(async () => {
      ready = true;
      return true;
    }),
  };
  jest.mocked(createCheckpointAdapter).mockReturnValue(adapter);
  const { result } = renderHook(() => useSectionCheckpoint(checkpoint, 'section', true, false));
  expect(result.current.passed).toBe(false);
  await waitFor(() => expect(result.current.status.canRestore).toBe(true));
  await act(async () => {
    await result.current.restore();
  });
  expect(result.current.passed).toBe(true);
  ready = false;
  await act(async () => {
    await result.current.recheck();
  });
  expect(result.current.passed).toBe(false);
  expect(adapter.restore).toHaveBeenCalledTimes(1);
});

it('aborts recovery on unmount before a delayed condition can trigger a repair', async () => {
  let resolve!: (value: { passed: boolean; canRestore: boolean }) => void;
  const adapter = {
    check: jest
      .fn()
      .mockResolvedValueOnce({ passed: false, canRestore: true })
      .mockImplementation(
        () =>
          new Promise((r) => {
            resolve = r;
          })
      ),
    restore: jest.fn(),
  };
  jest.mocked(createCheckpointAdapter).mockReturnValue(adapter);
  const { result, unmount } = renderHook(() => useSectionCheckpoint(checkpoint, 'section', true, false));
  await waitFor(() => expect(result.current.status.canRestore).toBe(true));
  let recovery!: Promise<boolean>;
  act(() => {
    recovery = result.current.restore();
  });
  unmount();
  resolve({ passed: false, canRestore: true });
  await recovery;
  expect(adapter.restore).not.toHaveBeenCalled();
});

it('restores when Restore is clicked while a background check is still running', async () => {
  let ready = false;
  let releaseInspection!: () => void;
  const adapter = {
    check: jest
      .fn()
      .mockResolvedValueOnce({ passed: false, canRestore: true })
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            releaseInspection = () => r({ passed: false, canRestore: true });
          })
      )
      .mockImplementation(async () => ({ passed: ready, canRestore: !ready })),
    restore: jest.fn(async () => {
      ready = true;
      return true;
    }),
  };
  jest.mocked(createCheckpointAdapter).mockReturnValue(adapter);
  const { result } = renderHook(() => useSectionCheckpoint(checkpoint, 'section', true, false));
  await waitFor(() => expect(result.current.status.canRestore).toBe(true));
  let inspection!: Promise<boolean>;
  act(() => {
    inspection = result.current.recheck();
  });
  await act(async () => {
    await result.current.restore();
  });
  releaseInspection();
  await act(async () => {
    await inspection;
  });
  expect(adapter.restore).toHaveBeenCalledTimes(1);
  expect(result.current.passed).toBe(true);
});

it('blocks controller mode instead of inspecting the wrong tab', async () => {
  const { result } = renderHook(() => useSectionCheckpoint(checkpoint, 'section', true, true));
  await waitFor(() => expect(result.current.status.explanation).toContain('Grafana tab'));
  expect(result.current.passed).toBe(false);
  expect(createCheckpointAdapter).not.toHaveBeenCalled();
});

it('does not change existing guides without checkpoints', () => {
  const { result } = renderHook(() => useSectionCheckpoint(undefined, 'section', true, false));
  expect(result.current.passed).toBe(true);
  expect(createCheckpointAdapter).not.toHaveBeenCalled();
});

it('recomputes readiness on remount without persisting recovery records', async () => {
  const storageWrite = jest.spyOn(Storage.prototype, 'setItem');
  let ready = false;
  const adapter = {
    check: jest.fn(async () => ({ passed: ready, canRestore: !ready })),
    restore: jest.fn(async () => {
      ready = true;
      return true;
    }),
  };
  jest.mocked(createCheckpointAdapter).mockReturnValue(adapter);
  try {
    const first = renderHook(() => useSectionCheckpoint(checkpoint, 'section', true, false));
    await waitFor(() => expect(first.result.current.status.canRestore).toBe(true));
    await act(async () => {
      await first.result.current.restore();
    });
    expect(first.result.current.passed).toBe(true);
    first.unmount();
    ready = false;
    const second = renderHook(() => useSectionCheckpoint(checkpoint, 'section', true, false));
    await waitFor(() => expect(second.result.current.status.canRestore).toBe(true));
    expect(second.result.current.passed).toBe(false);
    expect(storageWrite).not.toHaveBeenCalled();
    second.unmount();
  } finally {
    storageWrite.mockRestore();
  }
});

it('releases polling and listeners when the guide closes', async () => {
  jest.useFakeTimers();
  const intervals = jest.spyOn(global, 'setInterval');
  const clear = jest.spyOn(global, 'clearInterval');
  const adapter = { check: jest.fn(async () => ({ passed: true, canRestore: false })), restore: jest.fn() };
  jest.mocked(createCheckpointAdapter).mockReturnValue(adapter);
  try {
    const { unmount } = renderHook(() => useSectionCheckpoint(checkpoint, 'section', true, false));
    await act(async () => {});
    expect(adapter.check).toHaveBeenCalledTimes(1);
    unmount();
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new PopStateEvent('popstate'));
      jest.advanceTimersByTime(15000);
    });
    expect(adapter.check).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledWith(intervals.mock.results[0]!.value);
  } finally {
    intervals.mockRestore();
    clear.mockRestore();
    jest.useRealTimers();
  }
});

describe('navigation, resume URL and analytics events', () => {
  const { locationService } = jest.requireActual('@grafana/runtime');

  it('rechecks on in-app navigation and again once the page settles', async () => {
    jest.useFakeTimers();
    const adapter = { check: jest.fn(async () => ({ passed: true, canRestore: false })), restore: jest.fn() };
    jest.mocked(createCheckpointAdapter).mockReturnValue(adapter);
    try {
      const { unmount } = renderHook(() => useSectionCheckpoint(checkpoint, 'section', true, false));
      await act(async () => {});
      expect(adapter.check).toHaveBeenCalledTimes(1);
      await act(async () => {
        locationService.push('/dashboards');
      });
      expect(adapter.check).toHaveBeenCalledTimes(2);
      await act(async () => {
        jest.advanceTimersByTime(750);
      });
      expect(adapter.check).toHaveBeenCalledTimes(3);
      unmount();
    } finally {
      jest.useRealTimers();
    }
  });

  it('remembers the URL the checkpoint last passed on for location recovery', async () => {
    locationService.push('/explore?schemaVersion=1&panes=abc');
    const adapter = { check: jest.fn(async () => ({ passed: true, canRestore: false })), restore: jest.fn() };
    jest.mocked(createCheckpointAdapter).mockReturnValue(adapter);
    const { result } = renderHook(() => useSectionCheckpoint(checkpoint, 'section', true, false));
    await waitFor(() => expect(result.current.passed).toBe(true));
    const options = jest.mocked(createCheckpointAdapter).mock.calls.at(-1)![3]!;
    expect(options.lastReadyUrl?.()).toBe('/explore?schemaVersion=1&panes=abc');
  });

  it('reports each pause once and the outcome of a restore', async () => {
    let ready = false;
    const adapter = {
      check: jest.fn(async () => ({ passed: ready, canRestore: !ready, checkIndex: ready ? undefined : 0 })),
      restore: jest.fn(async () => {
        ready = true;
        return true;
      }),
    };
    jest.mocked(createCheckpointAdapter).mockReturnValue(adapter);
    const onEvent = jest.fn();
    const { result } = renderHook(() => useSectionCheckpoint(checkpoint, 'section', true, false, { onEvent }));
    await waitFor(() => expect(result.current.settled).toBe(true));
    await act(async () => {
      await result.current.recheck();
    });
    expect(onEvent.mock.calls.filter(([event]) => event.kind === 'paused')).toHaveLength(1);
    await act(async () => {
      await result.current.restore();
    });
    expect(onEvent).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'restore', outcome: 'restored' }));
    ready = false;
    await act(async () => {
      await result.current.recheck();
    });
    expect(onEvent.mock.calls.filter(([event]) => event.kind === 'paused')).toHaveLength(2);
  });

  it('reports a cancelled restore', async () => {
    const adapter = {
      check: jest
        .fn()
        .mockResolvedValueOnce({ passed: false, canRestore: true, checkIndex: 0 })
        .mockImplementation(() => new Promise(() => {})),
      restore: jest.fn(),
    };
    jest.mocked(createCheckpointAdapter).mockReturnValue(adapter);
    const onEvent = jest.fn();
    const { result } = renderHook(() => useSectionCheckpoint(checkpoint, 'section', true, false, { onEvent }));
    await waitFor(() => expect(result.current.status.canRestore).toBe(true));
    act(() => {
      void result.current.restore();
    });
    act(() => {
      result.current.cancel();
    });
    expect(onEvent).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'restore', outcome: 'cancelled' }));
  });
});

describe('failure paths', () => {
  const { locationService } = jest.requireActual('@grafana/runtime');

  it('stops offering Restore after a failed repair until the check changes', async () => {
    let ready = false;
    const adapter = {
      check: jest.fn(async () => ({ passed: ready, canRestore: !ready, checkIndex: ready ? undefined : 0 })),
      restore: jest.fn(async () => false),
    };
    jest.mocked(createCheckpointAdapter).mockReturnValue(adapter);
    const { result } = renderHook(() => useSectionCheckpoint(checkpoint, 'section', true, false));
    await waitFor(() => expect(result.current.status.canRestore).toBe(true));
    await act(async () => {
      await result.current.restore();
    });
    expect(result.current.status).toMatchObject({
      canRestore: false,
      explanation: expect.stringContaining('could not be restored'),
    });
    await act(async () => {
      await result.current.recheck();
    });
    expect(result.current.status).toMatchObject({
      canRestore: false,
      explanation: expect.stringContaining('could not be restored'),
    });
    ready = true;
    await act(async () => {
      await result.current.recheck();
    });
    expect(result.current.passed).toBe(true);
    ready = false;
    await act(async () => {
      await result.current.recheck();
    });
    expect(result.current.status.canRestore).toBe(true);
  });

  it('keeps an in-flight restore when the section requirements flicker', async () => {
    let ready = false;
    let finishRepair!: () => void;
    const adapter = {
      check: jest.fn(async () => ({ passed: ready, canRestore: !ready, checkIndex: ready ? undefined : 0 })),
      restore: jest.fn(
        () =>
          new Promise<boolean>((resolve) => {
            finishRepair = () => {
              ready = true;
              resolve(true);
            };
          })
      ),
    };
    jest.mocked(createCheckpointAdapter).mockReturnValue(adapter);
    const { result, rerender } = renderHook(
      ({ enabled }) => useSectionCheckpoint(checkpoint, 'section', enabled, false),
      { initialProps: { enabled: true } }
    );
    await waitFor(() => expect(result.current.status.canRestore).toBe(true));
    let restoring!: Promise<boolean>;
    act(() => {
      restoring = result.current.restore();
    });
    await waitFor(() => expect(adapter.restore).toHaveBeenCalled());
    rerender({ enabled: false });
    rerender({ enabled: true });
    await act(async () => {
      finishRepair();
      await restoring;
    });
    expect(await restoring).toBe(true);
    expect(result.current.passed).toBe(true);
  });

  it('skips rechecks while a step runs and checks once when it finishes', async () => {
    const adapter = { check: jest.fn(async () => ({ passed: true, canRestore: false })), restore: jest.fn() };
    jest.mocked(createCheckpointAdapter).mockReturnValue(adapter);
    const { rerender } = renderHook(
      ({ suspended, enabled }) => useSectionCheckpoint(checkpoint, 'section', enabled, false, { suspended }),
      { initialProps: { suspended: false, enabled: true } }
    );
    await waitFor(() => expect(adapter.check).toHaveBeenCalledTimes(1));
    rerender({ suspended: true, enabled: true });
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      locationService.push('/explore?during=step');
    });
    rerender({ suspended: true, enabled: false });
    rerender({ suspended: true, enabled: true });
    expect(adapter.check).toHaveBeenCalledTimes(1);
    rerender({ suspended: false, enabled: true });
    await waitFor(() => expect(adapter.check).toHaveBeenCalledTimes(2));
  });
});

it('reports each unverifiable check once while the section stays ungated', async () => {
  const adapter = {
    check: jest.fn(async (check) =>
      'requirement' in check
        ? { passed: true, canRestore: false }
        : { passed: true, canRestore: false, unverifiable: 'ambiguous' }
    ),
    restore: jest.fn(),
  };
  jest.mocked(createCheckpointAdapter).mockReturnValue(adapter);
  const onEvent = jest.fn();
  const twoChecks = { checks: [{ requirement: 'on-page:/explore' }, { target: '.row', state: 'expanded' as const }] };
  const { result } = renderHook(() => useSectionCheckpoint(twoChecks, 'section', true, false, { onEvent }));
  await waitFor(() => expect(result.current.passed).toBe(true));
  await act(async () => {
    await result.current.recheck();
  });
  expect(onEvent.mock.calls.filter(([event]) => event.kind === 'unverifiable')).toEqual([
    [{ kind: 'unverifiable', checkIndex: 1, reason: 'ambiguous' }],
  ]);
});
