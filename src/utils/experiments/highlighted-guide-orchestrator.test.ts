/**
 * Tests for highlighted-guide-orchestrator
 *
 * - initializeHighlightedGuideExperiment: flag read + resetCache state machine
 * - setupHighlightedGuideAutoOpen: guard order, sidebar auto-open, nav-listener arming
 */

jest.mock('../../plugin.json', () => ({
  id: 'grafana-pathfinder-app',
}));

const mockGetLocation = jest.fn().mockReturnValue({ pathname: '/dashboards' });
const mockHistoryListen = jest.fn();

jest.mock('@grafana/runtime', () => ({
  locationService: {
    getLocation: () => mockGetLocation(),
    getHistory: () => ({ listen: mockHistoryListen }),
  },
}));

jest.mock('../../lib/storage-keys', () => ({
  StorageKeys: {
    HIGHLIGHTED_GUIDE_AUTO_OPEN_PREFIX: 'grafana-pathfinder-highlighted-guide-auto-open-',
    HIGHLIGHTED_GUIDE_RESET_PROCESSED_PREFIX: 'grafana-pathfinder-highlighted-guide-reset-processed-',
  },
}));

const mockSetPendingOpenSource = jest.fn();
jest.mock('../../global-state/sidebar', () => ({
  sidebarState: {
    setPendingOpenSource: (source: string, action: string) => mockSetPendingOpenSource(source, action),
  },
}));

const mockAttemptAutoOpen = jest.fn();
jest.mock('./experiment-orchestrator', () => ({
  attemptAutoOpen: () => mockAttemptAutoOpen(),
}));

const mockGetHighlightedGuideConfig = jest.fn();
jest.mock('../openfeature', () => ({
  getHighlightedGuideConfig: () => mockGetHighlightedGuideConfig(),
  matchPathPattern: (pattern: string, path: string) => {
    if (pattern.endsWith('*')) {
      return path.startsWith(pattern.slice(0, -1));
    }
    return path === pattern || path === pattern + '/';
  },
}));

const mockIsExtensionSidebarOwnedByOther = jest.fn().mockReturnValue(false);
jest.mock('./experiment-utils', () => ({
  isExtensionSidebarOwnedByOther: (id: string) => mockIsExtensionSidebarOwnedByOther(id),
}));

import { initializeHighlightedGuideExperiment, setupHighlightedGuideAutoOpen } from './highlighted-guide-orchestrator';

const HOSTNAME = 'stack-a.grafana.net';

const baseConfig = {
  variant: 'treatment' as const,
  pages: ['/connections/datasources*'],
  guideId: 'bundled:onboarding',
  autoOpen: true,
  resetCache: false,
};

describe('initializeHighlightedGuideExperiment', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
    mockIsExtensionSidebarOwnedByOther.mockReturnValue(false);
  });

  it('returns the config from the flag and does not touch storage when resetCache is false', () => {
    mockGetHighlightedGuideConfig.mockReturnValue({ ...baseConfig, resetCache: false });
    const result = initializeHighlightedGuideExperiment(HOSTNAME);
    expect(result.variant).toBe('treatment');
    expect(localStorage.getItem(`grafana-pathfinder-highlighted-guide-reset-processed-${HOSTNAME}`)).toBeNull();
  });

  it('clears existing markers and sets sentinel to true on a false→true resetCache transition', () => {
    localStorage.setItem(`grafana-pathfinder-highlighted-guide-auto-open-${HOSTNAME}:bundled:onboarding`, 'true');
    mockGetHighlightedGuideConfig.mockReturnValue({ ...baseConfig, resetCache: true });

    initializeHighlightedGuideExperiment(HOSTNAME);

    expect(
      localStorage.getItem(`grafana-pathfinder-highlighted-guide-auto-open-${HOSTNAME}:bundled:onboarding`)
    ).toBeNull();
    expect(localStorage.getItem(`grafana-pathfinder-highlighted-guide-reset-processed-${HOSTNAME}`)).toBe('true');
  });

  it('does not re-clear markers when resetCache stays true across reloads (sentinel already set)', () => {
    localStorage.setItem(`grafana-pathfinder-highlighted-guide-reset-processed-${HOSTNAME}`, 'true');
    localStorage.setItem(`grafana-pathfinder-highlighted-guide-auto-open-${HOSTNAME}:bundled:onboarding`, 'true');
    mockGetHighlightedGuideConfig.mockReturnValue({ ...baseConfig, resetCache: true });

    initializeHighlightedGuideExperiment(HOSTNAME);

    expect(localStorage.getItem(`grafana-pathfinder-highlighted-guide-auto-open-${HOSTNAME}:bundled:onboarding`)).toBe(
      'true'
    );
  });

  it('rearms by flipping sentinel to false on a true→false resetCache transition', () => {
    localStorage.setItem(`grafana-pathfinder-highlighted-guide-reset-processed-${HOSTNAME}`, 'true');
    mockGetHighlightedGuideConfig.mockReturnValue({ ...baseConfig, resetCache: false });

    initializeHighlightedGuideExperiment(HOSTNAME);

    expect(localStorage.getItem(`grafana-pathfinder-highlighted-guide-reset-processed-${HOSTNAME}`)).toBe('false');
  });
});

