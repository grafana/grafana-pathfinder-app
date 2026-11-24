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
let mockPluginConfig: object = {};
jest.mock('../hooks', () => ({
  usePathfinderPluginConfig: () => ({ config: mockPluginConfig }),
}));
jest.mock('@grafana/runtime', () => ({
  locationService: {
    getLocation: () => window.location,
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
import { suggestionState } from '../global-state/suggestion';
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
  mockPluginConfig = {};
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

it('removes a named suggestion group on navigation and restores it on return', async () => {
  const originalUrl = window.location.href;
  const pathname = '/a/grafana-slo-app';
  const suggestions = [
    { title: 'Create an SLO', url: 'bundled:create-slo' },
    { title: 'Monitor an SLO', url: 'bundled:monitor-slo' },
  ];
  const group = suggestions.map((guide) => expect.objectContaining({ ...guide, groupTitle: 'What’s new' }));
  const navigate = async (path: string) => {
    window.history.replaceState(null, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
    await act(async () => jest.runAllTimersAsync());
  };

  window.history.replaceState(null, '', pathname);
  mockGetContextData.mockImplementation(async () => ({ ...context(), currentPath: window.location.pathname }));
  const { result, unmount } = await renderSettled();
  try {
    act(() => suggestionState.setSuggestions(suggestions, { groupTitle: 'What’s new', pathname }));
    expect(result.current.contextData.featuredRecommendations).toEqual(group);

    await navigate('/dashboards');
    expect(result.current.contextData.currentPath).toBe('/dashboards');
    expect(result.current.contextData.featuredRecommendations).toEqual([]);

    await navigate(pathname);
    expect(result.current.contextData.currentPath).toBe(pathname);
    expect(result.current.contextData.featuredRecommendations).toEqual(group);
  } finally {
    unmount();
    suggestionState.clearSuggestions();
    window.history.replaceState(null, '', originalUrl);
  }
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

it('refetches recommendations with the new plugin config when it resolves after the first fetch', async () => {
  const { rerender, unmount } = await renderSettled();
  const resolvedConfig = { acceptedTermsAndConditions: true };
  mockPluginConfig = resolvedConfig;

  await act(async () => rerender());

  expect(mockGetContextData).toHaveBeenCalledTimes(1);
  expect(mockFetchRecommendations).toHaveBeenCalledTimes(2);
  expect(mockFetchRecommendations).toHaveBeenLastCalledWith(expect.anything(), resolvedConfig);
  unmount();
});

it('does not refetch when built-in datasource queries leave the detected datasource unchanged', async () => {
  const { unmount } = await renderSettled();

  emitContextEvent(null);
  await settle();

  expect(mockGetContextData).toHaveBeenCalledTimes(1);
  expect(mockFetchRecommendations).toHaveBeenCalledTimes(1);
  unmount();
});
