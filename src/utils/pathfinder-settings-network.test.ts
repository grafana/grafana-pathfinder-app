import { of, throwError, Subject } from 'rxjs';
import { config } from '@grafana/runtime';

import {
  fetchPathfinderSettingsSnapshot,
  savePathfinderSettings,
  collectionUrl,
  itemUrl,
} from './pathfinder-settings-api';
import { isBackendApiAvailable, isBackendApiRuledOut } from './interactive-guides-api';
import { saveTenantSettings } from '../components/AppConfig/save-settings';
import { resolveTenantSettings } from './resolve-tenant-settings';

const fetchMock = jest.fn();
jest.mock('@grafana/runtime', () => ({
  getBackendSrv: () => ({ fetch: fetchMock }),
  config: { namespace: 'stacks-123' },
}));
jest.mock('./interactive-guides-api', () => ({
  APP_PLATFORM_API_VERSION: 'pathfinderbackend.ext.grafana.app/v1alpha1',
  isBackendApiAvailable: jest.fn(() => true),
  isBackendApiRuledOut: jest.fn(() => false),
}));
jest.mock('../lib/telemetry/facade', () => ({ recordSettingsStoreResolved: jest.fn() }));

const base = { config: { enableLiveSessions: true }, spec: { enableLiveSessions: true }, resourceVersion: '42' };
const error = (status: number) => throwError(() => ({ status }));

beforeEach(() => {
  jest.clearAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  jest.mocked(isBackendApiAvailable).mockReturnValue(true);
  jest.mocked(isBackendApiRuledOut).mockReturnValue(false);
  config.namespace = 'stacks-123';
});

it('reads an existing resource with its concurrency token', async () => {
  fetchMock.mockReturnValueOnce(of({ data: { metadata: { resourceVersion: '42' }, spec: base.spec } }));
  expect(await fetchPathfinderSettingsSnapshot()).toEqual(base);
  expect(fetchMock).toHaveBeenCalledWith(
    expect.objectContaining({ method: 'GET', url: '/api/plugins/grafana-pathfinder-app/resources/pathfinder-settings' })
  );
});

it.each([404, 405, 501])('permits legacy fallback when the API is absent (%i)', async (status) => {
  fetchMock.mockReturnValueOnce(throwError(() => ({ status, data: { error: 'settings-upstream-unavailable' } })));
  expect(await fetchPathfinderSettingsSnapshot()).toBeNull();
});

it.each([400, 401, 403])('does not mutate either store after an authoritative read fails (%i)', async (status) => {
  fetchMock.mockImplementation(({ url }: { url: string }) =>
    url.endsWith('/settings')
      ? of({ data: { jsonData: { stackId: '123' }, enabled: true, pinned: true } })
      : error(status)
  );
  await expect(
    saveTenantSettings({ pluginId: 'grafana-pathfinder-app', changes: { tutorialUrl: 'new' } })
  ).rejects.toMatchObject({ status });
  expect(fetchMock.mock.calls.every(([request]) => request.method === 'GET')).toBe(true);
});

