import { act } from '@testing-library/react';
import { config, locationService } from '@grafana/runtime';
import { startSavedIntentBridge } from './saved-intent-bridge';
import {
  hasSavedExploringIntent,
  setOnboardingExploringIntent,
} from '../../../global-state/onboarding-exploring-intent';
import { readSavedSurveyIntent } from '../../../lib/onboarding-survey-intent';

jest.mock('../../../lib/onboarding-survey-intent', () => ({
  ...jest.requireActual('../../../lib/onboarding-survey-intent'),
  readSavedSurveyIntent: jest.fn(),
}));
jest.mock('@grafana/runtime', () => ({
  locationService: { getHistory: jest.fn() },
  config: { namespace: 'stacks-1', bootData: { user: { id: 1, orgId: 2, uid: 'one', isSignedIn: true } } },
}));
let navigate: (location: { pathname: string }) => void;
const unlisten = jest.fn();
const read = jest.mocked(readSavedSurveyIntent);
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  config.bootData.user.uid = 'one';
  config.bootData.user.isSignedIn = true;
  setOnboardingExploringIntent(null);
  read.mockResolvedValue({ status: 'ready', exploring: false });
  (locationService.getHistory as jest.Mock).mockReturnValue({
    location: { pathname: '/a/grafana-setupguide-app/onboarding-flow/survey' },
    listen: (listener: typeof navigate) => {
      navigate = listener;
      return unlisten;
    },
  });
});
const stops: Array<() => void> = [];
const start = (shouldRead: (pathname: string) => boolean = () => true) => {
  const stop = startSavedIntentBridge(shouldRead);
  stops.push(stop);
  return stop;
};
afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  jest.useRealTimers();
});
const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};
it('does not read when signed out', async () => {
  config.bootData.user.isSignedIn = false;
  start();
  await flush();
  expect(read).not.toHaveBeenCalled();
});
it('retries a delayed save and stops once eligible', async () => {
  read
    .mockResolvedValueOnce({ status: 'ready', exploring: false })
    .mockResolvedValue({ status: 'ready', exploring: true });
  start();
  await flush();
  expect(hasSavedExploringIntent()).toBe(false);
  await act(async () => {
    jest.advanceTimersByTime(500);
  });
  expect(hasSavedExploringIntent()).toBe(true);
  await act(async () => {
    jest.runAllTimers();
  });
  expect(read).toHaveBeenCalledTimes(2);
});
it('bounds each retry cycle but retries a late save after landing navigation', async () => {
  start();
  await flush();
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      jest.runAllTimers();
    });
  }
  expect(read).toHaveBeenCalledTimes(4);
  read.mockResolvedValue({ status: 'ready', exploring: true });
  await act(async () => {
    navigate({ pathname: '/dashboards' });
  });
  await act(async () => {
    jest.advanceTimersByTime(500);
  });
  expect(read).toHaveBeenCalledTimes(5);
  expect(hasSavedExploringIntent()).toBe(true);
});
it('cancels old navigation reads and ignores stale results', async () => {
  let resolve!: (value: { status: 'ready'; exploring: boolean }) => void;
  read.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    })
  );
  start();
  const signal = read.mock.calls[0]![0];
  await act(async () => {
    navigate({ pathname: '/a/grafana-setupguide-app/onboarding-flow/recommendations' });
  });
  expect(signal.aborted).toBe(true);
  await act(async () => {
    resolve({ status: 'ready', exploring: true });
  });
  expect(hasSavedExploringIntent()).toBe(false);
});
it('cleans up on unmount and ignores identity changes before completion', async () => {
  let resolve!: (value: { status: 'ready'; exploring: boolean }) => void;
  read.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    })
  );
  const stop = start();
  config.bootData.user.uid = 'two';
  await act(async () => {
    resolve({ status: 'ready', exploring: true });
  });
  expect(hasSavedExploringIntent()).toBe(false);
  stop();
  expect(unlisten).toHaveBeenCalled();
  expect(read.mock.calls[0]![0].aborted).toBe(true);
});
it('revalidates on visibility and does not retry failed reads', async () => {
  read.mockResolvedValue({ status: 'unavailable', exploring: false });
  start();
  await flush();
  await act(async () => {
    jest.runAllTimers();
  });
  expect(read).toHaveBeenCalledTimes(1);
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await act(async () => {
    jest.advanceTimersByTime(500);
  });
  expect(read).toHaveBeenCalledTimes(2);
});
it('ignores a late completion after unmount', async () => {
  let resolve!: (value: { status: 'ready'; exploring: boolean }) => void;
  read.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    })
  );
  const stop = start();
  stop();
  await act(async () => {
    resolve({ status: 'ready', exploring: true });
  });
  expect(hasSavedExploringIntent()).toBe(false);
  expect(read.mock.calls[0]![0].aborted).toBe(true);
});
it('coalesces navigation and visibility events before revalidating', async () => {
  (locationService.getHistory as jest.Mock).mockReturnValue({
    location: { pathname: '/dashboards' },
    listen: (listener: typeof navigate) => {
      navigate = listener;
      return unlisten;
    },
  });
  read.mockResolvedValue({ status: 'ready', exploring: true });
  start();
  await flush();
  await act(async () => {
    navigate({ pathname: '/explore' });
  });
  for (let i = 0; i < 20; i++) {
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
  }
  expect(read).toHaveBeenCalledTimes(1);
  await act(async () => {
    jest.advanceTimersByTime(500);
  });
  expect(read).toHaveBeenCalledTimes(2);
});
it('keeps a saved answer eligible while navigation and visibility revalidate it', async () => {
  read.mockResolvedValue({ status: 'ready', exploring: true });
  start();
  await flush();
  expect(hasSavedExploringIntent()).toBe(true);
  let resolve!: (value: { status: 'ready'; exploring: boolean }) => void;
  read.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    })
  );
  await act(async () => {
    navigate({ pathname: '/dashboards' });
  });
  expect(hasSavedExploringIntent()).toBe(true);
  await act(async () => {
    jest.advanceTimersByTime(500);
  });
  expect(read).toHaveBeenCalledTimes(2);
  expect(hasSavedExploringIntent()).toBe(true);
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(hasSavedExploringIntent()).toBe(true);
  await act(async () => {
    resolve({ status: 'ready', exploring: true });
  });
  read.mockResolvedValue({ status: 'ready', exploring: false });
  await act(async () => {
    jest.advanceTimersByTime(500);
  });
  expect(hasSavedExploringIntent()).toBe(false);
});
it('clears the saved answer when the identity changes', async () => {
  read.mockResolvedValue({ status: 'ready', exploring: true });
  start();
  await flush();
  expect(hasSavedExploringIntent()).toBe(true);
  config.bootData.user.uid = 'two';
  await act(async () => {
    navigate({ pathname: '/dashboards' });
  });
  config.bootData.user.uid = 'one';
  expect(hasSavedExploringIntent()).toBe(false);
});
it('falls back to popstate when Grafana history is unavailable', async () => {
  (locationService.getHistory as jest.Mock).mockImplementation(() => {
    throw new Error('no history');
  });
  window.history.replaceState(null, '', '/dashboards');
  const stop = start();
  await flush();
  expect(read).toHaveBeenCalledTimes(1);
  window.history.replaceState(null, '', '/explore');
  await act(async () => {
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await act(async () => {
    jest.advanceTimersByTime(500);
  });
  expect(read).toHaveBeenCalledTimes(2);
  stop();
  window.history.replaceState(null, '', '/profile');
  window.dispatchEvent(new PopStateEvent('popstate'));
  jest.advanceTimersByTime(5000);
  expect(read).toHaveBeenCalledTimes(2);
  window.history.replaceState(null, '', '/');
});

it('reads only on configured pages and cancels retries when leaving them', async () => {
  start((path) => path === '/dashboards');
  await flush();
  expect(read).not.toHaveBeenCalled();
  navigate({ pathname: '/profile' });
  document.dispatchEvent(new Event('visibilitychange'));
  await act(async () => {
    jest.runAllTimers();
  });
  expect(read).not.toHaveBeenCalled();
  navigate({ pathname: '/dashboards' });
  await act(async () => {
    jest.advanceTimersByTime(500);
  });
  expect(read).toHaveBeenCalledTimes(1);
  navigate({ pathname: '/profile' });
  await act(async () => {
    jest.runAllTimers();
  });
  expect(read).toHaveBeenCalledTimes(1);
  read.mockResolvedValue({ status: 'ready', exploring: true });
  navigate({ pathname: '/dashboards' });
  await act(async () => {
    jest.advanceTimersByTime(500);
  });
  expect(read).toHaveBeenCalledTimes(2);
  expect(hasSavedExploringIntent()).toBe(true);
});
