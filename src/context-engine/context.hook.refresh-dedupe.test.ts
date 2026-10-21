import { act, renderHook } from '@testing-library/react';
import type { ContextData } from '../types/context.types';

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
    getLocation: () => ({ pathname: '/d/abc' }),
    getHistory: () => ({ listen: () => () => {} }),
  },
}));

const contextListeners = new Set<() => void>();
let detectedDatasource: string | null = null;
jest.mock('./context-event-bus', () => ({
  onContextChange: (listener: () => void) => {
    contextListeners.add(listener);
    return () => contextListeners.delete(listener);
  },
  getDetectedDatasourceType: () => detectedDatasource,
  getDetectedVisualizationType: () => null,
}));

import { INTERACTIVE_CONFIG } from '../constants/interactive-config';
import { StorageEvents } from '../lib/event-names';
import { useContextPanel } from './context.hook';

const settle = () =>
  act(async () => jest.advanceTimersByTimeAsync(INTERACTIVE_CONFIG.delays.debouncing.contextRefresh));

const emitContextEvent = (datasource: string | null) => {
  detectedDatasource = datasource;
  act(() => contextListeners.forEach((listener) => listener()));
};

const context = (tags: string[] = []): Partial<ContextData> => ({
  currentPath: '/d/abc',
  tags,
  dataSources: [],
  isLoading: false,
  recommendations: [],
  featuredRecommendations: [],
});

const recommendationsResult = (error: string | null = null) => ({
  recommendations: [{ title: 'Build a dashboard', url: 'https://example.com/build', type: 'docs-page' }],
  featuredRecommendations: [],
  error,
  errorType: error ? 'unavailable' : null,
  usingFallbackRecommendations: Boolean(error),
});

async function renderSettled() {
  const view = renderHook(() => useContextPanel());
  await settle();
  expect(mockGetContextData).toHaveBeenCalledTimes(1);
  expect(mockFetchRecommendations).toHaveBeenCalledTimes(1);
  return view;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  contextListeners.clear();
  detectedDatasource = null;
  mockGetContextData.mockResolvedValue(context());
  mockFetchRecommendations.mockResolvedValue(recommendationsResult());
});

afterEach(() => {
  jest.useRealTimers();
});

it('does not refresh when repeated query events report the datasource it already knows', async () => {
  const { unmount } = await renderSettled();

  emitContextEvent('prometheus');
  await settle();
  expect(mockGetContextData).toHaveBeenCalledTimes(2);

  emitContextEvent('prometheus');
  emitContextEvent('prometheus');
  await settle();
  expect(mockGetContextData).toHaveBeenCalledTimes(2);
  unmount();
});

it('skips the recommendations fetch when the refreshed context matches the last one', async () => {
  const { result, unmount } = await renderSettled();
  const shown = result.current.contextData.recommendations;

  emitContextEvent('prometheus');
  await settle();

  expect(mockGetContextData).toHaveBeenCalledTimes(2);
  expect(mockFetchRecommendations).toHaveBeenCalledTimes(1);
  expect(result.current.contextData.recommendations).toBe(shown);
  expect(result.current.hasFetchedRecommendations).toBe(true);
  unmount();
});

it('fetches recommendations when the refreshed context changes', async () => {
  const { unmount } = await renderSettled();
  mockGetContextData.mockResolvedValue(context(['selected-datasource:prometheus']));

  emitContextEvent('prometheus');
  await settle();

  expect(mockFetchRecommendations).toHaveBeenCalledTimes(2);
  unmount();
});

it('refetches recommendations after progress is cleared even when the context is unchanged', async () => {
  const { unmount } = await renderSettled();

  act(() => {
    window.dispatchEvent(new Event(StorageEvents.InteractiveProgressCleared));
  });
  await settle();

  expect(mockFetchRecommendations).toHaveBeenCalledTimes(2);
  unmount();
});

it('retries recommendations on the next refresh after an error, even when the context is unchanged', async () => {
  mockFetchRecommendations.mockResolvedValueOnce(recommendationsResult('Recommender unreachable'));
  const { unmount } = await renderSettled();

  emitContextEvent('prometheus');
  await settle();

  expect(mockFetchRecommendations).toHaveBeenCalledTimes(2);
  unmount();
});
