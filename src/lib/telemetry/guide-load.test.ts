import { beginGuideLoad, fetchGuideResource, finishGuideLoad, pauseGuideLoad, resumeGuideLoad } from './guide-load';
import { recordGuideRender, recordGuideRequest } from './facade';
import { normalizeTelemetryUrl } from './url';

jest.mock('./facade', () => ({ recordGuideRender: jest.fn(), recordGuideRequest: jest.fn() }));

beforeEach(() => {
  global.fetch = jest.fn();
  jest.useFakeTimers();
  jest.clearAllMocks();
});
afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

it('does not report success until render commits and deduplicates terminal outcomes', () => {
  const load = beginGuideLoad('backend-guide:private-name');
  expect(recordGuideRender).not.toHaveBeenCalled();
  finishGuideLoad(load, 'rendered');
  finishGuideLoad(load, 'rendered');
  finishGuideLoad(load, 'cancelled');
  expect(recordGuideRender).toHaveBeenCalledTimes(1);
  expect(recordGuideRender).toHaveBeenCalledWith(load, 'rendered', 0, undefined);
  expect(JSON.stringify(load)).not.toContain('private-name');
});

it('excludes alignment and hidden-tab time from the active loading budget', () => {
  const load = beginGuideLoad('bundled:test');
  jest.advanceTimersByTime(10_000);
  pauseGuideLoad(load, true);
  jest.advanceTimersByTime(120_000);
  expect(recordGuideRender).toHaveBeenCalledTimes(1);
  expect(recordGuideRender).toHaveBeenLastCalledWith(load, 'awaiting-user', 10_000, undefined);
  resumeGuideLoad(load);
  jest.advanceTimersByTime(49_999);
  expect(recordGuideRender).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(1);
  expect(recordGuideRender).toHaveBeenLastCalledWith(
    load,
    'timeout',
    60_000,
    expect.objectContaining({ reason: 'timeout' })
  );
});

it('keeps a recovered degradation separate from the final rendered outcome', () => {
  const load = beginGuideLoad('bundled:test');
  finishGuideLoad(load, 'degraded', { source: 'bundled', stage: 'prepare', reason: 'snippet-unavailable' });
  finishGuideLoad(load, 'rendered');
  jest.advanceTimersByTime(60_000);
  expect(recordGuideRender).toHaveBeenCalledTimes(2);
});

it.each([401, 403, 404, 429, 500, 503])(
  'records HTTP %i and correlates fallback attempts without exposing query values',
  async (status) => {
    const load = beginGuideLoad('https://interactive-learning.grafana.net/test/content.json');
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValueOnce({ status } as Response);
    await fetchGuideResource(
      'https://interactive-learning.grafana.net/test/content.json?secret=private',
      undefined,
      load
    );
    expect(recordGuideRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        context: load,
        statusCode: status,
        diagnostic: { source: 'cdn', stage: 'fetch', reason: 'http-error', statusCode: status },
      })
    );
    fetchMock.mockRestore();
    finishGuideLoad(load, 'cancelled');
  }
);

it('reports a network failure without claiming CORS and preserves the thrown error', async () => {
  const error = new TypeError('private content');
  const fetchMock = jest.spyOn(global, 'fetch').mockRejectedValue(error);
  await expect(fetchGuideResource('https://interactive-learning.grafana.net/test/content.json')).rejects.toBe(error);
  expect(recordGuideRequest).toHaveBeenCalledWith(
    expect.objectContaining({ diagnostic: { source: 'cdn', stage: 'fetch', reason: 'network-error' } })
  );
  expect(JSON.stringify((recordGuideRequest as jest.Mock).mock.calls)).not.toContain('private content');
  fetchMock.mockRestore();
});

it('normalizes private resource references and strips credentials from public URLs', () => {
  const first = normalizeTelemetryUrl('backend-guide:private-name');
  expect(first).toMatch(/^private-guide:[a-f0-9]{32}$/);
  expect(normalizeTelemetryUrl('backend-guide:private-name')).toBe(first);
  expect(
    normalizeTelemetryUrl(
      '/apis/pathfinderbackend.ext.grafana.app/v1alpha1/namespaces/private/interactiveguides/private-name'
    )
  ).not.toContain('private-name');
  expect(normalizeTelemetryUrl('https://user:password@interactive-learning.grafana.net/a?secret=value#private')).toBe(
    'interactive-learning.grafana.net/a'
  );
});

it('cancels an abandoned attempt without a later timeout or success', () => {
  const load = beginGuideLoad('backend-guide:cancelled-private-guide');
  finishGuideLoad(load, 'cancelled');
  jest.advanceTimersByTime(120_000);
  finishGuideLoad(load, 'rendered');
  expect(recordGuideRender).toHaveBeenCalledTimes(1);
  expect(recordGuideRender).toHaveBeenCalledWith(load, 'cancelled', 0, undefined);
});
