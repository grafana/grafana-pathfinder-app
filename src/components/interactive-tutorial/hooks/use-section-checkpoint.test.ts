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
