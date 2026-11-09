import { act, renderHook, waitFor } from '@testing-library/react';
import { getBackendSrv } from '@grafana/runtime';
import { useLearningInsights } from './useLearningInsights';

jest.mock('@grafana/runtime', () => ({ getBackendSrv: jest.fn(), config: {} }));

const empty = {
  asOf: '2026-08-01T00:00:00Z',
  from: '2026-07-04T00:00:00Z',
  to: '2026-08-01T00:00:00Z',
  capability: { available: true },
  completeness: 'complete',
  warnings: [],
  people: [],
  completions: [],
  assignments: [],
};
const get = jest.fn();

beforeEach(() => {
  get.mockReset();
  (getBackendSrv as jest.Mock).mockReturnValue({ get });
});

test('reads the guarded plugin route and validates its envelope', async () => {
  get.mockResolvedValue(empty);
  const { result } = renderHook(() => useLearningInsights(empty.from, empty.to));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.data).toEqual(empty);
  expect(get.mock.calls[0][0]).toContain('/resources/learning-insights?from=2026-07-04T00%3A00%3A00Z');
});

test('reports denial without exposing response text', async () => {
  get.mockRejectedValue({ status: 403, message: 'private data' });
  const { result } = renderHook(() => useLearningInsights());
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.error).toContain('administrators');
  expect(result.current.error).not.toContain('private data');
  expect(result.current.data).toBeNull();
});

test('rejects malformed responses rather than inventing empty records', async () => {
  get.mockResolvedValue({ people: [] });
  const { result } = renderHook(() => useLearningInsights());
  await waitFor(() => expect(result.current.error).not.toBeNull());
  expect(result.current.data).toBeNull();
});

test('ignores late responses after a period change', async () => {
  let finish: (value: unknown) => void = () => undefined;
  get
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    )
    .mockResolvedValue(empty);
  const { result, rerender } = renderHook(({ from }) => useLearningInsights(from), { initialProps: { from: 'old' } });
  rerender({ from: 'new' });
  await waitFor(() => expect(result.current.data).toEqual(empty));
  await act(async () => {
    finish({ ...empty, asOf: 'obsolete' });
  });
  expect(result.current.data?.asOf).toBe(empty.asOf);
});

test('refresh does not retain private data when the new request is denied', async () => {
  get.mockResolvedValueOnce(empty).mockRejectedValueOnce({ status: 403 });
  const { result } = renderHook(() => useLearningInsights());
  await waitFor(() => expect(result.current.data).toEqual(empty));
  act(() => result.current.refresh());
  await waitFor(() => expect(result.current.error).toContain('administrators'));
  expect(result.current.data).toBeNull();
});
