import { of, throwError } from 'rxjs';

import { getBackendSrv } from '@grafana/runtime';

import {
  clearMyCompletionsCache,
  loadMyCompletions,
  __resetMyCompletionsCacheForTests,
} from './completion-read-client';

const mockFetch = jest.fn();
jest.mock('@grafana/runtime', () => ({
  getBackendSrv: jest.fn(),
}));

let publishedListener: (() => void) | undefined;
jest.mock('./completion-write-hook', () => ({
  onCompletionPublished: (listener: () => void) => {
    publishedListener = listener;
    return () => {
      publishedListener = undefined;
    };
  },
}));

function body(available = true) {
  return { capability: { available }, completions: [], inProgress: [], asOf: '2026-10-13T12:00:00Z' };
}

describe('loadMyCompletions', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-13T12:00:00Z'));
    mockFetch.mockReset();
    (getBackendSrv as jest.Mock).mockReturnValue({ fetch: mockFetch });
    __resetMyCompletionsCacheForTests();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('requests /completion-records/my without refresh and without alerts', async () => {
    mockFetch.mockReturnValue(of({ data: body() }));
    await loadMyCompletions();
    expect(mockFetch).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        showErrorAlert: false,
        url: expect.stringMatching(/\/completion-records\/my$/),
      })
    );
  });

  it('serves a successful result from cache within the TTL', async () => {
    mockFetch.mockReturnValue(of({ data: body() }));
    expect((await loadMyCompletions()).kind).toBe('ok');
    expect((await loadMyCompletions()).kind).toBe('ok');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('refetches after the TTL', async () => {
    mockFetch.mockReturnValue(of({ data: body() }));
    await loadMyCompletions();
    jest.setSystemTime(Date.now() + 61_000);
    await loadMyCompletions();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('does not cache unavailable results', async () => {
    mockFetch.mockReturnValue(throwError(() => new Error('503')));
    expect((await loadMyCompletions()).kind).toBe('unavailable');
    await loadMyCompletions();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('does not cache invalid results', async () => {
    mockFetch.mockReturnValue(of({ data: { nope: true } }));
    expect((await loadMyCompletions()).kind).toBe('invalid');
    await loadMyCompletions();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('reports unavailable when the capability is off', async () => {
    mockFetch.mockReturnValue(of({ data: body(false) }));
    expect((await loadMyCompletions()).kind).toBe('unavailable');
  });

  it('shares one in-flight request between concurrent callers', async () => {
    mockFetch.mockReturnValue(of({ data: body() }));
    await Promise.all([loadMyCompletions(), loadMyCompletions()]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('clears the cache when a completion is published', async () => {
    mockFetch.mockReturnValue(of({ data: body() }));
    await loadMyCompletions();
    expect(publishedListener).toBeDefined();
    publishedListener?.();
    await loadMyCompletions();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('does not repopulate the cache from a load that started before a clear', async () => {
    let release: (value: { data: unknown }) => void = () => {};
    mockFetch.mockReturnValueOnce(
      new (jest.requireActual('rxjs').Observable)(
        (subscriber: { next: (v: unknown) => void; complete: () => void }) => {
          release = (value) => {
            subscriber.next(value);
            subscriber.complete();
          };
        }
      )
    );
    const stale = loadMyCompletions();
    clearMyCompletionsCache();
    release({ data: body() });
    await stale;

    mockFetch.mockReturnValue(of({ data: body() }));
    await loadMyCompletions();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
