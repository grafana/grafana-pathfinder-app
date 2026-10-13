import { randomUUID } from 'crypto';
import { serialize, deserialize } from 'v8';
import { TypedInMemoryProvider, OpenFeature } from '@openfeature/web-sdk';
import { config, reportExperimentView } from '@grafana/runtime';

import { reportAppInteraction, UserInteraction } from '../../../lib/analytics';
import {
  AUTO_OPEN_GUIDE_ELIGIBLE_EVENT,
  AUTO_OPEN_GUIDE_EXPERIMENT_FLAG,
  AUTO_OPEN_GUIDE_EXPERIMENT_GROUP,
  AUTO_OPEN_GUIDE_EXPERIMENT_ID,
} from '../../../constants/auto-open-guide-experiment';
import { sidebarState } from '../../../global-state/sidebar';
import { logger } from '../../../lib/logging';
import { attemptAutoOpen } from '../../sidebar-auto-open';
import { installAutoLaunchOnMount } from './auto-launch';
import { getAutoOpenGuideEnrollment, setAutoOpenGuideEnrollment } from './state';
import { startAutoOpenGuideExperiment } from './index';

const mockPushEvent = jest.fn();
let mockSessionId: string | undefined = 'test-session';
const mockGetFeatureFlagClient = jest.fn();
const mockFaro = {
  api: {
    getSession: () => (mockSessionId ? { id: mockSessionId } : undefined),
    pushEvent: mockPushEvent,
    getActiveUserAction: () => undefined,
  },
  metas: { addListener: jest.fn(), removeListener: jest.fn() },
};
let mockPathfinderOpen = false;
const mockHistoryListeners = new Set<() => void>();

jest.mock('../../../lib/telemetry/faro-adapter', () => ({ getPathfinderFaro: () => mockFaro }));
jest.mock('../../../lib/telemetry/surface', () => ({ isPathfinderOpen: () => mockPathfinderOpen }));
jest.mock('../../../lib/analytics', () => ({
  reportAppInteraction: jest.fn(),
  UserInteraction: { AutoOpenGuideEligible: 'auto_open_guide_eligible' },
}));
jest.mock('../../openfeature-tracking', () => ({ TrackingHook: jest.fn() }));
jest.mock('../../../lib/logging', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn(), exception: jest.fn() },
}));
jest.mock('../../openfeature', () => ({
  ...jest.requireActual('../../openfeature'),
  getFeatureFlagClient: () => mockGetFeatureFlagClient(),
}));
jest.mock('../../find-doc-page', () => ({
  findDocPage: (guide: string) =>
    guide.startsWith('bundled:') ? { url: guide, title: guide, type: 'docs-page' } : null,
}));
jest.mock('../../sidebar-auto-open', () => ({
  attemptAutoOpen: jest.fn(),
  getCurrentPath: () => window.location.pathname,
}));
jest.mock('./auto-launch', () => ({ installAutoLaunchOnMount: jest.fn() }));
jest.mock('../../../global-state/sidebar', () => ({
  sidebarState: { setPendingOpenSource: jest.fn(), getIsSidebarMounted: jest.fn(() => false) },
}));
jest.mock('@grafana/runtime', () => ({
  config: { namespace: 'stacks-123', bootData: { user: { id: 42, isSignedIn: true } }, analytics: { enabled: true } },
  reportExperimentView: jest.fn(),
  locationService: {
    getHistory: () => ({
      listen: (listener: () => void) => {
        mockHistoryListeners.add(listener);
        return () => mockHistoryListeners.delete(listener);
      },
    }),
  },
}));

const EXPERIENCES = [
  { guide: 'bundled:explore-guide', pages: ['/explore*'] },
  { guide: 'bundled:dashboards-guide', pages: ['/dashboards'] },
];

let stop: (() => void) | undefined;

async function settle() {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
    jest.advanceTimersByTime(20);
  }
}

async function flag(value: unknown) {
  await OpenFeature.setProviderAndWait(
    'auto-open-guide-test',
    new TypedInMemoryProvider({
      [AUTO_OPEN_GUIDE_EXPERIMENT_FLAG]: {
        defaultVariant: 'configured',
        variants: { configured: value as never },
        disabled: false,
      },
    })
  );
}

