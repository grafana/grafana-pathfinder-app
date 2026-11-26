/**
 * Flag-on handoff from the Grafana Learn resolver to the durable completion
 * record (#2512 and #2513, docs/design/GRAFANA_LEARN.md section 7). The
 * milestones come straight from `resolveLearnJourney`, never a hand-built tree.
 */
jest.mock('@grafana/runtime', () => ({
  config: { namespace: 'stacks-123' },
  usePluginUserStorage: jest.fn(),
  getAppEvents: jest.fn(() => ({ publish: jest.fn() })),
  reportInteraction: jest.fn(),
}));

jest.mock('../utils/openfeature', () => ({ getFeatureFlagValue: jest.fn() }));

jest.mock('../lib/guide-completion-bridge', () => {
  const coordinator: typeof import('../learning-paths/badge-coordinator') = jest.requireActual(
    '../learning-paths/badge-coordinator'
  );
  return {
    __esModule: true,
    markGuideCompleted: coordinator.markGuideCompleted,
    awardBadge: coordinator.awardBadge,
    findPathByUrl: () => undefined,
  };
});

jest.mock('../global-state/completion-store', () => ({
  __esModule: true,
  evictContentCache: jest.fn(),
}));

import { onCompletionRecorded, __resetRecorderForTests, type CompletionFact } from '../completion-records';
import { createLearnFetch } from '../test-utils/learn-index-fetch';
import { isLearnJourneyModeEnabled } from '../utils/learn-journey-mode';
import { getFeatureFlagValue } from '../utils/openfeature';
import { resetLearnJourneyCache, resolveLearnJourney } from './content-fetcher/learn-journey';
import { markMilestoneDone, resetMilestoneBackfillGuardForTests } from './learning-journey-helpers';

const HUB = 'https://grafana.com/docs/learning-hub';
const ASSISTANT = `${HUB}/intro-to-grafana-assistant`;

const flag = getFeatureFlagValue as jest.MockedFunction<typeof getFeatureFlagValue>;

let emitted: CompletionFact[];
let unsubscribe: () => void;

beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
  __resetRecorderForTests();
  resetMilestoneBackfillGuardForTests();
  resetLearnJourneyCache();
  flag.mockReturnValue(true);
  global.fetch = createLearnFetch() as unknown as typeof fetch;
  emitted = [];
  unsubscribe = onCompletionRecorded((fact) => {
    emitted.push(fact);
    return true;
  });
});

afterEach(() => {
  unsubscribe();
});

describe('Grafana Learn step opened through the resolver with the flag on', () => {
  it('records the step the resolver returned under its Learn path and journey slug', async () => {
    expect(isLearnJourneyModeEnabled()).toBe(true);
    const journey = await resolveLearnJourney(ASSISTANT);
    const step = journey!.milestones.find((milestone) => milestone.title === 'Use Learn mode')!;
    const stepPath = step.url.slice(`${HUB}/`.length).replace(/\/$/, '');
    expect(stepPath.split('/')).toHaveLength(3);

    await markMilestoneDone(
      journey!.baseUrl,
      stepPath.split('/').pop()!,
      step.url,
      journey!.milestones.map((milestone) => milestone.url),
      { guideTitle: step.title }
    );

    const guideFacts = emitted.filter((fact) => fact.kind === 'guide');
    expect(guideFacts).toEqual([
      expect.objectContaining({
        guideSource: 'grafana-learn',
        guideId: stepPath,
        guideCategory: 'learning-journey',
        pathId: 'intro-to-grafana-assistant',
        completionPercent: 100,
      }),
    ]);
    expect(emitted.filter((fact) => fact.kind === 'journey')).toEqual([]);
  });
});
