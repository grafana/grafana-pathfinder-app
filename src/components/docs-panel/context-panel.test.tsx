import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { RecommendationsSection } from './context-panel';
import { PLUGIN_BASE_URL } from '../../constants';

jest.mock('@grafana/scenes', () => ({
  SceneObjectBase: class {},
}));

jest.mock('@grafana/runtime', () => {
  const mockPublish = jest.fn();
  const mockPush = jest.fn();
  return {
    getAppEvents: jest.fn(() => ({ publish: mockPublish })),
    locationService: { push: mockPush },
    config: { bootData: { user: { id: 1 } } },
    __mockPublish: mockPublish,
    __mockPush: mockPush,
  };
});

jest.mock('@grafana/i18n', () => ({
  t: jest.fn((key: string, fallback: string) => fallback),
}));

const { __mockPublish: mockPublish, __mockPush: mockPush } = jest.requireMock('@grafana/runtime');

describe('RecommendationsSection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('closes sidebar and navigates to my learning when empty-state button is clicked', () => {
    render(
      <RecommendationsSection
        recommendations={[]}
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
        openDocsPage={jest.fn()}
        toggleCustomGuidesExpansion={jest.fn()}
        toggleSuggestedGuidesExpansion={jest.fn()}
        toggleSummaryExpansion={jest.fn()}
        toggleOtherDocsExpansion={jest.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'My learning' }));

    expect(mockPublish).toHaveBeenCalledWith({
      type: 'close-extension-sidebar',
      payload: {},
    });
    expect(mockPush).toHaveBeenCalledWith(PLUGIN_BASE_URL);
  });

  it('passes package metadata to openDocsPage for package-backed recommendations', () => {
    const openDocsPage = jest.fn();

    render(
      <RecommendationsSection
        recommendations={[
          {
            title: 'Alerting 101',
            url: '',
            contentUrl: 'https://interactive-learning.grafana.net/packages/alerting-101/content.json',
            type: 'package',
            summary: 'Learn alerting basics.',
            manifest: { id: 'alerting-101', type: 'guide' },
          },
        ]}
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
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Start' }));

    expect(openDocsPage).toHaveBeenCalledWith(
      'https://interactive-learning.grafana.net/packages/alerting-101/content.json',
      'Alerting 101',
      {
        packageId: 'alerting-101',
        packageManifest: { id: 'alerting-101', type: 'guide' },
      }
    );
  });

  it('displays path-type package as learning path, not interactive guide', () => {
    render(
      <RecommendationsSection
        recommendations={[
          {
            title: 'Prometheus learning path',
            url: '',
            contentUrl: 'https://interactive-learning.grafana.net/packages/prometheus-lj/content.json',
            type: 'package',
            summary: 'Learn Prometheus step by step.',
            manifest: { id: 'prometheus-lj', type: 'path', milestones: ['step-1', 'step-2'] },
          },
        ]}
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
        openDocsPage={jest.fn()}
        toggleCustomGuidesExpansion={jest.fn()}
        toggleSuggestedGuidesExpansion={jest.fn()}
        toggleSummaryExpansion={jest.fn()}
        toggleOtherDocsExpansion={jest.fn()}
      />
    );

    expect(screen.getByText('Learning path')).toBeInTheDocument();
    expect(screen.queryByText('Interactive guide')).not.toBeInTheDocument();
  });

  it('still routes path-type packages through openDocsPage (not openLearningJourney)', () => {
    const openDocsPage = jest.fn();
    const openLearningJourney = jest.fn();

    render(
      <RecommendationsSection
        recommendations={[
          {
            title: 'Prometheus learning path',
            url: '',
            contentUrl: 'https://interactive-learning.grafana.net/packages/prometheus-lj/content.json',
            type: 'package',
            summary: 'Learn Prometheus.',
            manifest: { id: 'prometheus-lj', type: 'path' },
          },
        ]}
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
        openLearningJourney={openLearningJourney}
        openDocsPage={openDocsPage}
        toggleCustomGuidesExpansion={jest.fn()}
        toggleSuggestedGuidesExpansion={jest.fn()}
        toggleSummaryExpansion={jest.fn()}
        toggleOtherDocsExpansion={jest.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Start' }));

    expect(openDocsPage).toHaveBeenCalledWith(
      'https://interactive-learning.grafana.net/packages/prometheus-lj/content.json',
      'Prometheus learning path',
      {
        packageId: 'prometheus-lj',
        packageManifest: { id: 'prometheus-lj', type: 'path' },
      }
    );
    expect(openLearningJourney).not.toHaveBeenCalled();
  });

  it('displays guide-type package as interactive guide', () => {
    render(
      <RecommendationsSection
        recommendations={[
          {
            title: 'Alerting 101',
            url: '',
            contentUrl: 'https://interactive-learning.grafana.net/packages/alerting-101/content.json',
            type: 'package',
            summary: 'Learn alerting basics.',
            manifest: { id: 'alerting-101', type: 'guide' },
          },
        ]}
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
        openDocsPage={jest.fn()}
        toggleCustomGuidesExpansion={jest.fn()}
        toggleSuggestedGuidesExpansion={jest.fn()}
        toggleSummaryExpansion={jest.fn()}
        toggleOtherDocsExpansion={jest.fn()}
      />
    );

    expect(screen.getByText('Interactive guide')).toBeInTheDocument();
    expect(screen.queryByText('Learning path')).not.toBeInTheDocument();
  });

  it('calls toggleSummaryExpansion with contentUrl for package-backed recommendations', () => {
    const toggleSummaryExpansion = jest.fn();
    // 21+ words — above SUMMARY_COLLAPSE_WORD_THRESHOLD (20) so the Summary control appears.
    const longSummary = '1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21';

    render(
      <RecommendationsSection
        recommendations={[
          {
            title: 'Alerting 101',
            url: '',
            contentUrl: 'https://interactive-learning.grafana.net/packages/alerting-101/content.json',
            type: 'package',
            summary: longSummary,
            manifest: { id: 'alerting-101', type: 'guide' },
          },
        ]}
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
        openDocsPage={jest.fn()}
        toggleCustomGuidesExpansion={jest.fn()}
        toggleSuggestedGuidesExpansion={jest.fn()}
        toggleSummaryExpansion={toggleSummaryExpansion}
        toggleOtherDocsExpansion={jest.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Summary' }));

    expect(toggleSummaryExpansion).toHaveBeenCalledWith(
      'https://interactive-learning.grafana.net/packages/alerting-101/content.json'
    );
  });

  it('renders short summaries inline without a Summary collapse button', () => {
    render(
      <RecommendationsSection
        recommendations={[
          {
            title: 'Alerting 101',
            url: '',
            contentUrl: 'https://interactive-learning.grafana.net/packages/alerting-101/content.json',
            type: 'package',
            summary: 'Learn alerting basics.',
            manifest: { id: 'alerting-101', type: 'guide' },
            completionPercentage: 10,
          },
        ]}
        featuredRecommendations={[]}
        customGuides={[]}
        isLoadingCustomGuides={false}
        customGuidesExpanded
        suggestedGuidesExpanded
        isLoadingRecommendations={false}
        isLoadingContext={false}
        recommendationsError={null}
        otherDocsExpanded={false}
        showEnableRecommenderBanner={false}
        openLearningJourney={jest.fn()}
        openDocsPage={jest.fn()}
        toggleCustomGuidesExpansion={jest.fn()}
        toggleSuggestedGuidesExpansion={jest.fn()}
        toggleSummaryExpansion={jest.fn()}
        toggleOtherDocsExpansion={jest.fn()}
      />
    );

    expect(screen.queryByRole('button', { name: 'Summary' })).not.toBeInTheDocument();
    expect(screen.getByText('Learn alerting basics.')).toBeInTheDocument();
    expect(screen.getByText('{{percent}}% complete')).toBeInTheDocument();
  });

  it('keeps the Summary collapse button when short summary has expandable milestone details', () => {
    render(
      <RecommendationsSection
        recommendations={[
          {
            title: 'Alerting 101',
            url: '',
            contentUrl: 'https://interactive-learning.grafana.net/packages/alerting-101/content.json',
            type: 'package',
            summary: 'Learn alerting basics.',
            totalSteps: 3,
            pendingMilestoneIds: ['intro', 'configure', 'verify'],
            manifest: { id: 'alerting-101', type: 'guide' },
          },
        ]}
        featuredRecommendations={[]}
        customGuides={[]}
        isLoadingCustomGuides={false}
        customGuidesExpanded
        suggestedGuidesExpanded
        isLoadingRecommendations={false}
        isLoadingContext={false}
        recommendationsError={null}
        otherDocsExpanded={false}
        showEnableRecommenderBanner={false}
        openLearningJourney={jest.fn()}
        openDocsPage={jest.fn()}
        toggleCustomGuidesExpansion={jest.fn()}
        toggleSuggestedGuidesExpansion={jest.fn()}
        toggleSummaryExpansion={jest.fn()}
        toggleOtherDocsExpansion={jest.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Summary' })).toBeInTheDocument();
    expect(screen.queryByText('Learn alerting basics.')).not.toBeInTheDocument();
  });

  it('shows completion percentage for package with completionPercentage set', () => {
    render(
      <RecommendationsSection
        recommendations={[
          {
            title: 'Alerting 101',
            url: '',
            contentUrl: 'https://interactive-learning.grafana.net/packages/alerting-101/content.json',
            type: 'package',
            summary: 'Learn alerting basics.',
            manifest: { id: 'alerting-101', type: 'guide' },
            completionPercentage: 42,
          },
        ]}
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
        openDocsPage={jest.fn()}
        toggleCustomGuidesExpansion={jest.fn()}
        toggleSuggestedGuidesExpansion={jest.fn()}
        toggleSummaryExpansion={jest.fn()}
        toggleOtherDocsExpansion={jest.fn()}
      />
    );

    expect(screen.getByText('{{percent}}% complete')).toBeInTheDocument();
  });

  it('shows Resume button for package with partial completion', () => {
    render(
      <RecommendationsSection
        recommendations={[
          {
            title: 'Alerting 101',
            url: '',
            contentUrl: 'https://interactive-learning.grafana.net/packages/alerting-101/content.json',
            type: 'package',
            summary: 'Learn alerting basics.',
            manifest: { id: 'alerting-101', type: 'guide' },
            completionPercentage: 50,
          },
        ]}
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
        openDocsPage={jest.fn()}
        toggleCustomGuidesExpansion={jest.fn()}
        toggleSuggestedGuidesExpansion={jest.fn()}
        toggleSummaryExpansion={jest.fn()}
        toggleOtherDocsExpansion={jest.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
  });

  it('renders recommended next links for package with manifest.recommends', () => {
    const openDocsPage = jest.fn();

    render(
      <RecommendationsSection
        recommendations={[
          {
            title: 'Alerting 101',
            url: '',
            contentUrl: 'https://interactive-learning.grafana.net/packages/alerting-101/content.json',
            type: 'package',
            summary: 'Learn alerting basics.',
            summaryExpanded: true,
            manifest: {
              id: 'alerting-101',
              type: 'guide',
              recommends: ['alerting-notifications', 'slo-quickstart'],
              suggests: ['explore-drilldowns-101'],
            },
          },
        ]}
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
      />
    );

    expect(screen.getByText('Recommended next')).toBeInTheDocument();
    expect(screen.getByText('alerting-notifications')).toBeInTheDocument();
    expect(screen.getByText('slo-quickstart')).toBeInTheDocument();

    expect(screen.getByText('You might also like')).toBeInTheDocument();
    expect(screen.getByText('explore-drilldowns-101')).toBeInTheDocument();

    fireEvent.click(screen.getByText('alerting-notifications'));
    expect(openDocsPage).toHaveBeenCalledWith('', 'alerting-notifications', {
      packageId: 'alerting-notifications',
      packageManifest: undefined,
    });
  });

  it('renders resolved titles for recommends/suggests when pre-resolved data is available', () => {
    const openDocsPage = jest.fn();

    render(
      <RecommendationsSection
        recommendations={[
          {
            title: 'Grafana Cloud Tour',
            url: '',
            contentUrl: 'https://cdn.example.com/packages/cloud-tour/content.json',
            type: 'package',
            summary: 'Tour Grafana Cloud.',
            summaryExpanded: true,
            manifest: {
              id: 'grafana-cloud-tour-lj',
              type: 'path',
              suggests: ['visualization-metrics-lj', 'linux-server-integration-lj'],
            },
            resolvedSuggests: [
              {
                packageId: 'visualization-metrics-lj',
                title: 'Visualize metrics',
                contentUrl: 'bundled:visualization-metrics-lj/content.json',
                manifest: { id: 'visualization-metrics-lj', type: 'path' },
              },
              {
                packageId: 'linux-server-integration-lj',
                title: 'Monitor a Linux server',
                contentUrl: 'bundled:linux-server-integration-lj/content.json',
                manifest: { id: 'linux-server-integration-lj', type: 'path' },
              },
            ],
          },
        ]}
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
      />
    );

    expect(screen.getByText('You might also like')).toBeInTheDocument();
    expect(screen.getByText('Visualize metrics')).toBeInTheDocument();
    expect(screen.getByText('Monitor a Linux server')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Visualize metrics'));
    expect(openDocsPage).toHaveBeenCalledWith('bundled:visualization-metrics-lj/content.json', 'Visualize metrics', {
      packageId: 'visualization-metrics-lj',
      packageManifest: { id: 'visualization-metrics-lj', type: 'path' },
    });
  });
});
