import { reportAppInteraction, UserInteraction } from '../../../lib/analytics';
import { openGuideInSidebar, openPreparedGuide } from './open-prepared-guide';
import { panelModeManager } from '../../../global-state/panel-mode';
import { sidebarState } from '../../../global-state/sidebar';
import { guideLaunchStore } from '../../../global-state/guide-launch';
import { linkInterceptionState } from '../../../global-state/link-interception';
import { getPathfinderSurface } from '../../../lib/telemetry/surface';
import { isExtensionSidebarOwnedByOther } from '../../../lib/storage/extension-sidebar';
import { AUTO_OPEN_DOCS_EVENT } from '../../../lib/event-names';
import type { PreparedGuideLaunch } from './prepare-guide-launch';

jest.mock('../../../global-state/panel-mode', () => ({
  panelModeManager: {
    getMode: jest.fn(),
    setModeTransient: jest.fn(),
    setPendingGuide: jest.fn(),
    capturePriorPath: jest.fn(),
  },
}));
jest.mock('../../../global-state/sidebar', () => ({
  sidebarState: {
    getIsSidebarMounted: jest.fn(() => true),
    setIsSidebarMounted: jest.fn(),
    setPendingOpenSource: jest.fn(),
    openSidebar: jest.fn(),
  },
}));
jest.mock('../../../global-state/guide-launch', () => ({ guideLaunchStore: { stage: jest.fn(() => 'opaque-key') } }));
jest.mock('../../../global-state/link-interception', () => ({ linkInterceptionState: { addToQueue: jest.fn() } }));
jest.mock('../../../lib/telemetry/surface', () => ({ getPathfinderSurface: jest.fn() }));
jest.mock('../../../lib/storage/extension-sidebar', () => ({ isExtensionSidebarOwnedByOther: jest.fn() }));
jest.mock('../../../lib/analytics', () => ({
  reportAppInteraction: jest.fn(),
  UserInteraction: { GuideLaunchSurfaceChosen: 'surface-chosen' },
}));
jest.mock('@grafana/runtime', () => ({ locationService: { push: jest.fn() } }));

const launch = {
  url: 'bundled:welcome-to-grafana',
  title: 'Welcome',
  source: 'package_browser',
  requiresGrafanaUi: false,
  preparedContent: { content: '{}' },
  type: 'docs',
} as PreparedGuideLaunch;
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(isExtensionSidebarOwnedByOther).mockReturnValue(false);
});

it('reuses only the actual sidebar, even for reading-only content', () => {
  jest.mocked(panelModeManager.getMode).mockReturnValue('sidebar');
  jest.mocked(getPathfinderSurface).mockReturnValue('sidebar');
  const listener = jest.fn();
  document.addEventListener(AUTO_OPEN_DOCS_EVENT, listener);
  try {
    openGuideInSidebar(launch);
    expect(listener).toHaveBeenCalledTimes(1);
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({
      url: launch.url,
      title: launch.title,
      source: launch.source,
      launchKey: 'opaque-key',
    });
    expect(guideLaunchStore.stage).toHaveBeenCalledWith(
      expect.objectContaining({ preparedContent: launch.preparedContent, source: launch.source })
    );
    expect(sidebarState.openSidebar).not.toHaveBeenCalled();
  } finally {
    document.removeEventListener(AUTO_OPEN_DOCS_EVENT, listener);
  }
});

it.each(['floating', 'fullscreen'] as const)('moves %s into the sidebar without persisting a preference', (surface) => {
  jest.mocked(panelModeManager.getMode).mockReturnValue(surface);
  jest.mocked(getPathfinderSurface).mockReturnValue(surface);
  openGuideInSidebar(launch);
  expect(panelModeManager.setModeTransient).toHaveBeenCalledWith('sidebar');
  expect(sidebarState.setIsSidebarMounted).toHaveBeenCalledWith(false);
  expect(linkInterceptionState.addToQueue).toHaveBeenCalledWith(
    expect.objectContaining({ launchKey: 'opaque-key', url: launch.url })
  );
  expect(sidebarState.openSidebar).toHaveBeenCalledWith('Interactive learning');
});

