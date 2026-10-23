import { reportAppInteraction, UserInteraction } from '../lib/analytics';

import {
  completionAnalytics,
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
    sourceConfirmed: true,
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
      sourceConfirmed: true,
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

  it.each(['guide', 'journey'] as const)('reports the identity of a private %s', (kind) => {
    expect(
      identity({ kind, guideSource: 'app-platform', guideId: 'acme-onboarding', guideTitle: 'Acme onboarding' })
    ).toEqual({
      guide_source: 'app-platform',
      guide_visibility: 'private',
      [kind === 'guide' ? 'guide_id' : 'journey_id']: 'acme-onboarding',
      [kind === 'guide' ? 'guide_title' : 'journey_title']: 'Acme onboarding',
    });
  });

  it.each(['remote-repo:acme-internal', 'backend-guide:acme-guide', 'Bundled', ''])(
    'reports %p as other with private guide identity',
    (guideSource) => {
      expect(identity({ guideSource, guideId: 'acme-guide', guideTitle: 'Acme guide' })).toEqual({
        guide_source: 'other',
        guide_visibility: 'private',
        guide_id: 'acme-guide',
        guide_title: 'Acme guide',
      });
    }
  );

  it.each(['e2e-test', 'wysiwyg-preview'])('keeps the title of the local %s guide private', (guideId) => {
    expect(identity({ guideId, guideTitle: 'Acme draft' })).toEqual({
      guide_source: 'bundled',
      guide_visibility: 'private',
      guide_id: guideId,
    });
  });

  it('keys a local guide journey under journey_id', () => {
    expect(identity({ kind: 'journey', guideId: 'e2e-test', guideTitle: 'Acme draft' })).toEqual({
      guide_source: 'bundled',
      guide_visibility: 'private',
      journey_id: 'e2e-test',
    });
  });

  it('treats a local guide id from another source by that source', () => {
    expect(identity({ guideSource: 'interactive-tutorials', guideId: 'e2e-test', guideTitle: 'E2E' })).toEqual({
      guide_source: 'interactive-tutorials',
      guide_visibility: 'public',
      guide_id: 'e2e-test',
      guide_title: 'E2E',
    });
  });
});

describe('completion analytics — unconfirmed sources', () => {
  it.each(['bundled', 'interactive-tutorials', 'online-cdn'])(
    'keeps identity when %s was only a default',
    (guideSource) => {
      const properties = completionAnalytics(fact({ guideSource, sourceConfirmed: false })).properties;
      expect(properties).toMatchObject({ guide_source: 'unresolved', guide_visibility: 'private' });
      expect(properties).toMatchObject({ guide_id: 'prometheus-101', guide_title: 'Prometheus 101' });
    }
  );

  it('treats a fact with no confirmation as unconfirmed', () => {
    expect(completionAnalytics(fact({ sourceConfirmed: undefined })).properties).toMatchObject({
      guide_source: 'unresolved',
      guide_visibility: 'private',
    });
  });
});

describe('completion analytics — containing path', () => {
  const milestone = (pathIdentity: CompletionFact['pathIdentity']) =>
    completionAnalytics(fact({ guideCategory: 'learning-journey', guideId: 'install', pathIdentity })).properties;

  it('sends the path id of a confirmed public path', () => {
    expect(
      milestone({ guideSource: 'interactive-tutorials', guideId: 'linux-server-integration', sourceConfirmed: true })
    ).toMatchObject({ path_id: 'linux-server-integration' });
  });

  it.each([
    ['a private path', { guideSource: 'app-platform', guideId: 'acme-path', sourceConfirmed: true }],
    ['an unconfirmed path', { guideSource: 'interactive-tutorials', guideId: 'acme-path', sourceConfirmed: false }],
  ])('sends the path id for %s', (_label, pathIdentity) => {
    expect(milestone(pathIdentity)).toMatchObject({ path_id: 'acme-path' });
  });

  it('sends no path id outside a path', () => {
    expect(completionAnalytics(fact()).properties).not.toHaveProperty('path_id');
  });
});

