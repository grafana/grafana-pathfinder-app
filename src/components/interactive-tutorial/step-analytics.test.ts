import { buildStepEventProperties, journeyContextProperties } from './step-analytics';
import { setActiveJourneyContext, resetJourneyContextForTests } from '../../global-state/journey-context';

jest.mock('../../global-state/completion-store', () => ({
  getGuideProgress: jest.fn(() => ({ completed: 3, total: 7, percentage: 43 })),
}));

jest.mock('../../global-state/content-key', () => ({
  getContentKey: jest.fn(() => 'https://example.com/guide/content.json'),
}));

jest.mock('../../lib/analytics', () => ({
  AnalyticsContentType: { LearningJourney: 'learning-journey', InteractiveGuide: 'interactive-guide' },
  buildInteractiveStepProperties: (base: Record<string, unknown>, ctx: Record<string, unknown>) => ({
    ...base,
    content_type: 'interactive-guide',
    progress_step: ((ctx.stepIndex as number) ?? 0) + 1,
    progress_total: ctx.totalSteps,
    completion_percentage: ctx.completionPercentage,
  }),
}));

describe('step-analytics', () => {
  afterEach(() => {
    resetJourneyContextForTests();
  });

  it('injects the completed-steps percentage from the completion store at event time', () => {
    const props = buildStepEventProperties({ target_action: 'button' }, { stepId: 's1', stepIndex: 1, totalSteps: 7 });

    expect(props).toEqual(
      expect.objectContaining({
        target_action: 'button',
        content_type: 'interactive-guide',
        progress_step: 2,
        progress_total: 7,
        completion_percentage: 43,
      })
    );
  });

  it('adds no journey fields for standalone guides', () => {
    expect(journeyContextProperties()).toEqual({});
    const props = buildStepEventProperties({}, { stepIndex: 0, totalSteps: 2 });
    expect(props).not.toHaveProperty('journey_url');
    expect(props).not.toHaveProperty('milestone_number');
  });

  it('overrides content_type to learning-journey and adds milestone context inside a path', () => {
    setActiveJourneyContext({
      journeyUrl: 'https://interactive-learning.grafana.net/packages/adaptive-logs-lj/content.json',
      milestoneNumber: 3,
      totalMilestones: 5,
    });

    const props = buildStepEventProperties({}, { stepIndex: 0, totalSteps: 2 });

    expect(props).toEqual(
      expect.objectContaining({
        content_type: 'learning-journey',
        journey_url: 'https://interactive-learning.grafana.net/packages/adaptive-logs-lj/content.json',
        milestone_number: 3,
        milestone_total: 5,
        progress_step: 1,
        progress_total: 2,
        completion_percentage: 43,
      })
    );
  });
});
