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
});
