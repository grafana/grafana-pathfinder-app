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
