import { of, throwError } from 'rxjs';
import { config } from '@grafana/runtime';

import {
  fetchPathfinderSettingsSnapshot,
  savePathfinderSettings,
  collectionUrl,
  itemUrl,
} from './pathfinder-settings-api';
import { isBackendApiAvailable } from './interactive-guides-api';
import { saveTenantSettings } from '../components/AppConfig/save-settings';

const fetchMock = jest.fn();
jest.mock('@grafana/runtime', () => ({
  getBackendSrv: () => ({ fetch: fetchMock }),
  config: { namespace: 'stacks-123' },
}));
jest.mock('./interactive-guides-api', () => ({
  APP_PLATFORM_API_VERSION: 'pathfinderbackend.ext.grafana.app/v1alpha1',
  isBackendApiAvailable: jest.fn(() => true),
}));
jest.mock('../lib/telemetry/facade', () => ({ recordSettingsStoreResolved: jest.fn() }));

const base = { config: { enableLiveSessions: true }, spec: { enableLiveSessions: true }, resourceVersion: '42' };
const error = (status: number) => throwError(() => ({ status }));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(isBackendApiAvailable).mockReturnValue(true);
  config.namespace = 'stacks-123';
});

it('reads an existing resource with its concurrency token', async () => {
  fetchMock.mockReturnValueOnce(of({ data: { metadata: { resourceVersion: '42' }, spec: base.spec } }));
  expect(await fetchPathfinderSettingsSnapshot()).toEqual(base);
});

it.each([404, 405, 501])('permits legacy fallback when the API is absent (%i)', async (status) => {
  fetchMock.mockReturnValueOnce(error(status));
  expect(await fetchPathfinderSettingsSnapshot()).toBeNull();
});

it.each([400, 401, 403, 500, 503])(
  'does not mutate either store after an authoritative read fails (%i)',
  async (status) => {
    fetchMock.mockImplementation(({ url }: { url: string }) =>
      url.startsWith('/api/plugins/')
        ? of({ data: { jsonData: { stackId: '123' }, enabled: true, pinned: true } })
        : error(status)
    );
    await expect(
      saveTenantSettings({ pluginId: 'grafana-pathfinder-app', changes: { tutorialUrl: 'new' } })
    ).rejects.toMatchObject({ status });
    expect(fetchMock.mock.calls.every(([request]) => request.method === 'GET')).toBe(true);
  }
);

it('propagates network errors', async () => {
  fetchMock.mockReturnValueOnce(throwError(() => new Error('offline')));
  await expect(fetchPathfinderSettingsSnapshot()).rejects.toThrow('offline');
});

it.each([{ metadata: { resourceVersion: '1' } }, { spec: {} }])(
  'rejects incomplete resource snapshots',
  async (data) => {
    fetchMock.mockReturnValueOnce(of({ data }));
    await expect(fetchPathfinderSettingsSnapshot()).rejects.toThrow();
  }
);

it('updates with the read version and preserves unknown spec fields', async () => {
  fetchMock.mockReturnValueOnce(of({ data: {} }));
  await savePathfinderSettings(
    { enableLiveSessions: false },
    { ...base, spec: { ...base.spec, schemaVersion: 7, futureField: 'keep' } as never }
  );
  expect(fetchMock).toHaveBeenCalledWith(
    expect.objectContaining({
      method: 'PUT',
      url: itemUrl(config.namespace),
      data: expect.objectContaining({
        metadata: { name: 'default', resourceVersion: '42' },
        spec: { schemaVersion: 7, futureField: 'keep', enableLiveSessions: false },
      }),
    })
  );
});

it('creates an absent singleton directly, so concurrent creation returns a conflict', async () => {
  fetchMock.mockReturnValueOnce(error(409));
  await expect(savePathfinderSettings({ enableLiveSessions: true })).rejects.toMatchObject({ status: 409 });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith(
    expect.objectContaining({ method: 'POST', url: collectionUrl(config.namespace) })
  );
});

it.each([404, 405, 501])('permits fallback on an absent create endpoint (%i)', async (status) => {
  fetchMock.mockReturnValueOnce(error(status));
  expect(await savePathfinderSettings({ enableLiveSessions: true })).toBe(false);
});

