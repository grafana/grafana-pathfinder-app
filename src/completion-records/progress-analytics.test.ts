jest.mock('../lib/analytics', () => ({
  UserInteraction: { GuideProgress: 'guide_progress', GuideCompleted: 'guide_completed' },
  reportAppInteraction: jest.fn(),
}));
jest.mock('../utils/openfeature', () => ({ getFeatureFlagValue: jest.fn((_name, fallback) => fallback) }));

import { reportAppInteraction } from '../lib/analytics';
import { getFeatureFlagValue } from '../utils/openfeature';
import { completionAttemptAnalyticsProperties, reportGuideProgress } from './progress-analytics';

it('sends no progress and adds no completion correlation by default', () => {
  const identity = { guideSource: 'bundled', guideId: 'g', guideTitle: 'G', guideCategory: 'interactive' as const };
  reportGuideProgress(identity, 'attempt', 25, 25);
  const properties = completionAttemptAnalyticsProperties({
    ...identity,
    kind: 'guide',
    attemptId: 'attempt',
    completionPercent: 100,
    source: 'objectives',
    completedAt: new Date(0).toISOString(),
  });
  expect(properties).toEqual({});
  expect(getFeatureFlagValue).toHaveBeenCalledWith('pathfinder.progress-analytics', false);
  expect(reportAppInteraction).not.toHaveBeenCalled();
});