async function start(path: string, value: unknown) {
  window.history.replaceState(null, '', path);
  await flag(value);
  stop = await startAutoOpenGuideExperiment();
  await settle();
}

async function navigate(path: string) {
  window.history.replaceState(null, '', path);
  mockHistoryListeners.forEach((listener) => listener());
  await settle();
}

const exposures = () => mockPushEvent.mock.calls.filter(([name]) => name === 'experiment_viewed');

beforeEach(() => {
  Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: randomUUID });
  globalThis.structuredClone = (value) => deserialize(serialize(value));
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockGetFeatureFlagClient.mockImplementation(() => OpenFeature.getClient('auto-open-guide-test'));
  mockSessionId = 'test-session';
  sessionStorage.clear();
  localStorage.clear();
  mockPathfinderOpen = false;
  config.analytics.enabled = true;
  config.bootData.user.isSignedIn = true;
  setAutoOpenGuideEnrollment(null);
});

afterEach(async () => {
  stop?.();
  stop = undefined;
  mockHistoryListeners.clear();
  window.history.replaceState(null, '', '/');
  await OpenFeature.clearProviders();
  jest.useRealTimers();
});

it('opens the matched guide for treatment with one exposure and an attributed outcome', async () => {
  await start('/explore/metrics', { variant: 'treatment', experiences: EXPERIENCES });

  expect(reportExperimentView).toHaveBeenCalledWith(
    AUTO_OPEN_GUIDE_EXPERIMENT_ID,
    AUTO_OPEN_GUIDE_EXPERIMENT_GROUP,
    'treatment'
  );
  expect(sidebarState.setPendingOpenSource).toHaveBeenCalledWith('auto_open_guide_experiment', 'auto-open');
  expect(installAutoLaunchOnMount).toHaveBeenCalledWith(expect.objectContaining({ url: 'bundled:explore-guide' }));
  expect(attemptAutoOpen).toHaveBeenCalledTimes(1);
  expect(getAutoOpenGuideEnrollment()?.variant).toBe('treatment');
  expect(reportAppInteraction).toHaveBeenCalledWith(
    UserInteraction.AutoOpenGuideEligible,
    expect.objectContaining({
      experiment_auto_open_guide: 'treatment',
      exposure_id: exposures()[0]![1].exposure_id,
      event_id: expect.any(String),
      experience_index: 0,
      opened: true,
    }),
    { mirrorToFaro: false }
  );
  expect(exposures()).toHaveLength(1);
  expect(mockPushEvent.mock.calls.filter(([name]) => name === AUTO_OPEN_GUIDE_ELIGIBLE_EVENT)).toHaveLength(1);
});

it('counts control at the same moment without opening anything', async () => {
  await start('/explore', { variant: 'control', experiences: EXPERIENCES });

  expect(reportExperimentView).toHaveBeenCalledWith(
    AUTO_OPEN_GUIDE_EXPERIMENT_ID,
    AUTO_OPEN_GUIDE_EXPERIMENT_GROUP,
    'control'
  );
  expect(attemptAutoOpen).not.toHaveBeenCalled();
  expect(installAutoLaunchOnMount).not.toHaveBeenCalled();
  expect(getAutoOpenGuideEnrollment()?.variant).toBe('control');
  expect(reportAppInteraction).toHaveBeenCalledWith(
    UserInteraction.AutoOpenGuideEligible,
    expect.objectContaining({ experiment_auto_open_guide: 'control', experience_index: 0, opened: false }),
    { mirrorToFaro: false }
  );
});

it('does not enroll anyone off the configured pages', async () => {
  await start('/alerting', { variant: 'treatment', experiences: EXPERIENCES });

  expect(reportExperimentView).not.toHaveBeenCalled();
  expect(attemptAutoOpen).not.toHaveBeenCalled();
  expect(getAutoOpenGuideEnrollment()).toBeNull();
});

it('enrolls on a later navigation into a configured page', async () => {
  await start('/alerting', { variant: 'treatment', experiences: EXPERIENCES });
  await navigate('/dashboards');

  expect(reportExperimentView).toHaveBeenCalledTimes(1);
  expect(installAutoLaunchOnMount).toHaveBeenCalledWith(expect.objectContaining({ url: 'bundled:dashboards-guide' }));
  expect(reportAppInteraction).toHaveBeenCalledWith(
    UserInteraction.AutoOpenGuideEligible,
    expect.objectContaining({ experience_index: 1, opened: true }),
    { mirrorToFaro: false }
  );
});

