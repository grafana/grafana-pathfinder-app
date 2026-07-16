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
  getContentTypeForAnalytics: jest.fn(() => 'docs'),
  UserInteraction: {
    DocsPanelInteraction: 'docs_panel_interaction',
    GeneralPluginFeedbackButton: 'general_plugin_feedback_button',
    CloseTabClick: 'close_tab_click',
  },
}));

jest.mock('../../../lib/storage/extension-sidebar', () => ({
  clearExtensionSidebarDocked: jest.fn(),
}));

jest.mock('../../../docs-retrieval', () => ({
  getJourneyProgress: jest.fn(() => 0),
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
});
