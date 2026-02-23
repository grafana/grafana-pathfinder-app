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
});
