import { act, renderHook, waitFor } from '@testing-library/react';

const mockGetContextData = jest.fn();
jest.mock('./context.service', () => ({
  ContextService: {
    getContextData: () => mockGetContextData(),
    fetchRecommendations: jest.fn(async () => ({ recommendations: [], featuredRecommendations: [] })),
  },
}));
jest.mock('../hooks', () => ({ usePathfinderPluginConfig: () => ({ config: {} }) }));
jest.mock('@grafana/runtime', () => ({
  locationService: {
    getLocation: () => ({ pathname: '/explore' }),
    getHistory: () => ({ listen: () => () => {} }),
  },
}));

import { useContextPanel } from './context.hook';
import { setAutoOpenGuideEnrollment } from '../utils/experiments/auto-open-guide/state';

it('refetches context and recommendations when the auto-open guide activation changes', async () => {
  mockGetContextData.mockResolvedValue({
    currentPath: '/explore',
    tags: [],
    isLoading: false,
    recommendations: [],
    featuredRecommendations: [],
  });
  renderHook(() => useContextPanel());
  await waitFor(() => expect(mockGetContextData).toHaveBeenCalledTimes(1));

  act(() => setAutoOpenGuideEnrollment({ variant: 'treatment', experiences: [] }));

  await waitFor(() => expect(mockGetContextData).toHaveBeenCalledTimes(2));
  setAutoOpenGuideEnrollment(null);
});
