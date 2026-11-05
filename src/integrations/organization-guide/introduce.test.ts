import { config, getAppEvents, locationService } from '@grafana/runtime';
import { startOrganizationGuideIntroduction } from './introduce';
import { resolveOrganizationGuide } from './resolve';
import { loadMyCompletions } from '../../completion-records/completion-read-client';
import { hasEmittedGuideCompletion, onCompletionRecorded } from '../../completion-records/completion-recorder';
import { fetchPathfinderSettingsSnapshot } from '../../utils/pathfinder-settings-api';
import { takeOrganizationGuideOffer, offerOrganizationGuide } from '../../global-state/organization-guide-offer';
import { suppressAutomaticLearningOffers } from '../../global-state/automatic-learning-offers';
import { sidebarState } from '../../global-state/sidebar';
import {
  organizationGuideBudgetKey,
  readOrganizationGuideBudget,
  writeOrganizationGuideBudget,
} from '../../lib/organization-guide-budget';
import { isExtensionSidebarInUse } from '../../lib/storage/extension-sidebar';
import { currentPlatform } from '../../lib/platform';

jest.mock('@grafana/runtime', () => ({
  config: {},
  getAppEvents: jest.fn(),
  locationService: { getLocation: jest.fn(), getHistory: jest.fn() },
}));
jest.mock('./resolve', () => ({ resolveOrganizationGuide: jest.fn() }));
jest.mock('../../completion-records/completion-read-client', () => ({ loadMyCompletions: jest.fn() }));
jest.mock('../../completion-records/completion-recorder', () => ({
  hasEmittedGuideCompletion: jest.fn(),
  onCompletionRecorded: jest.fn(() => jest.fn()),
}));
jest.mock('../../utils/pathfinder-settings-api', () => ({ fetchPathfinderSettingsSnapshot: jest.fn() }));
jest.mock('../../lib/platform', () => ({ currentPlatform: jest.fn(() => 'cloud') }));
jest.mock('../../global-state/sidebar', () => ({
  sidebarState: { getIsSidebarMounted: jest.fn(() => false), setPendingOpenSource: jest.fn() },
}));
jest.mock('../../global-state/panel-mode', () => ({ panelModeManager: { getMode: () => 'sidebar' } }));
jest.mock('../../global-state/kiosk', () => ({ kioskState: { getSnapshot: () => false } }));
jest.mock('../../lib/storage/extension-sidebar', () => ({
  isExtensionSidebarInUse: jest.fn(() => false),
  isExtensionSidebarOwnedByOther: () => false,
}));
jest.mock('../../utils/sidebar-auto-open', () => ({ getCurrentPath: () => locationService.getLocation().pathname }));

const key = organizationGuideBudgetKey('stack', '1', 'welcome');
const guide = {
  resourceName: 'welcome',
  guideId: 'content-id',
  title: 'Welcome',
  url: 'backend-guide:welcome',
  content: {},
};
const flush = async () => {
  for (let i = 0; i < 30; i++) {
    await Promise.resolve();
  }
};
let stop: () => void;
let path: string;
let navigate: () => void;
const publish = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  jest.setSystemTime(1_000_000);
  localStorage.clear();
  offerOrganizationGuide(null);
  path = '/dashboards';
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  Object.assign(config, { namespace: 'stack', bootData: { user: { id: 1, isSignedIn: true } } });
  jest.mocked(getAppEvents).mockReturnValue({ publish } as unknown as ReturnType<typeof getAppEvents>);
  jest
    .mocked(locationService.getLocation)
    .mockImplementation(() => ({ pathname: path }) as ReturnType<typeof locationService.getLocation>);
  jest.mocked(locationService.getHistory).mockReturnValue({
    listen: (listener: () => void) => {
      navigate = listener;
      return jest.fn();
    },
  } as unknown as ReturnType<typeof locationService.getHistory>);
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: { request: jest.fn((_key, _options, callback) => callback({})) },
  });
  jest
    .mocked(resolveOrganizationGuide)
    .mockResolvedValue(guide as Awaited<ReturnType<typeof resolveOrganizationGuide>>);
  jest
    .mocked(fetchPathfinderSettingsSnapshot)
    .mockResolvedValue({ config: { organizationGuideId: 'welcome' }, spec: {}, resourceVersion: '1' });
  jest
    .mocked(loadMyCompletions)
    .mockResolvedValue({ kind: 'ok', data: { capability: { available: true }, completions: [], inProgress: [] } });
  jest.mocked(hasEmittedGuideCompletion).mockReturnValue(false);
  jest.mocked(sidebarState.getIsSidebarMounted).mockReturnValue(false);
  jest.mocked(isExtensionSidebarInUse).mockReturnValue(false);
  jest.mocked(currentPlatform).mockReturnValue('cloud');
  stop = () => {};
});
afterEach(() => {
  stop();
  jest.useRealTimers();
});