describe('completion analytics — event properties', () => {
  it('reports a public guide with its identifier and title', () => {
    expect(completionAnalytics(fact({ durationMs: 42000 })).properties).toEqual({
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
    expect(completionAnalytics(fact({ guideSource })).properties).toMatchObject({
      guide_source: guideSource,
      guide_visibility: 'public',
      guide_id: 'prometheus-101',
    });
  });

  it('reports a private guide identifier and title', () => {
    const properties = completionAnalytics(
      fact({ guideSource: 'app-platform', guideId: 'acme-onboarding', guideTitle: 'Acme onboarding' })
    ).properties;

    expect(properties).toEqual({
      guide_source: 'app-platform',
      guide_visibility: 'private',
      guide_category: 'interactive',
      completion_source: 'objectives',
      completion_percentage: 100,
      guide_id: 'acme-onboarding',
      guide_title: 'Acme onboarding',
    });
  });

  it('does not report the name of an unrecognized source', () => {
    const properties = completionAnalytics(
      fact({ guideSource: 'remote-repo:acme-internal', guideId: 'acme-guide', guideTitle: 'Acme guide' })
    ).properties;

    expect(properties).toMatchObject({
      guide_source: 'other',
      guide_visibility: 'private',
      guide_id: 'acme-guide',
      guide_title: 'Acme guide',
    });
    expect(JSON.stringify(properties)).not.toContain('remote-repo:acme-internal');
  });

  it('does not report the title of an e2e run', () => {
    const properties = completionAnalytics(fact({ guideId: 'e2e-test', guideTitle: 'Acme draft' })).properties;

    expect(properties).toMatchObject({ guide_source: 'bundled', guide_visibility: 'private', guide_id: 'e2e-test' });
    expect(JSON.stringify(properties)).not.toMatch(/acme/i);
  });

  it('does not infer path identity from the legacy pathId field', () => {
    expect(completionAnalytics(fact({ pathId: 'acme-private-path' })).properties).not.toHaveProperty('path_id');
    expect(JSON.stringify(completionAnalytics(fact({ pathId: 'acme-private-path' })).properties)).not.toMatch(/acme/i);
  });

  it('identifies a private prose-only guide alongside its counts', () => {
    const properties = completionAnalytics(
      fact({
        guideSource: 'app-platform',
        guideId: 'private-name',
        guideTitle: 'Private title',
        source: 'manual',
        guideStats: {
          version: 1,
          blockCount: 4,
          completableBlockCount: 0,
          sectionCount: 0,
          finalCompletablePosition: 0,
        },
      })
    ).properties;
    expect(properties).toMatchObject({
      completion_source: 'manual',
      total_block_count: 4,
      completable_block_count: 0,
      section_count: 0,
      guide_stats_version: 1,
      block_progress_rule_version: 'block-position-v1',
    });
    expect(properties).toMatchObject({ guide_id: 'private-name', guide_title: 'Private title' });
  });

  it('does not invent counts when the rendered index is unavailable', () => {
    expect(completionAnalytics(fact()).properties).not.toHaveProperty('total_block_count');
    expect(completionAnalytics(fact()).properties).not.toHaveProperty('percentage_rule_version');
  });

  it('omits the duration when it was not measured', () => {
    expect(completionAnalytics(fact()).properties).not.toHaveProperty('duration_ms');
  });

  it('names a journey identity after the journey', () => {
    const properties = completionAnalytics(
      fact({ kind: 'journey', guideId: 'linux-server', guideTitle: 'Linux server', guideCategory: 'learning-journey' })
    ).properties;

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
      expect.objectContaining({ guide_id: 'prometheus-101' }),
      { privatePath: false }
    );
  });

  it('marks a private containing path for Faro redaction on a public guide', () => {
    reportCompletionAnalytics(
      fact({ pathIdentity: { guideSource: 'app-platform', guideId: 'customer-path', sourceConfirmed: true } })
    );
    expect(reportAppInteraction).toHaveBeenCalledWith(
      UserInteraction.GuideCompleted,
      expect.objectContaining({ guide_visibility: 'public', path_id: 'customer-path' }),
      { privatePath: true }
    );
  });

  it('omits unavailable private titles', () => {
    expect(
      completionAnalytics(fact({ guideSource: 'app-platform', guideTitle: undefined })).properties
    ).not.toHaveProperty('guide_title');
  });

  it('reports a journey completion as journey_completed', () => {
    reportCompletionAnalytics(fact({ kind: 'journey' }));

    expect(reportAppInteraction).toHaveBeenCalledWith(
      UserInteraction.JourneyCompleted,
      expect.objectContaining({ journey_id: 'prometheus-101' }),
      { privatePath: false }
    );
  });
});
