import { act, renderHook } from '@testing-library/react';

const mockGetContextData = jest.fn();
const mockFetchRecommendations = jest.fn();
let mockLocation = { pathname: '/explore', search: '' };
let mockLocationChanged: () => void = () => {};
jest.mock('./context.service', () => ({
  ContextService: {
    getContextData: () => mockGetContextData(),
    fetchRecommendations: (...args: unknown[]) => mockFetchRecommendations(...args),
  },
}));
jest.mock('../hooks', () => {
  const config = {};
  return { usePathfinderPluginConfig: () => ({ config }) };
});
jest.mock('@grafana/runtime', () => ({
  locationService: {
    getLocation: () => mockLocation,
    getHistory: () => ({
      listen: (callback: () => void) => {
        mockLocationChanged = callback;
        return () => {};
      },
    }),
  },
}));

import { INTERACTIVE_CONFIG } from '../constants/interactive-config';
import { useContextPanel } from './context.hook';
import { setAutoOpenGuideEnrollment } from '../utils/experiments/auto-open-guide/state';

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockLocation = { pathname: '/explore', search: '' };
  mockGetContextData.mockReset();
  mockFetchRecommendations.mockReset().mockResolvedValue({ recommendations: [], featuredRecommendations: [] });
  setAutoOpenGuideEnrollment(null);
});

afterEach(() => {
  setAutoOpenGuideEnrollment(null);
  jest.useRealTimers();
});

it('refetches context and recommendations when the auto-open guide activation changes', async () => {
  mockGetContextData.mockResolvedValue({
    currentPath: '/explore',
    tags: [],
    isLoading: false,
    recommendations: [],
    featuredRecommendations: [],
  });
  const { unmount } = renderHook(() => useContextPanel());
  const delay = INTERACTIVE_CONFIG.delays.debouncing.contextRefresh;
  await act(async () => jest.advanceTimersByTimeAsync(delay));
  expect(mockGetContextData).toHaveBeenCalledTimes(1);

  act(() => setAutoOpenGuideEnrollment({ variant: 'treatment', experiences: [] }));

  await act(async () => jest.advanceTimersByTimeAsync(delay - 1));
  expect(mockGetContextData).toHaveBeenCalledTimes(1);
  await act(async () => jest.advanceTimersByTimeAsync(1));
  expect(mockGetContextData).toHaveBeenCalledTimes(2);
  unmount();
});

const context = (path = '/explore') => ({
  currentPath: path,
  tags: [],
  isLoading: false,
  recommendations: [],
  featuredRecommendations: [],
});
const refreshDelay = INTERACTIVE_CONFIG.delays.debouncing.contextRefresh + 100;

it('refreshes for edit mode changes but ignores unrelated query parameters', async () => {
  mockGetContextData.mockImplementation(async () => context(mockLocation.pathname));
  const { unmount } = renderHook(() => useContextPanel());
  await act(async () => jest.advanceTimersByTimeAsync(refreshDelay));
  mockLocation.search = '?from=now-1h';
  act(() => mockLocationChanged());
  await act(async () => jest.advanceTimersByTimeAsync(refreshDelay));
  expect(mockGetContextData).toHaveBeenCalledTimes(1);
  mockLocation.search = '?editPanel=1';
  act(() => mockLocationChanged());
  await act(async () => jest.advanceTimersByTimeAsync(refreshDelay));
  expect(mockGetContextData).toHaveBeenCalledTimes(2);
  unmount();
});

it('ignores recommendations from the previous page even when they finish last', async () => {
  let finishOld!: (value: unknown) => void;
  mockGetContextData.mockImplementation(async () => context(mockLocation.pathname));
  mockFetchRecommendations.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishOld = resolve;
      })
  );
  mockFetchRecommendations.mockResolvedValue({
    recommendations: [{ title: 'New page', url: 'new' }],
    featuredRecommendations: [],
  });
  const { result, unmount } = renderHook(() => useContextPanel());
  await act(async () => jest.advanceTimersByTimeAsync(refreshDelay));
  mockLocation.pathname = '/dashboards';
  act(() => mockLocationChanged());
  await act(async () => jest.advanceTimersByTimeAsync(refreshDelay));
  await act(async () =>
    finishOld({ recommendations: [{ title: 'Old page', url: 'old' }], featuredRecommendations: [] })
  );
  expect(result.current.contextData.currentPath).toBe('/dashboards');
  expect(result.current.contextData.recommendations[0]?.title).toBe('New page');
  expect(result.current.isLoadingRecommendations).toBe(false);
  unmount();
});

it('ignores context from an earlier navigation', async () => {
  let finishOld!: (value: unknown) => void;
  mockGetContextData.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishOld = resolve;
      })
  );
  mockGetContextData.mockImplementation(async () => context(mockLocation.pathname));
  const { result, unmount } = renderHook(() => useContextPanel());
  await act(async () => jest.advanceTimersByTimeAsync(refreshDelay));
  mockLocation.pathname = '/dashboards';
  act(() => mockLocationChanged());
  await act(async () => jest.advanceTimersByTimeAsync(refreshDelay));
  await act(async () => finishOld(context('/explore')));
  expect(result.current.contextData.currentPath).toBe('/dashboards');
  unmount();
});

it('settles recommendations when a refresh supersedes a pending fetch with identical context', async () => {
  let finishOld!: (value: unknown) => void;
  mockGetContextData.mockImplementation(async () => context());
  mockFetchRecommendations.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishOld = resolve;
      })
  );
  const { result, unmount } = renderHook(() => useContextPanel());
  await act(async () => jest.advanceTimersByTimeAsync(refreshDelay));
  expect(mockFetchRecommendations).toHaveBeenCalledTimes(1);
  act(() => setAutoOpenGuideEnrollment({ variant: 'treatment', experiences: [] }));
  await act(async () => jest.advanceTimersByTimeAsync(refreshDelay));
  await act(async () => finishOld({ recommendations: [], featuredRecommendations: [] }));
  expect(mockFetchRecommendations).toHaveBeenCalledTimes(2);
  expect(result.current.isLoadingRecommendations).toBe(false);
  expect(result.current.hasFetchedRecommendations).toBe(true);
  unmount();
});