it('counts only a successful visible render and only once', async () => {
  stop = startOrganizationGuideIntroduction();
  await flush();
  expect(publish).toHaveBeenCalledTimes(1);
  expect(readOrganizationGuideBudget(localStorage, key)?.count).toBe(0);
  const offer = takeOrganizationGuideOffer()!;
  expect(offer.canLaunch()).toBe(true);
  jest.mocked(sidebarState.getIsSidebarMounted).mockReturnValue(true);
  offer.rendered();
  offer.rendered();
  expect(readOrganizationGuideBudget(localStorage, key)).toEqual({
    count: 1,
    lastOpenedAt: Date.now(),
    completed: false,
  });
  expect(suppressAutomaticLearningOffers()).toBe(true);
  path = '/explore';
  navigate?.();
  await flush();
  expect(publish).toHaveBeenCalledTimes(1);
});

it('does not charge a failed render or replay a timed-out offer on manual open', async () => {
  stop = startOrganizationGuideIntroduction();
  await flush();
  jest.advanceTimersByTime(20_001);
  await flush();
  expect(takeOrganizationGuideOffer()).toBeNull();
  expect(readOrganizationGuideBudget(localStorage, key)?.count).toBe(0);
});

it.each(['unavailable', 'invalid'] as const)('treats %s completion reads as unknown', async (kind) => {
  jest.mocked(loadMyCompletions).mockResolvedValue({ kind });
  stop = startOrganizationGuideIntroduction();
  await flush();
  expect(publish).not.toHaveBeenCalled();
  expect(suppressAutomaticLearningOffers()).toBe(true);
});

it.each([
  { count: 3, lastOpenedAt: 0, completed: false },
  { count: 1, lastOpenedAt: 999_999, completed: false },
  { count: 0, lastOpenedAt: 0, completed: true },
])('suppresses exhausted, cooling-down, and completed local budgets', async (budget) => {
  writeOrganizationGuideBudget(localStorage, key, budget);
  stop = startOrganizationGuideIntroduction();
  await flush();
  expect(publish).not.toHaveBeenCalled();
  expect(suppressAutomaticLearningOffers()).toBe(true);
});

it('honors prior durable completion by source and content identity', async () => {
  jest.mocked(loadMyCompletions).mockResolvedValue({
    kind: 'ok',
    data: {
      capability: { available: true },
      inProgress: [],
      completions: [{ guideSource: 'app-platform', guideId: 'content-id', maxCompletionPercent: 100 } as never],
    },
  });
  stop = startOrganizationGuideIntroduction();
  await flush();
  expect(publish).not.toHaveBeenCalled();
});

it('stops a pending launch immediately on local completion', async () => {
  stop = startOrganizationGuideIntroduction();
  await flush();
  const offer = takeOrganizationGuideOffer()!;
  jest.mocked(onCompletionRecorded).mock.calls[0]![0]({ guideSource: 'app-platform', guideId: 'content-id' } as never);
  expect(offer.canLaunch()).toBe(false);
  expect(readOrganizationGuideBudget(localStorage, key)?.completed).toBe(true);
});

it('does not replace user intent while content is delayed', async () => {
  let finish!: (value: Awaited<ReturnType<typeof resolveOrganizationGuide>>) => void;
  jest.mocked(resolveOrganizationGuide).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  stop = startOrganizationGuideIntroduction();
  await flush();
  document.dispatchEvent(new Event('pointerdown'));
  finish(guide as Awaited<ReturnType<typeof resolveOrganizationGuide>>);
  await flush();
  expect(publish).not.toHaveBeenCalled();
});

it('waits until leaving the setup wizard, then attempts once', async () => {
  path = '/a/grafana-setupguide-app/onboarding-flow';
  stop = startOrganizationGuideIntroduction();
  await flush();
  expect(publish).not.toHaveBeenCalled();
  document.dispatchEvent(new Event('pointerdown'));
  path = '/dashboards';
  navigate();
  await flush();
  expect(publish).toHaveBeenCalledTimes(1);
});

it.each(['hidden', 'occupied', 'locked', 'no-locks', 'corrupt', 'unpublished', 'cleared', 'oss'])(
  'fails quietly for %s',
  async (condition) => {
    if (condition === 'hidden') {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    }
    if (condition === 'occupied') {
      jest.mocked(isExtensionSidebarInUse).mockReturnValue(true);
    }
    if (condition === 'locked') {
      jest
        .mocked(navigator.locks.request)
        .mockImplementation(((_key: string, _options: unknown, callback: (lock: null) => void) =>
          callback(null)) as never);
    }
    if (condition === 'no-locks') {
      Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true });
    }
    if (condition === 'corrupt') {
      localStorage.setItem(key, 'invalid');
    }
    if (condition === 'unpublished') {
      jest.mocked(resolveOrganizationGuide).mockResolvedValue(null);
    }
    if (condition === 'cleared') {
      jest
        .mocked(fetchPathfinderSettingsSnapshot)
        .mockResolvedValueOnce({ config: { organizationGuideId: 'welcome' }, spec: {}, resourceVersion: '1' })
        .mockResolvedValue({ config: { organizationGuideId: '' }, spec: {}, resourceVersion: '2' });
    }
    if (condition === 'oss') {
      jest.mocked(currentPlatform).mockReturnValue('oss');
    }
    stop = startOrganizationGuideIntroduction();
    await flush();
    expect(publish).not.toHaveBeenCalled();
  }
);
