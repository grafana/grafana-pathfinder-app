import { renderHook } from '@testing-library/react';
import { useJourneyStepWeights } from './useJourneyStepWeights';
import { resolveJourneyStepWeights } from '../../../docs-retrieval';
import type { Milestone } from '../../../types/content.types';
import type { LearningJourneyTab } from '../../../types/content-panel.types';

jest.mock('../../../docs-retrieval', () => ({
  resolveJourneyStepWeights: jest.fn(async () => undefined),
}));

const mockResolve = resolveJourneyStepWeights as jest.Mock;

const MILESTONES: Milestone[] = [
  { number: 1, title: 'm1', duration: '', url: 'https://example.com/lj/m1/content.json', isActive: false },
];

function journeyTab(): LearningJourneyTab {
  return {
    id: 'journey',
    title: 'Journey',
    baseUrl: 'https://cdn.example.com/package/path',
    currentUrl: 'https://cdn.example.com/package/path/m1/content.json',
    content: {
      content: '{}',
      metadata: {
        title: 'Journey',
        learningJourney: {
          currentMilestone: 1,
          totalMilestones: 1,
          milestones: MILESTONES,
          baseUrl: 'https://grafana.com/docs/learning-paths/journey',
        },
      },
      type: 'learning-journey',
      url: 'https://cdn.example.com/package/path/m1/content.json',
      lastFetched: '2026-07-21T00:00:00.000Z',
    },
    isLoading: false,
    error: null,
    type: 'learning-journey',
  };
}

describe('useJourneyStepWeights', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses the completion-store journey key and metadata milestones', () => {
    const tab = journeyTab();
    renderHook(() => useJourneyStepWeights(tab));
    expect(mockResolve).toHaveBeenCalledWith('https://grafana.com/docs/learning-paths/journey', MILESTONES);
  });

  it('does nothing without an active learning journey', () => {
    renderHook(() => useJourneyStepWeights(undefined));
    renderHook(() => useJourneyStepWeights({ ...journeyTab(), type: 'docs' }));
    renderHook(() => useJourneyStepWeights({ ...journeyTab(), content: null }));
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('does not re-resolve when the active tab is referentially unchanged', () => {
    const tab = journeyTab();
    const { rerender } = renderHook((activeTab) => useJourneyStepWeights(activeTab), { initialProps: tab });
    rerender(tab);
    expect(mockResolve).toHaveBeenCalledTimes(1);
  });
});