describe('setupHighlightedGuideAutoOpen', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
    mockIsExtensionSidebarOwnedByOther.mockReturnValue(false);
  });

  it('short-circuits on variant = excluded', () => {
    setupHighlightedGuideAutoOpen({ ...baseConfig, variant: 'excluded' }, '/connections/datasources', HOSTNAME);
    expect(mockAttemptAutoOpen).not.toHaveBeenCalled();
    expect(mockHistoryListen).not.toHaveBeenCalled();
  });

  it('short-circuits on autoOpen = false', () => {
    setupHighlightedGuideAutoOpen({ ...baseConfig, autoOpen: false }, '/connections/datasources', HOSTNAME);
    expect(mockAttemptAutoOpen).not.toHaveBeenCalled();
    expect(mockHistoryListen).not.toHaveBeenCalled();
  });

  it('short-circuits on empty guideId (cannot mark, would loop)', () => {
    setupHighlightedGuideAutoOpen({ ...baseConfig, guideId: '' }, '/connections/datasources', HOSTNAME);
    expect(mockAttemptAutoOpen).not.toHaveBeenCalled();
  });

  it('auto-opens and marks when page matches and no marker exists', () => {
    setupHighlightedGuideAutoOpen(baseConfig, '/connections/datasources/new', HOSTNAME);
    expect(mockSetPendingOpenSource).toHaveBeenCalledWith('highlighted_guide_experiment', 'auto-open');
    expect(mockAttemptAutoOpen).toHaveBeenCalled();
    expect(localStorage.getItem(`grafana-pathfinder-highlighted-guide-auto-open-${HOSTNAME}:bundled:onboarding`)).toBe(
      'true'
    );
  });

  it('skips auto-open when marker is already set for the same guideId', () => {
    localStorage.setItem(`grafana-pathfinder-highlighted-guide-auto-open-${HOSTNAME}:bundled:onboarding`, 'true');
    setupHighlightedGuideAutoOpen(baseConfig, '/connections/datasources/new', HOSTNAME);
    expect(mockAttemptAutoOpen).not.toHaveBeenCalled();
  });

  it('does not auto-open on a non-matching path, but still installs a nav listener', () => {
    setupHighlightedGuideAutoOpen(baseConfig, '/dashboards', HOSTNAME);
    expect(mockAttemptAutoOpen).not.toHaveBeenCalled();
    expect(mockHistoryListen).toHaveBeenCalled();
  });

  it('arms the nav listener which then fires auto-open on first matching navigation', () => {
    setupHighlightedGuideAutoOpen(baseConfig, '/dashboards', HOSTNAME);
    const handler = mockHistoryListen.mock.calls[0]?.[0];
    expect(handler).toBeDefined();

    mockGetLocation.mockReturnValueOnce({ pathname: '/connections/datasources/new' });
    handler?.();

    expect(mockAttemptAutoOpen).toHaveBeenCalled();
  });

  it('does not steal the sidebar from another plugin', () => {
    mockIsExtensionSidebarOwnedByOther.mockReturnValue(true);
    setupHighlightedGuideAutoOpen(baseConfig, '/connections/datasources/new', HOSTNAME);
    expect(mockAttemptAutoOpen).not.toHaveBeenCalled();
  });
});
