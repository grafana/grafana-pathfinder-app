import { reportInteraction } from '@grafana/runtime';
import { reportAppInteraction, UserInteraction } from './analytics';
import { toAnalyticsLaunchSource } from '../recovery';
import { drainValueCasingViolations } from './analytics-value-check';
import { publicCatalogTopics, reportCatalogInteraction } from './catalog-analytics';
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
  ])('reports %s as %s', (source, expected) => {
    reportAppInteraction(UserInteraction.DocsPanelInteraction, {
      action: 'auto_open',
      source: toAnalyticsLaunchSource(source),
    });
    reportAppInteraction(UserInteraction.AlignmentPromptShown, { launch_source: toAnalyticsLaunchSource(source) });

    expect(sent()).toEqual([
      expect.objectContaining({ source: expected }),
      expect.objectContaining({ launch_source: expected }),
    ]);
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

  const catalogItems = [
    { id: 'play-intro', title: 'Play intro', category: 'play-demos', source: 'grafana' },
    { id: 'internal', title: 'Internal runbook', category: 'customer-secret', source: 'organization' },
  ] as const;

  it('reports an approved external catalog topic verbatim without a casing violation', () => {
    reportCatalogInteraction({
      action: 'topic',
      topic: 'play-demos',
      control: 'filter',
      publicTopics: publicCatalogTopics(catalogItems),
    });

    expect(sent()).toEqual([expect.objectContaining({ topic: 'play-demos' })]);
    expect(drainValueCasingViolations()).toEqual([]);
  });

  it('still flags a kebab-case topic that is not in the approved set', () => {
    reportAppInteraction(UserInteraction.CatalogInteraction, { topic: 'customer-secret' });

    expect(drainValueCasingViolations()).toEqual(['pathfinder_catalog_interaction: topic=customer-secret']);
  });
});

describe('datasource types', () => {
  it('reports a Grafana datasource plugin type verbatim without a casing violation', () => {
    reportAppInteraction(UserInteraction.DataCheckRun, {
      datasource_type: 'grafana-pyroscope-datasource',
      variable_name: 'datasource',
      blocking: false,
    });

    expect(sent()).toEqual([expect.objectContaining({ datasource_type: 'grafana-pyroscope-datasource' })]);
    expect(drainValueCasingViolations()).toEqual([]);
  });

  it('still flags a kebab-case value on an internal property', () => {
    reportAppInteraction(UserInteraction.DataCheckRun, { datasource_type: 'prometheus', outcome: 'not-run' });

    expect(drainValueCasingViolations()).toEqual(['pathfinder_data_check_run: outcome=not-run']);
  });
});
