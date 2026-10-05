import { reportAppInteraction, UserInteraction } from '../lib/analytics';

import {
  completionAnalyticsProperties,
  guideIdentityAnalyticsProperties,
  reportCompletionAnalytics,
} from './completion-analytics';
import type { CompletionFact } from './types';

jest.mock('../lib/analytics', () => ({
  ...jest.requireActual('../lib/analytics'),
  reportAppInteraction: jest.fn(),
}));

function fact(overrides: Partial<CompletionFact> = {}): CompletionFact {
  return {
    kind: 'guide',
    guideSource: 'bundled',
    guideId: 'prometheus-101',
    guideTitle: 'Prometheus 101',
    guideCategory: 'interactive',
    completionPercent: 100,
    source: 'objectives',
    completedAt: '2026-09-30T00:00:00.000Z',
    ...overrides,
  };
}

describe('completion analytics — guide identity', () => {
  const identity = (overrides: Partial<Parameters<typeof guideIdentityAnalyticsProperties>[0]> = {}) =>
    guideIdentityAnalyticsProperties({
      kind: 'guide',
      guideSource: 'bundled',
      guideId: 'prometheus-101',
      guideTitle: 'Prometheus 101',
      ...overrides,
    });

  it.each(['bundled', 'interactive-tutorials', 'online-cdn'])('names a guide from %s', (guideSource) => {
    expect(identity({ guideSource })).toEqual({
      guide_source: guideSource,
      guide_visibility: 'public',
      guide_id: 'prometheus-101',
      guide_title: 'Prometheus 101',
    });
  });

  it('names a public journey under journey properties only', () => {
    expect(identity({ kind: 'journey', guideId: 'linux-server', guideTitle: 'Linux server' })).toEqual({
      guide_source: 'bundled',
      guide_visibility: 'public',
      journey_id: 'linux-server',
      journey_title: 'Linux server',
    });
  });

  it.each(['guide', 'journey'] as const)('reports only the source and visibility of a private %s', (kind) => {
    expect(
      identity({ kind, guideSource: 'app-platform', guideId: 'acme-onboarding', guideTitle: 'Acme onboarding' })
    ).toEqual({ guide_source: 'app-platform', guide_visibility: 'private' });
  });

  it.each(['remote-repo:acme-internal', 'backend-guide:acme-guide', 'Bundled', ''])(
    'reports %p as an unnamed private source',
    (guideSource) => {
      expect(identity({ guideSource, guideId: 'acme-guide', guideTitle: 'Acme guide' })).toEqual({
        guide_source: 'other',
        guide_visibility: 'private',
      });
    }
  );
});

describe('completion analytics — event properties', () => {
  it('reports a public guide with its identifier and title', () => {
    expect(completionAnalyticsProperties(fact({ durationMs: 42000 }))).toEqual({
      guide_source: 'bundled',
      guide_visibility: 'public',
      guide_category: 'interactive',
      completion_source: 'objectives',
      completion_percentage: 100,
      guide_id: 'prometheus-101',
      guide_title: 'Prometheus 101',
      duration_ms: 42000,
    });
  });

  it.each(['interactive-tutorials', 'online-cdn'])('treats %s as a public source', (guideSource) => {
    expect(completionAnalyticsProperties(fact({ guideSource }))).toMatchObject({
      guide_source: guideSource,
      guide_visibility: 'public',
      guide_id: 'prometheus-101',
    });
  });

  it('keeps a private guide identifier and title on the stack', () => {
    const properties = completionAnalyticsProperties(
      fact({ guideSource: 'app-platform', guideId: 'acme-onboarding', guideTitle: 'Acme onboarding' })
    );

    expect(properties).toEqual({
      guide_source: 'app-platform',
      guide_visibility: 'private',
      guide_category: 'interactive',
      completion_source: 'objectives',
      completion_percentage: 100,
    });
    expect(JSON.stringify(properties)).not.toMatch(/acme/i);
  });

  it('does not report the name of an unrecognized source', () => {
    const properties = completionAnalyticsProperties(
      fact({ guideSource: 'remote-repo:acme-internal', guideId: 'acme-guide', guideTitle: 'Acme guide' })
    );

    expect(properties).toMatchObject({ guide_source: 'other', guide_visibility: 'private' });
    expect(JSON.stringify(properties)).not.toMatch(/acme/i);
  });

  it('never reports a learning path identifier, even for a public guide', () => {
    expect(completionAnalyticsProperties(fact({ pathId: 'acme-private-path' }))).not.toHaveProperty('path_id');
    expect(JSON.stringify(completionAnalyticsProperties(fact({ pathId: 'acme-private-path' })))).not.toMatch(/acme/i);
  });

  it('omits the duration when it was not measured', () => {
    expect(completionAnalyticsProperties(fact())).not.toHaveProperty('duration_ms');
  });

  it('names a journey identity after the journey', () => {
    const properties = completionAnalyticsProperties(
      fact({ kind: 'journey', guideId: 'linux-server', guideTitle: 'Linux server', guideCategory: 'learning-journey' })
    );

    expect(properties).toMatchObject({ journey_id: 'linux-server', journey_title: 'Linux server' });
    expect(properties).not.toHaveProperty('guide_id');
    expect(properties).not.toHaveProperty('guide_title');
  });
});

describe('completion analytics — reporting', () => {
  beforeEach(() => {
    jest.mocked(reportAppInteraction).mockClear();
  });

  it('reports a guide completion as guide_completed', () => {
    reportCompletionAnalytics(fact());

    expect(reportAppInteraction).toHaveBeenCalledWith(
      UserInteraction.GuideCompleted,
      expect.objectContaining({ guide_id: 'prometheus-101' })
    );
  });

  it('reports a journey completion as journey_completed', () => {
    reportCompletionAnalytics(fact({ kind: 'journey' }));

    expect(reportAppInteraction).toHaveBeenCalledWith(
      UserInteraction.JourneyCompleted,
      expect.objectContaining({ journey_id: 'prometheus-101' })
    );
  });
});
