import { act, renderHook } from '@testing-library/react';
import type { ContextData, Recommendation } from '../types/context.types';

const mockGetContextData = jest.fn();
const mockFetchRecommendations = jest.fn();
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
    getLocation: () => ({ pathname: '/explore' }),
    getHistory: () => ({ listen: () => () => {} }),
  },
}));

import { INTERACTIVE_CONFIG } from '../constants/interactive-config';
import { useContextPanel } from './context.hook';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const context = (currentPath: string): Partial<ContextData> => ({
  currentPath,
  tags: [],
  dataSources: [],
  isLoading: false,
  recommendations: [],
  featuredRecommendations: [],
});

const rec = (title: string): Recommendation => ({ title, url: `https://example.com/${title}`, type: 'docs-page' });

const recommendationsResult = (...titles: string[]) => ({
  recommendations: titles.map(rec),
  featuredRecommendations: [],
  error: null,
  errorType: null,
  usingFallbackRecommendations: false,
});

const titles = (recommendations: Recommendation[]) => recommendations.map((r) => r.title);

async function renderLoaded() {
  mockGetContextData.mockResolvedValue(context('/explore'));
  mockFetchRecommendations.mockResolvedValue(recommendationsResult('initial'));
  const view = renderHook(() => useContextPanel());
  await act(async () => jest.advanceTimersByTimeAsync(INTERACTIVE_CONFIG.delays.debouncing.contextRefresh));
  expect(titles(view.result.current.contextData.recommendations)).toEqual(['initial']);
  return view;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
});

afterEach(() => {
  jest.useRealTimers();
});

it('ignores a recommendations response that a newer request superseded', async () => {
  const { result, unmount } = await renderLoaded();
  const older = deferred<ReturnType<typeof recommendationsResult>>();
  const newer = deferred<ReturnType<typeof recommendationsResult>>();
  mockFetchRecommendations.mockImplementationOnce(() => older.promise).mockImplementationOnce(() => newer.promise);

  act(() => result.current.refreshRecommendations());
  act(() => result.current.refreshRecommendations());

  await act(async () => older.resolve(recommendationsResult('stale')));
  expect(titles(result.current.contextData.recommendations)).toEqual(['initial']);
  expect(result.current.isLoadingRecommendations).toBe(true);

  await act(async () => newer.resolve(recommendationsResult('fresh')));
  expect(titles(result.current.contextData.recommendations)).toEqual(['fresh']);
  expect(result.current.isLoadingRecommendations).toBe(false);
  expect(result.current.hasFetchedRecommendations).toBe(true);
  unmount();
});

it('ignores a recommendations failure that a newer request superseded', async () => {
  const { result, unmount } = await renderLoaded();
  const older = deferred<ReturnType<typeof recommendationsResult>>();
  mockFetchRecommendations
    .mockImplementationOnce(() => older.promise)
    .mockResolvedValueOnce(recommendationsResult('fresh'));

  act(() => result.current.refreshRecommendations());
  await act(async () => result.current.refreshRecommendations());
  await act(async () => older.reject(new Error('network')));

  expect(titles(result.current.contextData.recommendations)).toEqual(['fresh']);
  expect(result.current.contextData.recommendationsError).toBeNull();
  unmount();
});

it('ignores a context response that a newer request superseded', async () => {
  const { result, unmount } = await renderLoaded();
  const older = deferred<Partial<ContextData>>();
  const newer = deferred<Partial<ContextData>>();
  mockGetContextData.mockImplementationOnce(() => older.promise).mockImplementationOnce(() => newer.promise);

  act(() => result.current.refreshContext());
  act(() => result.current.refreshContext());

  await act(async () => newer.resolve(context('/dashboards')));
  await act(async () => older.resolve(context('/explore')));

  expect(result.current.contextData.currentPath).toBe('/dashboards');
  expect(mockFetchRecommendations).toHaveBeenLastCalledWith(
    expect.objectContaining({ currentPath: '/dashboards' }),
    expect.anything()
  );
  unmount();
});

it('keeps the current recommendations on screen until the next ones arrive', async () => {
  const { result, unmount } = await renderLoaded();
  const nextContext = deferred<Partial<ContextData>>();
  const nextRecommendations = deferred<ReturnType<typeof recommendationsResult>>();
  mockGetContextData.mockImplementationOnce(() => nextContext.promise);
  mockFetchRecommendations.mockImplementationOnce(() => nextRecommendations.promise);

  act(() => result.current.refreshContext());
  expect(result.current.contextData.isLoading).toBe(true);
  expect(titles(result.current.contextData.recommendations)).toEqual(['initial']);

  await act(async () => nextContext.resolve(context('/')));
  expect(result.current.contextData.currentPath).toBe('/');
  expect(titles(result.current.contextData.recommendations)).toEqual(['initial']);

  await act(async () => nextRecommendations.resolve(recommendationsResult('home')));
  expect(titles(result.current.contextData.recommendations)).toEqual(['home']);
  unmount();
});