it('offers each guide once per browser, and the next guide on its own page', async () => {
  await start('/explore', { variant: 'treatment', experiences: EXPERIENCES });
  await navigate('/alerting');
  await navigate('/explore');
  expect(attemptAutoOpen).toHaveBeenCalledTimes(1);

  await navigate('/dashboards');
  expect(attemptAutoOpen).toHaveBeenCalledTimes(2);
  expect(exposures()).toHaveLength(1);

  stop?.();
  jest.clearAllMocks();
  sessionStorage.clear();
  await start('/explore', { variant: 'treatment', experiences: EXPERIENCES });
  expect(attemptAutoOpen).not.toHaveBeenCalled();
});

const offers = () =>
  (reportAppInteraction as jest.Mock).mock.calls.filter(([name]) => name === UserInteraction.AutoOpenGuideEligible);

it('makes one offer per page visit when several experiences match it', async () => {
  const overlapping = [
    { guide: 'bundled:first', pages: ['/explore*'] },
    { guide: 'bundled:second', pages: ['/explore*'] },
  ];
  await start('/explore', { variant: 'control', experiences: overlapping });
  await navigate('/explore');

  expect(offers()).toHaveLength(1);
  expect(getAutoOpenGuideEnrollment()?.offeredGuide).toBe('bundled:first');

  await navigate('/alerting');
  await navigate('/explore');
  expect(offers()).toHaveLength(2);
  expect(offers()[1]![1]).toEqual(expect.objectContaining({ experience_index: 1 }));
  expect(getAutoOpenGuideEnrollment()?.offeredGuide).toBe('bundled:second');
});

it.each(['control', 'treatment'])(
  'treats sub-paths of one pattern as the same visit in the %s arm',
  async (variant) => {
    const overlapping = [
      { guide: 'bundled:first', pages: ['/explore*'] },
      { guide: 'bundled:second', pages: ['/explore*'] },
    ];
    await start('/explore', { variant, experiences: overlapping });
    await navigate('/explore/metrics');
    await navigate('/explore/logs');

    expect(offers()).toHaveLength(1);
    expect(localStorage.getItem(`grafana-pathfinder-auto-open-guide-shown-localhost:bundled:second`)).toBeNull();
  }
);

it('restores the arm at boot for an already-offered browser without a new exposure', async () => {
  await start('/explore', { variant: 'treatment', experiences: EXPERIENCES });
  stop?.();
  jest.clearAllMocks();
  sessionStorage.clear();
  setAutoOpenGuideEnrollment(null);

  await start('/alerting', { variant: 'treatment', experiences: EXPERIENCES });

  expect(getAutoOpenGuideEnrollment()?.variant).toBe('treatment');
  expect(reportExperimentView).not.toHaveBeenCalled();
  expect(mockPushEvent).not.toHaveBeenCalled();
  expect(attemptAutoOpen).not.toHaveBeenCalled();
});

it('opens the live guide, and stays bounded, when the session cached an older payload', async () => {
  await start('/alerting', { variant: 'treatment', experiences: EXPERIENCES });
  await navigate('/dashboards');
  stop?.();
  jest.clearAllMocks();

  const edited = [{ guide: 'bundled:new-explore-guide', pages: ['/explore*'] }, ...EXPERIENCES];
  await start('/explore', { variant: 'treatment', experiences: edited });
  await settle();

  expect(installAutoLaunchOnMount).toHaveBeenCalledWith(expect.objectContaining({ url: 'bundled:new-explore-guide' }));
  expect(offers()).toHaveLength(1);
  expect(mockGetFeatureFlagClient.mock.calls.length).toBeLessThan(5);
});

