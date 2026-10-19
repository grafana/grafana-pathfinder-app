import { act, renderHook } from '@testing-library/react';

const mockGetContextData = jest.fn();
jest.mock('./context.service', () => ({
  ContextService: {
    getContextData: () => mockGetContextData(),
    fetchRecommendations: jest.fn(async () => ({ recommendations: [], featuredRecommendations: [] })),
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
import { setAutoOpenGuideEnrollment } from '../utils/experiments/auto-open-guide/state';

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
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
