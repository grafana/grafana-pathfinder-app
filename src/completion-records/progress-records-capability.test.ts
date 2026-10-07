jest.mock('../utils/openfeature', () => ({ getFeatureFlagValue: jest.fn(() => false) }));
jest.mock('@grafana/runtime', () => ({ getBackendSrv: () => ({ fetch: mockFetch }) }));

import { of, throwError } from 'rxjs';
import { getFeatureFlagValue } from '../utils/openfeature';
import {
  __resetProgressRecordsCapabilityForTests,
  loadProgressRecordsCapability,
  progressRecordsCapability,
  watchProgressRecordsCapability,
} from './progress-records-capability';

const mockFetch = jest.fn();
const flag = getFeatureFlagValue as jest.Mock;
let stop: (() => void) | undefined;

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(Math, 'random').mockReturnValue(0.5);
  mockFetch.mockReset();
  flag.mockReturnValue(false);
  __resetProgressRecordsCapabilityForTests();
});

afterEach(() => {
  stop?.();
  stop = undefined;
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('makes no flag-off requests and starts after the local flag becomes enabled', async () => {
  const resolved = jest.fn();
  stop = watchProgressRecordsCapability(resolved);
  await jest.advanceTimersByTimeAsync(15_000);
  await expect(loadProgressRecordsCapability()).resolves.toBe('unknown');
  expect(mockFetch).not.toHaveBeenCalled();
  flag.mockReturnValue(true);
  mockFetch.mockReturnValue(of({ data: { available: true, progressRecords: true } }));
  await jest.advanceTimersByTimeAsync(5_000);
  expect(mockFetch).toHaveBeenCalledTimes(1);
  expect(resolved).toHaveBeenCalledTimes(1);
});

it('automatically retries network and parse failures with backoff', async () => {
  flag.mockReturnValue(true);
  mockFetch
    .mockReturnValueOnce(throwError(() => new Error('offline')))
    .mockReturnValueOnce(of({ data: { available: true, futureField: true } }))
    .mockReturnValue(of({ data: { available: true, progressRecords: true } }));
  const resolved = jest.fn();
  stop = watchProgressRecordsCapability(resolved);
  await jest.advanceTimersByTimeAsync(0);
  expect(progressRecordsCapability()).toBe('unknown');
  await jest.advanceTimersByTimeAsync(1_000);
  expect(mockFetch).toHaveBeenCalledTimes(2);
  expect(resolved).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(2_000);
  expect(mockFetch).toHaveBeenCalledTimes(3);
  expect(progressRecordsCapability()).toBe('yes');
  expect(resolved).toHaveBeenCalledTimes(1);
});

it('shares concurrent probes', async () => {
  flag.mockReturnValue(true);
  mockFetch.mockReturnValue(of({ data: { available: true, progressRecords: true } }));
  await Promise.all([loadProgressRecordsCapability(), loadProgressRecordsCapability()]);
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

it('stops retries on disposal', async () => {
  flag.mockReturnValue(true);
  mockFetch.mockReturnValue(throwError(() => new Error('offline')));
  stop = watchProgressRecordsCapability(jest.fn());
  await jest.advanceTimersByTimeAsync(0);
  stop();
  await jest.advanceTimersByTimeAsync(600_000);
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

it('does not notify or schedule retries after disposal during a request', async () => {
  flag.mockReturnValue(true);
  let finish!: (value: 'yes') => void;
  const pending = loadProgressRecordsCapability(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const resolved = jest.fn();
  stop = watchProgressRecordsCapability(resolved);
  await jest.advanceTimersByTimeAsync(0);
  stop();
  finish('yes');
  await pending;
  await jest.advanceTimersByTimeAsync(600_000);
  expect(resolved).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});