it('switches the sidebar when another app owns the slot', () => {
  jest.mocked(panelModeManager.getMode).mockReturnValue('sidebar');
  jest.mocked(getPathfinderSurface).mockReturnValue('sidebar');
  jest.mocked(isExtensionSidebarOwnedByOther).mockReturnValue(true);
  openGuideInSidebar(launch);
  expect(sidebarState.openSidebar).toHaveBeenCalledWith('Interactive learning');
  expect(linkInterceptionState.addToQueue).toHaveBeenCalled();
});

it('reports the sidebar override and public attribution with Grafana UI requirements', () => {
  openGuideInSidebar({ ...launch, requiresGrafanaUi: true });
  expect(reportAppInteraction).toHaveBeenCalledWith(UserInteraction.GuideLaunchSurfaceChosen, {
    surface: 'sidebar',
    source: 'package_browser',
    requires_grafana_ui: true,
    content_url: launch.url,
  });
});

it.each(['backend-guide:secret', 'https://grafana.example/apis/guides/interactiveguides/secret'])(
  'omits private launch attribution for %s',
  (url) => {
    openGuideInSidebar({ ...launch, url, title: 'Private title' });
    expect(reportAppInteraction).toHaveBeenCalledWith(UserInteraction.GuideLaunchSurfaceChosen, {
      surface: 'sidebar',
      source: 'package_browser',
      requires_grafana_ui: false,
    });
  }
);

it('omits arbitrary and local authoring URLs even with a public-looking repository stamp', () => {
  openGuideInSidebar({
    ...launch,
    url: 'https://custom.example/private-name?secret=token',
    packageInfo: { repository: 'online-cdn' },
  });
  expect(reportAppInteraction).toHaveBeenCalledWith(UserInteraction.GuideLaunchSurfaceChosen, {
    surface: 'sidebar',
    source: 'package_browser',
    requires_grafana_ui: false,
  });
});

it('retains official attribution without URL credentials, query, or fragment', () => {
  openGuideInSidebar({
    ...launch,
    url: 'https://user:secret@interactive-learning.grafana.net/path/content.json?token=secret#private',
  });
  expect(reportAppInteraction).toHaveBeenCalledWith(UserInteraction.GuideLaunchSurfaceChosen, {
    surface: 'sidebar',
    source: 'package_browser',
    requires_grafana_ui: false,
    content_url: 'https://interactive-learning.grafana.net/path/content.json',
  });
});

describe.each(['sidebar', 'floating', 'fullscreen'] as const)('automatic %s launch analytics', (surface) => {
  const open = (overrides: Partial<PreparedGuideLaunch> = {}) => {
    jest.mocked(panelModeManager.getMode).mockReturnValue(surface);
    openPreparedGuide({ ...launch, requiresGrafanaUi: surface !== 'fullscreen', ...overrides });
  };

  it('retains public catalog attribution and the selected surface', () => {
    open();
    expect(reportAppInteraction).toHaveBeenCalledWith(UserInteraction.GuideLaunchSurfaceChosen, {
      surface,
      source: 'package_browser',
      requires_grafana_ui: surface !== 'fullscreen',
      content_url: launch.url,
    });
    expect(panelModeManager.setModeTransient).toHaveBeenCalledWith(surface);
  });

  it.each(['backend-guide:secret', 'https://custom.example/private-name?secret=token'])(
    'omits private attribution for %s',
    (url) => {
      open({ url, title: 'Private title', source: 'home_page' });
      expect(reportAppInteraction).toHaveBeenCalledWith(UserInteraction.GuideLaunchSurfaceChosen, {
        surface,
        source: 'home_page',
        requires_grafana_ui: surface !== 'fullscreen',
      });
    }
  );

  it('omits App Platform identity even with an official-looking URL', () => {
    open({ packageInfo: { repository: 'app-platform' } });
    expect(reportAppInteraction).toHaveBeenCalledWith(UserInteraction.GuideLaunchSurfaceChosen, {
      surface,
      source: 'package_browser',
      requires_grafana_ui: surface !== 'fullscreen',
    });
  });

  it('removes credentials, query and fragment from official URLs', () => {
    open({ url: 'https://user:secret@interactive-learning.grafana.net/path/content.json?token=secret#private' });
    expect(reportAppInteraction).toHaveBeenCalledWith(UserInteraction.GuideLaunchSurfaceChosen, {
      surface,
      source: 'package_browser',
      requires_grafana_ui: surface !== 'fullscreen',
      content_url: 'https://interactive-learning.grafana.net/path/content.json',
    });
  });
});
