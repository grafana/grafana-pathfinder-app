import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { DocsPanelTabBar, type DocsPanelTabBarProps } from './DocsPanelTabBar';
import { testIds } from '../../../constants/testIds';

jest.mock('@grafana/i18n', () => ({
  t: (_key: string, fallback: string) => fallback,
}));

jest.mock('@grafana/runtime', () => {
  const mockPush = jest.fn();
  return {
    config: { bootData: { user: { orgRole: 'Admin', isGrafanaAdmin: false } } },
    getAppEvents: jest.fn(() => ({ publish: jest.fn() })),
    locationService: { push: mockPush },
    __mockPush: mockPush,
  };
});

jest.mock('../../../lib/analytics', () => ({
  reportAppInteraction: jest.fn(),
  getContentTypeForAnalytics: jest.fn((_url: string, fallback: string) => fallback ?? 'docs'),
  getJourneyProperties: (content?: {
    type?: string;
    metadata?: { learningJourney?: { currentMilestone?: number; totalMilestones?: number } };
  }) => {
    const lj = content?.type === 'learning-journey' ? content?.metadata?.learningJourney : undefined;
    if (!lj) {
      return {};
    }
    const total = lj.totalMilestones ?? 0;
    const current = lj.currentMilestone ?? 0;
    return {
      progress_step: current,
      progress_total: total,
      completion_percentage: total > 0 ? Math.round((current / total) * 100) : 0,
    };
  },
  tabTypeToContentType: (type?: string) => (type === 'interactive' ? 'interactive-guide' : type || 'docs'),
  UserInteraction: {
    DocsPanelInteraction: 'docs_panel_interaction',
    GeneralPluginFeedbackButton: 'general_plugin_feedback_button',
    CloseTabClick: 'close_tab_click',
  },
}));

jest.mock('../../../lib/storage/extension-sidebar', () => ({
  clearExtensionSidebarDocked: jest.fn(),
}));

const { __mockPush: mockPush } = jest.requireMock('@grafana/runtime');

function makeProps(overrides: Partial<DocsPanelTabBarProps> = {}): DocsPanelTabBarProps {
  const recommendationsTab: any = { id: 'recommendations', title: 'Recommendations', baseUrl: '', currentUrl: '' };
  const styles = new Proxy({}, { get: (_target, prop) => String(prop) }) as any;
  const ref = { current: null } as any;

  return {
    styles,
    tabs: [recommendationsTab],
    activeTabId: 'recommendations',
    activeTab: recommendationsTab,
    visibleTabs: [recommendationsTab],
    overflowGuideTabs: [],
    isEditorUser: false,
    isDevMode: false,
    isDropdownOpen: false,
    setIsDropdownOpen: jest.fn(),
    tabBarRef: ref,
    tabListRef: ref,
    dropdownRef: ref,
    chevronButtonRef: ref,
    dropdownOpenTimeRef: { current: 0 },
    onSetActiveTab: jest.fn(),
    onCloseTab: jest.fn(),
    reloadActiveTab: jest.fn(),
    ...overrides,
  };
}

describe('DocsPanelTabBar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('navigates to the My Learning page when the "My learning" button is clicked', () => {
    const props = makeProps();
    render(<DocsPanelTabBar {...props} />);

    fireEvent.click(screen.getByTestId(testIds.docsPanel.myLearningTab));

    expect(mockPush).toHaveBeenCalled();
    expect(props.onSetActiveTab).not.toHaveBeenCalled();
  });

  describe('overflow chevron', () => {
    const overflowTab: any = { id: 'overflow-1', title: 'overflow-1', baseUrl: '', currentUrl: '' };

    it('renders the count before the chevron and points it down when the dropdown is closed', () => {
      render(<DocsPanelTabBar {...makeProps({ overflowGuideTabs: [overflowTab], isDropdownOpen: false })} />);
      const button = screen.getByTestId(testIds.docsPanel.tabOverflowButton);
      expect(button.firstElementChild?.textContent).toBe('+1');
      expect(screen.getByTestId('angle-down')).toBeInTheDocument();
    });

    it('points the chevron up when the dropdown is open', () => {
      render(<DocsPanelTabBar {...makeProps({ overflowGuideTabs: [overflowTab], isDropdownOpen: true })} />);
      expect(screen.getByTestId('angle-up')).toBeInTheDocument();
      expect(screen.queryByTestId('angle-down')).not.toBeInTheDocument();
    });
  });

  it('reports the journey progress trio on close_tab_click for learning-journey tabs', () => {
    const journeyTab: any = {
      id: 'journey-1',
      title: 'Journey',
      type: 'learning-journey',
      baseUrl: 'https://example.com/lj',
      currentUrl: 'https://example.com/lj/m2',
      content: {
        type: 'learning-journey',
        metadata: { learningJourney: { currentMilestone: 2, totalMilestones: 4 } },
      },
    };
    const props = makeProps({ tabs: [journeyTab], visibleTabs: [journeyTab], activeTabId: 'journey-1' });
    render(<DocsPanelTabBar {...props} />);

    fireEvent.click(screen.getByTestId(testIds.docsPanel.tabCloseButton('journey-1')));

    const { reportAppInteraction } = jest.requireMock('../../../lib/analytics');
    expect(reportAppInteraction).toHaveBeenCalledWith(
      'close_tab_click',
      expect.objectContaining({
        content_type: 'learning-journey',
        progress_step: 2,
        progress_total: 4,
        completion_percentage: 50,
      })
    );
    expect(props.onCloseTab).toHaveBeenCalledWith('journey-1');
  });
});
