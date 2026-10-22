import { reportInteraction } from '@grafana/runtime';
import { reportAppInteraction, UserInteraction } from './analytics';
import { toAnalyticsLaunchSource } from '../recovery';
import { drainValueCasingViolations } from './analytics-value-check';
import { reportCatalogInteraction } from './catalog-analytics';
import { reportGuideProgress } from '../completion-records/progress-analytics';

jest.mock('@grafana/runtime', () => ({
  ...jest.requireActual('@grafana/runtime'),
  reportInteraction: jest.fn(),
}));

jest.mock('./telemetry/bridge', () => ({
  pushFaroUserAction: jest.fn(),
  pushFaroLog: jest.fn(),
  pushFaroError: jest.fn(),
}));

jest.mock('../utils/openfeature', () => ({
  getFeatureFlagValue: jest.fn((name: string, fallback: unknown) =>
    name === 'pathfinder.progress-analytics' ? true : fallback
  ),
}));

function sent(): Array<Record<string, unknown>> {
  return jest.mocked(reportInteraction).mock.calls.map(([, properties]) => properties ?? {});
}

beforeEach(() => {
  jest.mocked(reportInteraction).mockClear();
});

describe('launch sources', () => {
  it.each([
    ['plg-survey-frontend-o11y', 'plg-survey-frontend-o11y'],
    ['learning-hub', 'learning_hub'],
    ['navigate-action', 'navigate_action'],
    ['command_palette', 'command_palette'],
  ])('reports %s as %s without a casing violation', (source, expected) => {
    reportAppInteraction(UserInteraction.DocsPanelInteraction, {
      action: 'auto_open',
      source: toAnalyticsLaunchSource(source),
    });
    reportAppInteraction(UserInteraction.AlignmentPromptShown, { launch_source: toAnalyticsLaunchSource(source) });

    expect(sent()).toEqual([
      expect.objectContaining({ source: expected }),
      expect.objectContaining({ launch_source: expected }),
    ]);
    expect(drainValueCasingViolations()).toEqual([]);
  });
});

describe('guide progress', () => {
  const identity = { guideId: 'g', guideTitle: 'G', guideCategory: 'interactive' as const };

  it.each([
    ['interactive-tutorials', 'interactive_tutorials'],
    ['app-platform', 'app_platform'],
    ['acme/private-guides', 'other'],
    ['my-team-repo', 'other'],
  ])('reports manifest repository %s as guide_source %s', (guideSource, expected) => {
    reportGuideProgress({ ...identity, guideSource }, 'attempt', 25, 25);

    expect(sent()).toEqual([expect.objectContaining({ guide_source: expected })]);
    expect(drainValueCasingViolations()).toEqual([]);
  });
});

describe('catalog', () => {
  it('reports search and topic vocabulary in snake_case', () => {
    reportCatalogInteraction({ action: 'search', topic: 'frontend-observability' });
    reportCatalogInteraction({ action: 'topic', topic: 'getting-started', control: 'filter' });

    expect(sent()).toEqual([
      expect.objectContaining({ search_topic: 'frontend_observability' }),
      expect.objectContaining({ topic: 'getting_started' }),
    ]);
    expect(drainValueCasingViolations()).toEqual([]);
  });
});
