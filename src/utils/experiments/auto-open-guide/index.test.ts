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
  ONBOARDING_EXPLORING_EXPERIMENT_ID,
  ONBOARDING_EXPLORING_EXPERIMENT_FLAG,
  ONBOARDING_EXPLORING_EXPERIMENT_GROUP,
} from '../../../constants/auto-open-guide-experiment';
import {
  getOnboardingIntentContextKey,
  setOnboardingExploringIntent,
} from '../../../global-state/onboarding-exploring-intent';
import { sidebarState } from '../../../global-state/sidebar';
import { logger } from '../../../lib/logging';
import { attemptAutoOpen } from '../../sidebar-auto-open';
import { installAutoLaunchOnMount } from './auto-launch';
import { getActiveExperiments } from '../active-experiments';
import { startSavedIntentBridge } from './saved-intent-bridge';
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
  UserInteraction: {
    AutoOpenGuideEligible: 'auto_open_guide_eligible',
    OnboardingExploringEligible: 'onboarding_exploring_auto_open_eligible',
  },
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
  attemptAutoOpen: jest.fn((_delay: number, shouldOpen: () => boolean) => {
    shouldOpen();
    return jest.fn();
  }),
  getCurrentPath: () => window.location.pathname,
}));
jest.mock('./auto-launch', () => ({ installAutoLaunchOnMount: jest.fn(() => jest.fn()) }));
const mockStopIntentBridge = jest.fn();
jest.mock('./saved-intent-bridge', () => ({ startSavedIntentBridge: jest.fn(() => mockStopIntentBridge) }));
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
  { guide: 'bundled:test-explore', pages: ['/explore*'] },
  { guide: 'bundled:test-dashboards', pages: ['/dashboards'] },
];

let stop: (() => void) | undefined;

async function settle() {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
    jest.advanceTimersByTime(50);
  }
}