it('makes one bounded attempt per visit and warns once when the SDK is unavailable', async () => {
  mockSessionId = undefined;
  await start('/explore', { variant: 'treatment', experiences: EXPERIENCES });
  await navigate('/explore/metrics');
  await settle();

  expect(reportExperimentView).not.toHaveBeenCalled();
  expect(attemptAutoOpen).not.toHaveBeenCalled();
  expect(localStorage.getItem('grafana-pathfinder-auto-open-guide-shown-localhost:bundled:explore-guide')).toBeNull();
  expect(mockGetFeatureFlagClient.mock.calls.length).toBeLessThan(5);
  expect(logger.warn).toHaveBeenCalledTimes(1);
  expect(logger.warn).toHaveBeenCalledWith('[Pathfinder] Auto-open guide experiment unavailable', {
    reason: 'no-session',
  });
});

it('ignores an activation that resolves after stop()', async () => {
  window.history.replaceState(null, '', '/explore');
  await flag({ variant: 'treatment', experiences: EXPERIENCES });
  const pendingStop = await startAutoOpenGuideExperiment();
  pendingStop();
  await settle();

  expect(attemptAutoOpen).not.toHaveBeenCalled();
  expect(getAutoOpenGuideEnrollment()).toBeNull();
});

it('warns once per page load for a rejected payload', async () => {
  await start('/explore', { variant: 'treatment', experiences: [] });
  await navigate('/alerting');

  expect(logger.warn).toHaveBeenCalledWith(
    expect.stringContaining("Rejected the remote payload for 'pathfinder.auto-open-guide-experiment'"),
    { reason: 'invalid_shape' }
  );
});

it.each([
  ['excluded', { variant: 'excluded' }],
  ['an unknown variant', { variant: 'holdback', experiences: EXPERIENCES }],
  ['too many experiences', { variant: 'treatment', experiences: [...EXPERIENCES, ...EXPERIENCES] }],
  ['an unresolvable guide', { variant: 'treatment', experiences: [{ guide: 'https://evil.example', pages: ['/'] }] }],
  ['null', null],
])('does nothing for %s', async (_, value) => {
  await start('/explore', value);

  expect(reportExperimentView).not.toHaveBeenCalled();
  expect(attemptAutoOpen).not.toHaveBeenCalled();
  expect(mockPushEvent).not.toHaveBeenCalled();
});

it('does nothing when the flag is missing', async () => {
  window.history.replaceState(null, '', '/explore');
  await OpenFeature.setProviderAndWait('auto-open-guide-test', new TypedInMemoryProvider({}));
  stop = await startAutoOpenGuideExperiment();
  await settle();

  expect(reportExperimentView).not.toHaveBeenCalled();
});

describe('blocked eligibility', () => {
  it('skips while Pathfinder is already open', async () => {
    mockPathfinderOpen = true;
    await start('/explore', { variant: 'treatment', experiences: EXPERIENCES });
    expect(reportExperimentView).not.toHaveBeenCalled();
  });

  it('skips while the extension sidebar is docked by any plugin', async () => {
    localStorage.setItem(
      'grafana.navigation.extensionSidebarDocked',
      JSON.stringify({ pluginId: 'grafana-assistant' })
    );
    await start('/explore', { variant: 'treatment', experiences: EXPERIENCES });
    expect(reportExperimentView).not.toHaveBeenCalled();
  });

  it.each(['?doc=bundled:other', '?controller=1', '?pathfinderKiosk=1'])('skips under %s', async (search) => {
    await start(`/explore${search}`, { variant: 'treatment', experiences: EXPERIENCES });
    expect(reportExperimentView).not.toHaveBeenCalled();
  });

  it('waits for a hidden tab to become visible', async () => {
    const visibility = jest.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await start('/explore', { variant: 'treatment', experiences: EXPERIENCES });
    expect(reportExperimentView).not.toHaveBeenCalled();

    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(reportExperimentView).toHaveBeenCalledTimes(1);
    visibility.mockRestore();
  });

  it('never starts with analytics disabled', async () => {
    config.analytics.enabled = false;
    await start('/explore', { variant: 'treatment', experiences: EXPERIENCES });
    expect(reportExperimentView).not.toHaveBeenCalled();
  });

  it('never starts for an anonymous user', async () => {
    config.bootData.user.isSignedIn = false;
    await start('/explore', { variant: 'treatment', experiences: EXPERIENCES });
    expect(reportExperimentView).not.toHaveBeenCalled();
  });
});
