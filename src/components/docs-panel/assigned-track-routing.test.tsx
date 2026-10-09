import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { RecommendationsSection } from './context-panel';
import { loadDocsTabContentResult } from './utils/docs-tab-loader';
import { LearningPathTableOfContents } from '../LearningPaths/LearningPathTableOfContents';
import { ContextService } from '../../context-engine';
import { setPackageResolver } from '../../docs-retrieval';
import { testIds } from '../../constants/testIds';
import type { ResolvedAssignment } from '../../learning-paths';
import type { PackageOpenInfo } from '../../types/content-panel.types';
import type { PackageResolver } from '../../types';
import type { V1Recommendation } from '../../types/v1-recommender.types';

jest.mock('@grafana/scenes', () => ({
  SceneObjectBase: class {},
}));

jest.mock('@grafana/runtime', () => ({
  config: { bootData: { user: { id: 1, orgId: 1 } }, namespace: 'stacks-123', featureToggles: {} },
  getAppEvents: () => ({ publish: jest.fn() }),
  getBackendSrv: () => ({ fetch: jest.fn(), get: jest.fn(), post: jest.fn() }),
  locationService: { push: jest.fn(), getSearchObject: () => ({}), getLocation: () => ({ pathname: '/' }) },
  usePluginUserStorage: jest.fn(),
  reportInteraction: jest.fn(),
}));

jest.mock('@grafana/i18n', () => ({
  t: (_key: string, fallback: string, vars?: Record<string, unknown>) =>
    vars ? fallback.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k])) : fallback,
}));

jest.mock('../../lib/user-storage', () => ({
  milestoneCompletionStorage: { getCompletedSync: jest.fn(() => new Set()) },
  interactiveCompletionStorage: { peekAll: jest.fn(() => ({})), set: jest.fn(() => Promise.resolve()) },
  journeyCompletionStorage: { getAll: jest.fn(), set: jest.fn(), clear: jest.fn() },
  learningProgressStorage: { get: jest.fn(), save: jest.fn() },
}));

const pathManifest = {
  id: 'welcome-to-grafana',
  type: 'path',
  milestones: ['loki-grafana-101', 'prometheus-grafana-101'],
  tracks: [{ trackId: 'engineer', label: 'Engineer', guides: ['first-dashboard'] }],
};

const v1Recommendation: V1Recommendation = {
  type: 'package',
  title: 'Welcome to Grafana',
  contentUrl: 'bundled:welcome-to-grafana/content.json',
  manifestUrl: 'bundled:welcome-to-grafana/manifest.json',
  repository: 'bundled',
  manifest: pathManifest,
};

const resolver: PackageResolver = {
  resolve: jest.fn().mockImplementation((id: string) =>
    Promise.resolve({
      ok: true,
      id,
      contentUrl: `bundled:${id}/content.json`,
      manifestUrl: `bundled:${id}/manifest.json`,
      repository: 'bundled',
      content: { id, title: `Guide: ${id}`, blocks: [] },
      manifest: id === pathManifest.id ? pathManifest : { id, type: 'guide' },
    })
  ),
};

const assignment: ResolvedAssignment = {
  targetId: 'welcome-to-grafana',
  title: 'Welcome to Grafana',
  trackId: 'engineer',
  overdue: false,
  satisfied: false,
  progress: 0,
};

function clickRecommendation(): { url: string; packageInfo: PackageOpenInfo } {
  const openDocsPage = jest.fn();
  render(
    <RecommendationsSection
      recommendations={[ContextService.sanitizeV1Recommendation(v1Recommendation)]}
      featuredRecommendations={[]}
      customGuides={[]}
      customGuidePaths={[]}
      customGuideOrphans={[]}
      isLoadingCustomGuides={false}
      customGuidesExpanded
      suggestedGuidesExpanded
      isLoadingRecommendations={false}
      isLoadingContext={false}
      recommendationsError={null}
      otherDocsExpanded={false}
      showEnableRecommenderBanner={false}
      openLearningJourney={jest.fn()}
      openDocsPage={openDocsPage}
      toggleCustomGuidesExpansion={jest.fn()}
      toggleSuggestedGuidesExpansion={jest.fn()}
      toggleSummaryExpansion={jest.fn()}
      toggleOtherDocsExpansion={jest.fn()}
      assignments={[assignment]}
    />
  );
  fireEvent.click(screen.getByTestId(testIds.contextPanel.recommendationStartButton(0)));
  const [url, , packageInfo] = openDocsPage.mock.calls[0];
  return { url, packageInfo };
}

describe('assigned-track routing from a V1 recommendation', () => {
  beforeEach(() => {
    setPackageResolver(resolver);
  });

  it('opens the path cover on the assigned track, even though the recommender manifest carries no tracks', async () => {
    const { url, packageInfo } = clickRecommendation();
    expect(packageInfo.packageManifest).not.toHaveProperty('tracks');
    expect(packageInfo.trackId).toBe('engineer');

    const result = await loadDocsTabContentResult(url, { packageInfo });
    const content = result.content!;
    const journey = content.metadata.learningJourney!;
    expect(content.metadata.packageManifest?.id).toBe(packageInfo.packageId);

    render(
      <LearningPathTableOfContents
        milestones={journey.milestones}
        baseUrl={journey.baseUrl}
        pathId={packageInfo.packageId}
        tracks={journey.tracks}
        initialActiveTrackId={packageInfo.trackId}
      />
    );

    expect(screen.getByTestId(testIds.learningPaths.tracksTab('engineer'))).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Guide: first-dashboard')).toBeInTheDocument();
    expect(screen.queryByText('Guide: loki-grafana-101')).not.toBeInTheDocument();
  });
});
