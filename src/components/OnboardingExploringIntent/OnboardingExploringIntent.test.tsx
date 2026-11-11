import React from 'react';
import { act, render } from '@testing-library/react';
import { config, locationService } from '@grafana/runtime';
import OnboardingExploringIntent from './OnboardingExploringIntent';
import { hasSavedExploringIntent, setOnboardingExploringIntent } from '../../global-state/onboarding-exploring-intent';
import { readSavedSurveyIntent } from '../../lib/onboarding-survey-intent';

const mockFlag = jest.fn();
jest.mock('../../utils/openfeature', () => ({ getFeatureFlagClient: () => ({ getObjectValue: mockFlag }) }));
jest.mock('../../utils/experiments/auto-open-guide/config', () => ({
  isAutoOpenGuideConfig: (value: { variant: string }) => ['excluded', 'control', 'treatment'].includes(value.variant),
}));
jest.mock('../../lib/onboarding-survey-intent', () => ({
  ...jest.requireActual('../../lib/onboarding-survey-intent'),
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
  mockFlag.mockReturnValue({ variant: 'treatment' });
  read.mockResolvedValue({ status: 'ready', exploring: false });
  (locationService.getHistory as jest.Mock).mockReturnValue({
    location: { pathname: '/a/grafana-setupguide-app/onboarding-flow/survey' },
    listen: (listener: typeof navigate) => {
      navigate = listener;
      return unlisten;
    },
  });
});
afterEach(() => {
  jest.useRealTimers();
});
const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};
it('does not read when excluded or signed out', async () => {
  mockFlag.mockReturnValue({ variant: 'excluded' });
  const view = render(<OnboardingExploringIntent />);
  await flush();
  expect(read).not.toHaveBeenCalled();
  view.unmount();
  mockFlag.mockReturnValue({ variant: 'treatment' });
  config.bootData.user.isSignedIn = false;
  render(<OnboardingExploringIntent />);
  await flush();
  expect(read).not.toHaveBeenCalled();
});
it('retries a delayed save and stops once eligible', async () => {
  read
    .mockResolvedValueOnce({ status: 'ready', exploring: false })
    .mockResolvedValue({ status: 'ready', exploring: true });
  render(<OnboardingExploringIntent />);
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
  render(<OnboardingExploringIntent />);
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
  render(<OnboardingExploringIntent />);
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
  const view = render(<OnboardingExploringIntent />);
  config.bootData.user.uid = 'two';
  await act(async () => {
    resolve({ status: 'ready', exploring: true });
  });
  expect(hasSavedExploringIntent()).toBe(false);
  view.unmount();
  expect(unlisten).toHaveBeenCalled();
  expect(read.mock.calls[0]![0].aborted).toBe(true);
});
it('revalidates on visibility and does not retry failed reads', async () => {
  read.mockResolvedValue({ status: 'unavailable', exploring: false });
  render(<OnboardingExploringIntent />);
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
  const view = render(<OnboardingExploringIntent />);
  view.unmount();
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
  render(<OnboardingExploringIntent />);
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
  render(<OnboardingExploringIntent />);
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
  render(<OnboardingExploringIntent />);
  await flush();
  expect(hasSavedExploringIntent()).toBe(true);
  config.bootData.user.uid = 'two';
  await act(async () => {
    navigate({ pathname: '/dashboards' });
  });
  config.bootData.user.uid = 'one';
  expect(hasSavedExploringIntent()).toBe(false);
});
