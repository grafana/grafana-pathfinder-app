import { act, renderHook, waitFor } from '@testing-library/react';
import { useOutcomeCheck } from './use-outcome-check';
import { listOutcomeResources, verifyGrafanaOutcome } from '../../requirements-manager';
import type { GuideOutcome, OutcomeScope } from '../../types/outcome.types';
import type { CheckResultError } from '../../types/requirements.types';
import type { OutcomeEvidenceStore } from '../../lib/outcomes/outcome-evidence';

jest.mock('../../requirements-manager', () => ({
  listOutcomeResources: jest.fn(),
  verifyGrafanaOutcome: jest.fn(),
}));
const scope: OutcomeScope = { userId: 'u', orgId: 'o', guideId: 'g', guideRevision: 'r' };
const outcome: GuideOutcome = { id: 'dashboard', label: 'Saved dashboard', kind: 'dashboard-saved' };
const store: OutcomeEvidenceStore = { read: jest.fn(), record: jest.fn() };
const satisfied: CheckResultError = { requirement: 'dashboard-saved:uid', pass: true, verdict: 'satisfied' };
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(listOutcomeResources).mockResolvedValue([{ uid: 'uid', label: 'Dashboard' }]);
  jest.mocked(store.read).mockResolvedValue([]);
  jest.mocked(store.record).mockResolvedValue(null);
});

it('records verified outcomes independently of any progress callback', async () => {
  jest.mocked(verifyGrafanaOutcome).mockResolvedValue(satisfied);
  const { result } = renderHook(() => useOutcomeCheck(scope, outcome, store));
  await waitFor(() => expect(store.read).toHaveBeenCalled());
  act(() => result.current.selectResource('uid', 'Walking, adventure'));
  await act(() => result.current.check());
  expect(store.record).toHaveBeenCalledWith(scope, outcome.id, 'uid', [satisfied]);
  expect(result.current.result?.verdict).toBe('satisfied');
  expect(result.current.resource).toEqual({ value: 'uid', label: 'Walking, adventure' });
});

it.each(['cancel', 'selection', 'unmount'] as const)('rejects late verification after %s', async (change) => {
  let resolve: (result: CheckResultError) => void = () => {};
  jest.mocked(verifyGrafanaOutcome).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const { result, unmount } = renderHook(() => useOutcomeCheck(scope, outcome, store));
  await waitFor(() => expect(store.read).toHaveBeenCalled());
  act(() => result.current.selectResource('uid'));
  let pending: Promise<void>;
  act(() => {
    pending = result.current.check();
  });
  act(() => {
    if (change === 'cancel') {
      result.current.cancel();
    } else if (change === 'selection') {
      result.current.selectResource('other');
    } else {
      unmount();
    }
  });
  await act(async () => {
    resolve(satisfied);
    await pending;
  });
  expect(store.record).not.toHaveBeenCalled();
});

it('allows retry after an unavailable check without writing evidence', async () => {
  jest
    .mocked(verifyGrafanaOutcome)
    .mockResolvedValueOnce({ ...satisfied, pass: false, verdict: 'unavailable' })
    .mockResolvedValueOnce(satisfied);
  const { result } = renderHook(() => useOutcomeCheck(scope, outcome, store));
  await waitFor(() => expect(store.read).toHaveBeenCalled());
  act(() => result.current.selectResource('uid'));
  await act(() => result.current.check());
  expect(store.record).not.toHaveBeenCalled();
  expect(result.current.result?.verdict).toBe('unavailable');
  await act(() => result.current.check());
  expect(store.record).toHaveBeenCalledTimes(1);
});