async function flag(value: unknown, key: string = AUTO_OPEN_GUIDE_EXPERIMENT_FLAG, legacy?: unknown) {
  await OpenFeature.setProviderAndWait(
    'auto-open-guide-test',
    new TypedInMemoryProvider({
      ...(legacy
        ? {
            [AUTO_OPEN_GUIDE_EXPERIMENT_FLAG]: {
              defaultVariant: 'configured',
              variants: { configured: legacy as never },
              disabled: false,
            },
          }
        : {}),
      [key]: {
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

it.each([AUTO_OPEN_GUIDE_EXPERIMENT_FLAG, ONBOARDING_EXPLORING_EXPERIMENT_FLAG])(
  'replaces a pending launch without letting its callback cancel the next offer for %s',
  async (experimentFlag) => {
    setOnboardingExploringIntent({ status: 'ready', exploring: true, contextKey: getOnboardingIntentContextKey() });
    window.history.replaceState(null, '', '/explore');
    await flag({ variant: 'treatment', experiences: EXPERIENCES }, experimentFlag);
    stop = await startAutoOpenGuideExperiment();
    await settle();
    const firstShouldOpen = (attemptAutoOpen as jest.Mock).mock.calls[0]![1] as () => boolean;
    const firstCancelOpen = (attemptAutoOpen as jest.Mock).mock.results[0]!.value as jest.Mock;
    const firstCancelLaunch = (installAutoLaunchOnMount as jest.Mock).mock.results[0]!.value as jest.Mock;

    await navigate('/dashboards');

    expect(attemptAutoOpen).toHaveBeenCalledTimes(2);
    expect(firstCancelOpen).toHaveBeenCalledTimes(1);
    expect(firstCancelLaunch).toHaveBeenCalledTimes(1);
    const secondCancelLaunch = (installAutoLaunchOnMount as jest.Mock).mock.results[1]!.value as jest.Mock;
    expect(firstShouldOpen()).toBe(false);
    expect(secondCancelLaunch).not.toHaveBeenCalled();
    const secondShouldOpen = (attemptAutoOpen as jest.Mock).mock.calls[1]![1] as () => boolean;
    expect(secondShouldOpen()).toBe(true);
  }
);

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
  setOnboardingExploringIntent(null);
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
  expect(sidebarState.setPendingOpenSource).toHaveBeenCalledWith('auto_open_guide_experiment', 'auto_open');
  expect(installAutoLaunchOnMount).toHaveBeenCalledWith(
    expect.objectContaining({ url: 'bundled:test-explore' }),
    expect.any(Function)
  );
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
  expect(installAutoLaunchOnMount).toHaveBeenCalledWith(
    expect.objectContaining({ url: 'bundled:test-dashboards' }),
    expect.any(Function)
  );
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

it('still pops treatment when the path moves within the offered pattern mid-activation', async () => {
  window.history.replaceState(null, '', '/explore');
  await flag({ variant: 'treatment', experiences: EXPERIENCES });
  stop = await startAutoOpenGuideExperiment();
  window.history.replaceState(null, '', '/explore/metrics');
  await settle();

  expect(attemptAutoOpen).toHaveBeenCalledTimes(1);
  expect(offers()[0]![1]).toEqual(expect.objectContaining({ opened: true }));
});

it('does not offer an overlapping experience on a reload of the same pages', async () => {
  const overlapping = [
    { guide: 'bundled:first', pages: ['/explore*'] },
    { guide: 'bundled:second', pages: ['/explore*'] },
  ];
  await start('/explore', { variant: 'control', experiences: overlapping });
  stop?.();
  jest.clearAllMocks();

  await start('/explore/metrics', { variant: 'control', experiences: overlapping });
  expect(offers()).toHaveLength(0);

  await navigate('/alerting');
  await navigate('/explore');
  expect(offers()).toHaveLength(1);
  expect(offers()[0]![1]).toEqual(expect.objectContaining({ experience_index: 1 }));
});

it('gives a reload its own attempt after an activation that offered nothing', async () => {
  mockSessionId = undefined;
  await start('/explore', { variant: 'treatment', experiences: EXPERIENCES });
  expect(attemptAutoOpen).not.toHaveBeenCalled();
  stop?.();

  mockSessionId = 'test-session';
  await start('/explore', { variant: 'treatment', experiences: EXPERIENCES });
  expect(attemptAutoOpen).toHaveBeenCalledTimes(1);
});

it('retries a visit whose activation was cut short by the tab going hidden', async () => {
  const visibility = jest.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  window.history.replaceState(null, '', '/explore');
  await flag({ variant: 'treatment', experiences: EXPERIENCES });
  stop = await startAutoOpenGuideExperiment();
  visibility.mockReturnValue('hidden');
  document.dispatchEvent(new Event('visibilitychange'));
  await settle();
  expect(attemptAutoOpen).not.toHaveBeenCalled();

  visibility.mockReturnValue('visible');
  document.dispatchEvent(new Event('visibilitychange'));
  await settle();
  expect(attemptAutoOpen).toHaveBeenCalledTimes(1);
  visibility.mockRestore();
});

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

  const edited = [{ guide: 'bundled:test-replacement', pages: ['/explore*'] }, ...EXPERIENCES];
  await start('/explore', { variant: 'treatment', experiences: edited });
  await settle();

  expect(installAutoLaunchOnMount).toHaveBeenCalledWith(
    expect.objectContaining({ url: 'bundled:test-replacement' }),
    expect.any(Function)
  );
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
  expect(localStorage.getItem('grafana-pathfinder-auto-open-guide-shown-localhost:bundled:test-explore')).toBeNull();
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

describe('saved exploring cohort', () => {
  const saved = (exploring = true, status: 'ready' | 'loading' | 'unavailable' = 'ready') =>
    setOnboardingExploringIntent({ status, exploring, contextKey: getOnboardingIntentContextKey() });
  async function startExploring(variant = 'treatment', legacy?: unknown, experiences = EXPERIENCES) {
    window.history.replaceState(null, '', '/dashboards');
    await flag({ variant, experiences }, ONBOARDING_EXPLORING_EXPERIMENT_FLAG, legacy);
    stop = await startAutoOpenGuideExperiment();
    await settle();
  }

  it('keeps treatment telemetry active when the open handler synchronously opens the panel', async () => {
    (attemptAutoOpen as jest.Mock).mockImplementationOnce((_delay: number, shouldOpen: () => boolean) => {
      if (shouldOpen()) {
        mockPathfinderOpen = true;
      }
      return jest.fn();
    });
    saved();
    await startExploring();
    expect(mockPathfinderOpen).toBe(true);
    expect(exposures()).toHaveLength(1);
    expect(reportAppInteraction).toHaveBeenCalledWith(
      UserInteraction.OnboardingExploringEligible,
      expect.objectContaining({ experiment_onboarding_exploring_auto_open: 'treatment', opened: true }),
      { mirrorToFaro: false }
    );
    expect(getAutoOpenGuideEnrollment()?.variant).toBe('treatment');
  });

  it.each(['control', 'treatment'])('does not activate %s before the auto-open trigger delay', async (variant) => {
    await startExploring(variant);
    saved();
    await Promise.resolve();
    jest.advanceTimersByTime(199);
    await Promise.resolve();
    expect(reportExperimentView).not.toHaveBeenCalled();
    expect(exposures()).toHaveLength(0);
    expect(attemptAutoOpen).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    await settle();
    expect(exposures()).toHaveLength(1);
    expect(reportExperimentView).toHaveBeenCalledWith(
      ONBOARDING_EXPLORING_EXPERIMENT_ID,
      ONBOARDING_EXPLORING_EXPERIMENT_GROUP,
      variant
    );
    if (variant === 'treatment') {
      expect(attemptAutoOpen).toHaveBeenCalledWith(0, expect.any(Function));
    } else {
      expect(attemptAutoOpen).not.toHaveBeenCalled();
    }
  });

  it.each(['control', 'treatment'])(
    'does not expose %s when eligibility is lost during the trigger delay',
    async (variant) => {
      await startExploring(variant);
      saved();
      jest.advanceTimersByTime(199);
      saved(false);
      await settle();
      expect(reportExperimentView).not.toHaveBeenCalled();
      expect(exposures()).toHaveLength(0);
      expect(attemptAutoOpen).not.toHaveBeenCalled();
    }
  );

  it.each(['control', 'treatment'])('waits for saved exploring intent before enrolling %s', async (variant) => {
    await startExploring(variant);
    expect(reportExperimentView).not.toHaveBeenCalled();
    expect(attemptAutoOpen).not.toHaveBeenCalled();
    saved();
    await settle();
    expect(reportExperimentView).toHaveBeenCalledWith(
      ONBOARDING_EXPLORING_EXPERIMENT_ID,
      ONBOARDING_EXPLORING_EXPERIMENT_GROUP,
      variant
    );
    expect(attemptAutoOpen).toHaveBeenCalledTimes(variant === 'treatment' ? 1 : 0);
    expect(getAutoOpenGuideEnrollment()?.flag).toBe(ONBOARDING_EXPLORING_EXPERIMENT_FLAG);
    expect(reportAppInteraction).toHaveBeenCalledWith(
      UserInteraction.OnboardingExploringEligible,
      expect.objectContaining({ experiment_onboarding_exploring_auto_open: variant, opened: variant === 'treatment' }),
      { mirrorToFaro: false }
    );
  });

  it.each(['/dashboards', '/dashboards?starred', '/profile', '/playlists'])(
    'offers on the requested landing page %s when configured and eligible',
    async (path) => {
      window.history.replaceState(null, '', path);
      await flag(
        {
          variant: 'treatment',
          experiences: [{ guide: 'bundled:test-landing', pages: ['/dashboards', '/profile', '/playlists'] }],
        },
        ONBOARDING_EXPLORING_EXPERIMENT_FLAG
      );
      stop = await startAutoOpenGuideExperiment();
      await settle();
      expect(reportExperimentView).not.toHaveBeenCalled();
      saved();
      await settle();
      expect(attemptAutoOpen).toHaveBeenCalledTimes(1);
      expect(installAutoLaunchOnMount).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'bundled:test-landing' }),
        expect.anything()
      );
    }
  );

  it.each(['loading', 'unavailable'] as const)('fails closed for %s even when exploring is true', async (status) => {
    saved(true, status);
    await startExploring();
    await navigate('/explore');
    expect(reportExperimentView).not.toHaveBeenCalled();
  });

  it.each(['control', 'treatment'])('preserves %s attribution after unavailable revalidation', async (variant) => {
    saved();
    await startExploring(variant);
    expect(exposures()).toHaveLength(1);
    saved(false, 'unavailable');
    await settle();
    expect(getAutoOpenGuideEnrollment()?.variant).toBe(variant);
    expect(getActiveExperiments()).toContainEqual({ flag: ONBOARDING_EXPLORING_EXPERIMENT_FLAG, variant });
    await navigate('/explore');
    expect(exposures()).toHaveLength(1);
    saved(false);
    await settle();
    expect(getAutoOpenGuideEnrollment()).toBeNull();
    expect(getActiveExperiments()).not.toContainEqual({ flag: ONBOARDING_EXPLORING_EXPERIMENT_FLAG, variant });
  });

  it('still clears attribution when the identity changes after an unavailable read', async () => {
    saved();
    await startExploring();
    saved(false, 'unavailable');
    const originalId = config.bootData.user.id;
    config.bootData.user.id = 999;
    try {
      await navigate('/explore');
      expect(getAutoOpenGuideEnrollment()).toBeNull();
    } finally {
      config.bootData.user.id = originalId;
    }
  });

  it('cancels an uncommitted launch on unavailable revalidation', async () => {
    await startExploring();
    saved();
    saved(false, 'unavailable');
    await settle();
    expect(exposures()).toHaveLength(0);
    expect(getAutoOpenGuideEnrollment()).toBeNull();
    expect(attemptAutoOpen).not.toHaveBeenCalled();
  });

  it('does not enroll other answers or a snapshot from another context', async () => {
    saved(false);
    await startExploring();
    setOnboardingExploringIntent({ status: 'ready', exploring: true, contextKey: 'other-user' });
    await settle();
    expect(reportExperimentView).not.toHaveBeenCalled();
  });

  it('does not replay a saved answer on an unrelated page', async () => {
    await startExploring();
    await navigate('/alerting');
    saved();
    await settle();
    expect(reportExperimentView).not.toHaveBeenCalled();
    await navigate('/dashboards');
    expect(attemptAutoOpen).toHaveBeenCalledTimes(1);
  });

  it('ignores a late saved answer after stop', async () => {
    await startExploring();
    stop?.();
    saved();
    await settle();
    expect(reportExperimentView).not.toHaveBeenCalled();
  });

  it('cancels activation if saved eligibility disappears', async () => {
    await startExploring();
    saved();
    saved(false);
    await settle();
    expect(reportExperimentView).not.toHaveBeenCalled();
    expect(attemptAutoOpen).not.toHaveBeenCalled();
    saved();
    await settle();
    expect(attemptAutoOpen).toHaveBeenCalledTimes(1);
  });

  it('cancels activation on navigation away from the eligible page', async () => {
    await startExploring();
    saved();
    await navigate('/alerting');
    expect(reportExperimentView).not.toHaveBeenCalled();
    expect(attemptAutoOpen).not.toHaveBeenCalled();
    await navigate('/dashboards');
    expect(attemptAutoOpen).toHaveBeenCalledTimes(1);
  });

  it('does not enroll or reopen a legacy offered guide', async () => {
    localStorage.setItem('grafana-pathfinder-auto-open-guide-shown-localhost:bundled:test-dashboards', 'true');
    saved();
    await startExploring();
    expect(reportExperimentView).not.toHaveBeenCalled();
    expect(getAutoOpenGuideEnrollment()).toBeNull();
  });

  it('does not reopen after reload or a bridge remount, but restores its own cohort', async () => {
    saved();
    await startExploring();
    saved(false, 'loading');
    saved();
    await settle();
    expect(attemptAutoOpen).toHaveBeenCalledTimes(1);
    stop?.();
    jest.clearAllMocks();
    setAutoOpenGuideEnrollment(null);
    await startExploring();
    expect(attemptAutoOpen).not.toHaveBeenCalled();
    expect(reportExperimentView).not.toHaveBeenCalled();
    expect(getAutoOpenGuideEnrollment()?.flag).toBe(ONBOARDING_EXPLORING_EXPERIMENT_FLAG);
  });

  it('runs the saved-intent reader only for this experiment, and stops it on teardown', async () => {
    await startExploring();
    expect(startSavedIntentBridge).toHaveBeenCalledTimes(1);
    const shouldRead = jest.mocked(startSavedIntentBridge).mock.calls[0]![0];
    expect(shouldRead('/dashboards')).toBe(true);
    expect(shouldRead('/profile')).toBe(false);
    stop?.();
    stop = undefined;
    expect(mockStopIntentBridge).toHaveBeenCalledTimes(1);
    jest.clearAllMocks();
    await start('/dashboards', { variant: 'treatment', experiences: EXPERIENCES });
    expect(startSavedIntentBridge).not.toHaveBeenCalled();
  });

  it('rejects simultaneous enrollment in old and new experiments', async () => {
    saved();
    await startExploring('treatment', { variant: 'control', experiences: EXPERIENCES });
    expect(reportExperimentView).not.toHaveBeenCalled();
    expect(attemptAutoOpen).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('[Pathfinder] Auto-open experiments overlap; neither will enroll');
  });
  it('preserves the consumed visit while a reloaded bridge is loading', async () => {
    const overlapping = [
      { guide: 'bundled:first', pages: ['/dashboards'] },
      { guide: 'bundled:second', pages: ['/dashboards'] },
    ];
    saved();
    await startExploring('treatment', undefined, overlapping);
    stop?.();
    setOnboardingExploringIntent(null);
    jest.clearAllMocks();
    setAutoOpenGuideEnrollment(null);
    await startExploring('treatment', undefined, overlapping);
    expect(reportExperimentView).not.toHaveBeenCalled();
    saved();
    await settle();
    expect(attemptAutoOpen).not.toHaveBeenCalled();
    expect(reportExperimentView).not.toHaveBeenCalled();
    expect(getAutoOpenGuideEnrollment()?.flag).toBe(ONBOARDING_EXPLORING_EXPERIMENT_FLAG);
  });

  it('keeps a committed launch through same-page navigation but cancels it when intent is lost', async () => {
    saved();
    await startExploring();
    const cancelOpen = (attemptAutoOpen as jest.Mock).mock.results[0]!.value as jest.Mock;
    const cancelLaunch = (installAutoLaunchOnMount as jest.Mock).mock.results[0]!.value as jest.Mock;
    await navigate('/dashboards?starred');
    saved();
    await settle();
    expect(cancelLaunch).not.toHaveBeenCalled();
    expect(cancelOpen).not.toHaveBeenCalled();
    expect(getAutoOpenGuideEnrollment()?.variant).toBe('treatment');
    saved(false);
    await settle();
    expect(cancelLaunch).toHaveBeenCalled();
    expect(getAutoOpenGuideEnrollment()).toBeNull();
  });

  it('rechecks navigation, ownership and identity before the delayed panel open', async () => {
    saved();
    await startExploring();
    const shouldOpen = (attemptAutoOpen as jest.Mock).mock.calls[0]![1] as () => boolean;
    expect(shouldOpen()).toBe(true);
    mockPathfinderOpen = true;
    expect(shouldOpen()).toBe(false);
    mockPathfinderOpen = false;
    await navigate('/alerting');
    expect(shouldOpen()).toBe(false);
    await navigate('/dashboards');
    config.bootData.user.id = 43;
    expect(shouldOpen()).toBe(false);
    config.bootData.user.id = 42;
    stop?.();
    expect(shouldOpen()).toBe(false);
  });
});
