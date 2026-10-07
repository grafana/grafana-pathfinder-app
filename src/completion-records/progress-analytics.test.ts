jest.mock('../lib/analytics', () => ({
  UserInteraction: { GuideProgress: 'guide_progress', GuideCompleted: 'guide_completed' },
  reportAppInteraction: jest.fn(),
}));
jest.mock('../utils/openfeature', () => ({ getFeatureFlagValue: jest.fn((_name, fallback) => fallback) }));

import { reportAppInteraction } from '../lib/analytics';
import { getFeatureFlagValue } from '../utils/openfeature';
import { reportGuideCompleted, reportGuideProgress } from './progress-analytics';

it('sends neither progress nor completion analytics by default', () => {
  const identity = { guideSource: 'bundled', guideId: 'g', guideTitle: 'G', guideCategory: 'interactive' as const };
  reportGuideProgress(identity, 'attempt', 25, 25);
  reportGuideCompleted({
    ...identity,
    kind: 'guide',
    attemptId: 'attempt',
    completionPercent: 100,
    source: 'objectives',
    completedAt: new Date(0).toISOString(),
  });
  expect(getFeatureFlagValue).toHaveBeenCalledWith('pathfinder.progress-analytics', false);
  expect(reportAppInteraction).not.toHaveBeenCalled();
});
