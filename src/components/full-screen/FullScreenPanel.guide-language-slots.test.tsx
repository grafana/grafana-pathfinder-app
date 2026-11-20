import React from 'react';
import { act, render, screen } from '@testing-library/react';

jest.mock('@grafana/runtime', () => ({
  config: { bootData: { user: {} } },
  usePluginUserStorage: jest.fn(),
  getAppEvents: () => ({ publish: jest.fn() }),
  locationService: { push: jest.fn(), getHistory: () => ({ listen: () => () => undefined }) },
}));

jest.mock('@grafana/scenes', () => ({
  SceneObjectBase: class {},
  SceneAppPage: class {},
  sceneGraph: { getAncestor: () => ({ setState: jest.fn() }) },
}));

jest.mock('@grafana/ui', () => ({
  useStyles2: () => ({}),
  useTheme2: () => ({}),
  IconButton: () => null,
}));

const mockTab = {
  id: 'tab-1',
  title: 'My guide',
  type: 'docs',
  baseUrl: 'https://example.com/remote-guide',
  currentUrl: 'https://example.com/remote-guide/content.json',
  content: {
    url: 'https://example.com/remote-guide/content.json',
    type: 'docs',
    content: '',
    metadata: { title: 'Remote guide' },
    lastFetched: '',
  },
};

jest.mock('../docs-panel/docs-panel', () => ({
  CombinedLearningJourneyPanel: class {
    state = { tabs: [mockTab], activeTabId: mockTab.id };
    useState() {
      return this.state;
    }
    getActiveTab() {
      return mockTab;
    }
    canNavigateNext() {
      return false;
    }
  },
}));

jest.mock('../../constants', () => ({
  ...jest.requireActual('../../constants'),
  getConfigWithDefaults: () => ({}),
}));

jest.mock('../docs-panel/hooks', () => ({
  useContentReset: () => jest.fn(),
  useAutoOpenListener: jest.fn(),
  useAssistantPathfinderListener: jest.fn(),
}));
jest.mock('../docs-panel/keyboard-shortcuts.hook', () => ({ useKeyboardShortcuts: jest.fn() }));
jest.mock('../docs-panel/pendingGuideRouter', () => ({
  consumePendingGuideOnMount: jest.fn(),
  initializePanelTabsOnMount: () => Promise.resolve(true),
}));
jest.mock('../docs-panel/components', () => ({
  AlignmentPrompt: () => null,
  GuideVersionNotice: () => null,
  LearningJourneyMilestoneToolbar: () => null,
}));
jest.mock('../docs-panel/link-handler.hook', () => ({ useLinkClickHandler: jest.fn() }));
jest.mock('../../hooks', () => ({
  useGuideProgressState: () => ({ hasInteractiveProgress: false, progressKey: null }),
  useAutoLaunchTutorial: jest.fn(),
  useStepProgressFromEvents: () => undefined,
  usePublishSurfaceContentKey: jest.fn(),
}));
jest.mock('../../utils/experiments/interactive-learning-banner', () => ({
  enrollInteractiveLearningBannerExperiment: jest.fn(),
}));
jest.mock('../../global-state/panel-mode', () => ({
  panelModeManager: { getMode: () => 'fullscreen', getPriorPath: () => null, setModeTransient: jest.fn() },
}));
jest.mock('../../global-state/sidebar', () => ({ sidebarState: { setIsSidebarMounted: jest.fn() } }));
jest.mock('../../lib/analytics', () => ({ reportAppInteraction: jest.fn(), UserInteraction: {} }));
jest.mock('../../lib/telemetry/surface', () => ({ reportPathfinderSurface: jest.fn() }));
jest.mock('../../lib/storage/extension-sidebar', () => ({ isExtensionSidebarOwnedByOther: () => false }));

jest.mock('../../docs-retrieval', () => ({
  resolveActiveMilestoneSequence: () => undefined,
  isJourneyCoverPage: () => false,
}));
jest.mock('../content-renderer/content-renderer', () => ({ ContentRenderer: () => null }));
jest.mock('../InteractiveLearningBanner', () => ({ InteractiveLearningBanner: () => null }));
jest.mock('../guide-progress', () => ({ GuideProgressBar: () => null }));

jest.mock('../guide-language', () => ({
  GuideLanguageSlot: ({ guideUrl }: { guideUrl?: string }) => (
    <div data-testid="guide-language-slot" data-guide-url={guideUrl} />
  ),
  TranslationNoticeSlot: ({ guideUrl }: { guideUrl?: string }) => (
    <div data-testid="translation-notice-slot" data-guide-url={guideUrl} />
  ),
}));

import { FullScreenPanel } from './FullScreenPanel';

describe('FullScreenPanel guide language slots', () => {
  it('mounts both slots for the active guide', async () => {
    const Renderer = FullScreenPanel.Component as unknown as React.ComponentType<{ model: unknown }>;
    render(<Renderer model={{}} />);
    await act(async () => {});

    expect(screen.getByTestId('guide-language-slot')).toHaveAttribute('data-guide-url', mockTab.baseUrl);
    expect(screen.getByTestId('translation-notice-slot')).toHaveAttribute('data-guide-url', mockTab.baseUrl);
  });
});