it.each([403, 409, 422, 500, 503])('propagates real creation failures (%i)', async (status) => {
  fetchMock.mockReturnValueOnce(error(status));
  await expect(savePathfinderSettings({})).rejects.toMatchObject({ status });
});

it.each([400, 401, 403, 409, 422])('does not retry a rejected update (%i)', async (status) => {
  fetchMock.mockReturnValueOnce(error(status));
  await expect(savePathfinderSettings({}, base)).rejects.toMatchObject({ status });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

describe('existing resource update recovery', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it.each([404, 405, 500, 501, 502, 503, 504])('recovers a transient update failure (%i)', async (status) => {
    fetchMock.mockReturnValueOnce(error(status)).mockReturnValueOnce(of({ data: {} }));
    const save = savePathfinderSettings({ enableLiveSessions: false }, base);
    await jest.advanceTimersByTimeAsync(250);
    await expect(save).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [first, second] = fetchMock.mock.calls;
    expect(first[0]).toMatchObject({
      method: 'PUT',
      data: { metadata: { resourceVersion: '42' }, spec: { enableLiveSessions: false } },
    });
    expect(second[0]).toEqual(first[0]);
  });

  it.each([404, 405, 500, 501, 502, 503, 504])('bounds retries without switching stores (%i)', async (status) => {
    fetchMock.mockReturnValue(error(status));
    const rejected = expect(savePathfinderSettings({}, base)).rejects.toMatchObject({ status });
    await jest.runAllTimersAsync();
    await rejected;
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.every(([request]) => request.method === 'PUT')).toBe(true);
  });

  it('stops if a retry conflicts, rather than rebasing a stale spec over a newer write', async () => {
    fetchMock.mockReturnValueOnce(error(503)).mockReturnValueOnce(error(409));
    const rejected = expect(savePathfinderSettings({}, base)).rejects.toMatchObject({ status: 409 });
    await jest.runAllTimersAsync();
    await rejected;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0].data.metadata.resourceVersion).toBe('42');
  });

  it('keeps a recovered tenant save authoritative on the next read', async () => {
    let spec = base.spec;
    let attempts = 0;
    fetchMock.mockImplementation(({ method, url, data }) => {
      if (url.startsWith('/api/plugins/')) {
        if (method !== 'GET') {
          throw new Error('An existing resource must not write to legacy settings');
        }
        return of({ data: { jsonData: { stackId: '123', enableLiveSessions: true } } });
      }
      if (method === 'PUT') {
        if (attempts++ === 0) {
          return error(503);
        }
        spec = data.spec;
        return of({ data: {} });
      }
      return of({ data: { metadata: { resourceVersion: '42' }, spec } });
    });
    const save = saveTenantSettings({ pluginId: 'grafana-pathfinder-app', changes: { enableLiveSessions: false } });
    await jest.runAllTimersAsync();
    await save;
    expect((await fetchPathfinderSettingsSnapshot())?.config.enableLiveSessions).toBe(false);
    expect(attempts).toBe(2);
  });
});

it('preserves OSS plugin settings without materializing system defaults', async () => {
  jest.mocked(isBackendApiAvailable).mockReturnValue(false);
  fetchMock
    .mockReturnValueOnce(
      of({ data: { enabled: false, pinned: false, jsonData: { stackId: '123', futureField: 'keep' } } })
    )
    .mockReturnValueOnce(of({ data: {} }));
  await saveTenantSettings({ pluginId: 'grafana-pathfinder-app', changes: { tutorialUrl: 'new' } });
  expect(fetchMock.mock.calls[1][0]).toMatchObject({
    method: 'POST',
    data: { enabled: false, pinned: false, jsonData: { stackId: '123', futureField: 'keep', tutorialUrl: 'new' } },
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('does not call the settings resource without a namespace', async () => {
  config.namespace = '';
  expect(await fetchPathfinderSettingsSnapshot()).toBeNull();
  expect(await savePathfinderSettings({})).toBe(false);
  expect(fetchMock).not.toHaveBeenCalled();
});
