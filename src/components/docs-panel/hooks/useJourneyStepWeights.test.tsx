import { renderHook } from '@testing-library/react';
import { useJourneyStepWeights } from './useJourneyStepWeights';
import { resolveJourneyStepWeights } from '../../../docs-retrieval';
import type { Milestone } from '../../../types/content.types';

jest.mock('../../../docs-retrieval', () => ({
  resolveJourneyStepWeights: jest.fn(async () => undefined),
}));

const mockResolve = resolveJourneyStepWeights as jest.Mock;

const MILESTONES: Milestone[] = [
  { number: 1, title: 'm1', duration: '', url: 'https://example.com/lj/m1/content.json', isActive: false },
];

describe('useJourneyStepWeights', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('resolves weights for the journey and milestones', () => {
    renderHook(() => useJourneyStepWeights({ journeyKey: 'https://example.com/lj', milestones: MILESTONES }));
    expect(mockResolve).toHaveBeenCalledWith('https://example.com/lj', MILESTONES);
  });

  it('does nothing without a journey key or milestones', () => {
    renderHook(() => useJourneyStepWeights({ journeyKey: undefined, milestones: MILESTONES }));
    renderHook(() => useJourneyStepWeights({ journeyKey: 'https://example.com/lj', milestones: [] }));
    renderHook(() => useJourneyStepWeights({ journeyKey: 'https://example.com/lj', milestones: undefined }));
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('does not re-resolve when params are referentially unchanged', () => {
    const params = { journeyKey: 'https://example.com/lj', milestones: MILESTONES };
    const { rerender } = renderHook((p) => useJourneyStepWeights(p), { initialProps: params });
    rerender(params);
    expect(mockResolve).toHaveBeenCalledTimes(1);
  });
});