describe('settings read recovery', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it.each([500, 502, 503, 504])('recovers a transient failure (%i) with the authoritative snapshot', async (status) => {
    fetchMock
      .mockReturnValueOnce(error(status))
      .mockReturnValueOnce(of({ data: { metadata: { resourceVersion: '42' }, spec: base.spec } }));
    const read = fetchPathfinderSettingsSnapshot();
    await jest.advanceTimersByTimeAsync(499);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await expect(read).resolves.toEqual(base);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([500, 502, 503, 504])('bounds persistent failures without mutating either store (%i)', async (status) => {
    fetchMock.mockImplementation(({ url }: { url: string }) =>
      url.endsWith('/settings')
        ? of({ data: { jsonData: { stackId: '123' }, enabled: true, pinned: true } })
        : error(status)
    );
    const rejected = expect(
      saveTenantSettings({ pluginId: 'grafana-pathfinder-app', changes: { tutorialUrl: 'new' } })
    ).rejects.toMatchObject({ status });
    const settingsReads = () =>
      fetchMock.mock.calls.map(([request]) => request).filter(({ url }) => !url.endsWith('/settings'));
    await jest.advanceTimersByTimeAsync(1999);
    expect(settingsReads()).toHaveLength(2);
    await jest.advanceTimersByTimeAsync(1);
    await rejected;
    const url = '/api/plugins/grafana-pathfinder-app/resources/pathfinder-settings';
    expect(settingsReads().map((request) => [request.url, request.params])).toEqual([
      [url, { absence: 'explicit' }],
      [url, { absence: 'explicit', attempt: 2 }],
      [url, { absence: 'explicit', attempt: 3 }],
    ]);
    expect(fetchMock.mock.calls.every(([request]) => request.method === 'GET')).toBe(true);
  });

  it.each([401, 403])(
    'does not retry an upstream authentication or permission rejection hidden by a 502 (%i)',
    async (upstreamStatus) => {
      fetchMock.mockReturnValueOnce(throwError(() => ({ status: 502, data: { diagnostics: { upstreamStatus } } })));
      await expect(fetchPathfinderSettingsSnapshot()).rejects.toMatchObject({ status: 502 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  );

  it.each([
    [502, { reason: 'timeout' }],
    [504, { reason: 'http-error', upstreamStatus: 504 }],
  ])('does not re-queue a read the upstream timed out on (%i)', async (status, diagnostics) => {
    fetchMock.mockReturnValueOnce(throwError(() => ({ status, data: { diagnostics } })));
    await expect(fetchPathfinderSettingsSnapshot()).rejects.toMatchObject({ status });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('accepts an absent singleton after the API becomes ready', async () => {
    fetchMock
      .mockReturnValueOnce(error(503))
      .mockReturnValueOnce(throwError(() => ({ status: 404, data: { error: 'settings-upstream-unavailable' } })));
    const read = fetchPathfinderSettingsSnapshot();
    await jest.runAllTimersAsync();
    await expect(read).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stops retrying when a transient error becomes a permission denial', async () => {
    fetchMock.mockReturnValueOnce(error(503)).mockReturnValueOnce(error(403));
    const rejected = expect(fetchPathfinderSettingsSnapshot()).rejects.toMatchObject({ status: 403 });
    await jest.runAllTimersAsync();
    await rejected;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

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
      if (url.endsWith('/settings')) {
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
  jest.mocked(isBackendApiRuledOut).mockReturnValue(true);
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

it.each([404, 405, 501])('rejects missing proxy routes instead of treating settings as absent (%i)', async (status) => {
  fetchMock.mockReturnValueOnce(error(status));
  await expect(fetchPathfinderSettingsSnapshot()).rejects.toMatchObject({ status });
});

describe('confirmed settings absence', () => {
  const startupRead = () => fetchPathfinderSettingsSnapshot({ useCachedAbsence: true });
  const absent = () => of({ data: { state: 'not-configured' } });
  const saved = () => of({ data: { metadata: { resourceVersion: '42' }, spec: base.spec } });

  it('reuses only explicit absence for the tab session', async () => {
    fetchMock.mockReturnValue(absent());
    await expect(startupRead()).resolves.toBeNull();
    await expect(startupRead()).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    sessionStorage.clear();
    await startupRead();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('always reads fresh for configuration and then invalidates absence', async () => {
    fetchMock.mockReturnValueOnce(absent()).mockReturnValue(saved());
    await startupRead();
    await expect(fetchPathfinderSettingsSnapshot()).resolves.toEqual(base);
    await expect(startupRead()).resolves.toEqual(base);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([404, 405, 501])('never caches an old or unsupported proxy response (%i)', async (status) => {
    fetchMock.mockReturnValue(throwError(() => ({ status, data: { error: 'settings-upstream-unavailable' } })));
    await startupRead();
    await startupRead();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([403, 404])('never caches a real failure (%i)', async (status) => {
    fetchMock.mockReturnValue(error(status));
    await expect(startupRead()).rejects.toMatchObject({ status });
    await expect(startupRead()).rejects.toMatchObject({ status });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never caches a real record', async () => {
    fetchMock.mockReturnValue(saved());
    await startupRead();
    await startupRead();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('invalidates the cached absence after a save, including another tab on reload', async () => {
    fetchMock.mockReturnValueOnce(absent()).mockReturnValue(saved());
    await startupRead();
    const entries = Object.entries(sessionStorage);
    await savePathfinderSettings({ enableLiveSessions: true });
    for (const [key, value] of entries) {
      sessionStorage.setItem(key, value);
    }
    await expect(startupRead()).resolves.toEqual(base);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not let an in-flight absent response restore a cache invalidated by a save', async () => {
    const pending = new Subject<{ data: { state: string } }>();
    fetchMock.mockReturnValueOnce(pending).mockReturnValue(saved());
    const read = startupRead();
    await savePathfinderSettings({ enableLiveSessions: true });
    pending.next({ data: { state: 'not-configured' } });
    pending.complete();
    await read;
    await expect(startupRead()).resolves.toEqual(base);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('expires absence after ten minutes so a save from another browser is picked up', async () => {
    const now = jest.spyOn(Date, 'now');
    try {
      now.mockReturnValue(1_000_000);
      fetchMock.mockReturnValueOnce(absent()).mockReturnValue(saved());
      await startupRead();
      now.mockReturnValue(1_000_000 + 10 * 60 * 1000 - 1);
      await expect(startupRead()).resolves.toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      now.mockReturnValue(1_000_000 + 10 * 60 * 1000);
      await expect(startupRead()).resolves.toEqual(base);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      now.mockRestore();
    }
  });

  it('does not share absence across namespaces', async () => {
    fetchMock.mockReturnValueOnce(absent()).mockReturnValue(saved());
    await startupRead();
    config.namespace = 'stacks-456';
    await expect(startupRead()).resolves.toEqual(base);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falls back to network reads when browser storage is unavailable', async () => {
    const blocked = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      fetchMock.mockReturnValue(absent());
      await startupRead();
      await startupRead();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      blocked.mockRestore();
    }
  });

  it('reads fresh before saving and verifies the first enablement save without cached absence', async () => {
    let exists = false;
    fetchMock.mockImplementation(({ method, url }) => {
      if (url.endsWith('/settings')) {
        return of({ data: { jsonData: {}, enabled: true, pinned: true } });
      }
      if (method === 'POST') {
        exists = true;
        return of({ data: {} });
      }
      return exists
        ? of({ data: { metadata: { resourceVersion: '1' }, spec: { pathfinderEnabled: false } } })
        : absent();
    });
    await startupRead();
    await saveTenantSettings({ pluginId: 'grafana-pathfinder-app', changes: { pathfinderEnabled: false } });
    expect(fetchMock.mock.calls.filter(([request]) => request.url.endsWith('/pathfinder-settings'))).toHaveLength(3);
    expect(fetchMock.mock.calls.filter(([request]) => request.method === 'POST')).toHaveLength(1);
  });
});

describe('the kind is not served (structural upstream 404)', () => {
  const structural404 = () => throwError(() => ({ status: 404, data: { error: 'settings-upstream-unavailable' } }));
  const routes = (writes: Array<{ url: string; data: unknown }>) =>
    fetchMock.mockImplementation(({ url, method, data }: { url: string; method: string; data: unknown }) => {
      if (url.endsWith('/settings')) {
        if (method === 'POST') {
          writes.push({ url, data });
          return of({ data: {} });
        }
        return of({ data: { jsonData: { stackId: '123', pathfinderEnabled: false }, enabled: true, pinned: true } });
      }
      return method === 'POST' ? error(404) : structural404();
    });

  it('resolves from jsonData without caching the absence', async () => {
    routes([]);
    await expect(resolveTenantSettings('grafana-pathfinder-app', { useCachedAbsence: true })).resolves.toMatchObject({
      config: { pathfinderEnabled: false },
      tenant: null,
    });
    await resolveTenantSettings('grafana-pathfinder-app', { useCachedAbsence: true });
    expect(fetchMock.mock.calls.filter(([request]) => request.url.endsWith('/pathfinder-settings'))).toHaveLength(2);
  });

  it('saves to jsonData rather than failing', async () => {
    const writes: Array<{ url: string; data: unknown }> = [];
    routes(writes);
    await saveTenantSettings({ pluginId: 'grafana-pathfinder-app', changes: { tutorialUrl: 'new' } });
    expect(writes).toEqual([
      {
        url: '/api/plugins/grafana-pathfinder-app/settings',
        data: expect.objectContaining({ jsonData: expect.objectContaining({ stackId: '123', tutorialUrl: 'new' }) }),
      },
    ]);
  });
});

it('reads through the proxy when the boot toggles cannot answer, as under multi-tenancy', async () => {
  jest.mocked(isBackendApiAvailable).mockReturnValue(false);
  fetchMock.mockReturnValueOnce(of({ data: { metadata: { resourceVersion: '42' }, spec: base.spec } }));

  expect(await fetchPathfinderSettingsSnapshot()).toEqual(base);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('skips the read when the boot toggles rule the backend out', async () => {
  jest.mocked(isBackendApiRuledOut).mockReturnValue(true);

  expect(await fetchPathfinderSettingsSnapshot()).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});
