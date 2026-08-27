/**
 * Unit tests for the PathfinderSettings network ladders.
 *
 * The mapper tests next door cover what crosses the boundary; these cover the
 * request sequences, which are where an unavailable kind either degrades to the
 * legacy store or takes every save down with it. `getBackendSrv().fetch` is
 * mocked to return rxjs observables so `lastValueFrom` settles deterministically.
 */

import { of, throwError } from 'rxjs';

const fetchMock = jest.fn();

jest.mock('@grafana/runtime', () => ({
  getBackendSrv: () => ({ fetch: fetchMock }),
  config: { namespace: 'stacks-123' },
}));

jest.mock('./interactive-guides-api', () => ({
  APP_PLATFORM_API_VERSION: 'pathfinderbackend.ext.grafana.app/v1alpha1',
  isBackendApiAvailable: jest.fn(() => true),
}));

jest.mock('../lib/telemetry/facade', () => ({
  recordSettingsStoreResolved: jest.fn(),
}));

import { config } from '@grafana/runtime';

import {
  SETTINGS_SCHEMA_VERSION,
  collectionUrl,
  fetchPathfinderSettingsSnapshot,
  itemUrl,
  savePathfinderSettings,
} from './pathfinder-settings-api';
import { recordSettingsStoreResolved } from '../lib/telemetry/facade';
import { isBackendApiAvailable } from './interactive-guides-api';

const mockAvailable = isBackendApiAvailable as jest.MockedFunction<() => boolean>;
const mockRecord = recordSettingsStoreResolved as jest.MockedFunction<typeof recordSettingsStoreResolved>;

const NAMESPACE = 'stacks-123';

/**
 * The store-ladder rung is emitted through a dynamic import, so it lands a
 * microtask after the read resolves — the facade must stay out of `module.js`.
 */
async function settleTelemetry() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** An error shaped the way `getBackendSrv().fetch` rejects. */
function httpError(status: number) {
  return throwError(() => ({ status }));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAvailable.mockReturnValue(true);
  config.namespace = NAMESPACE;
});

describe('fetchPathfinderSettingsSnapshot', () => {
  it('returns the config, the raw spec and the resourceVersion', async () => {
    fetchMock.mockReturnValueOnce(
      of({ data: { metadata: { resourceVersion: '42' }, spec: { devModeEnabled: true, schemaVersion: 1 } } })
    );

    const snapshot = await fetchPathfinderSettingsSnapshot();

    expect(fetchMock).toHaveBeenCalledWith(expect.objectContaining({ url: itemUrl(NAMESPACE), method: 'GET' }));
    expect(snapshot).toEqual({
      config: { devMode: true },
      spec: { devModeEnabled: true, schemaVersion: 1 },
      resourceVersion: '42',
    });
  });

  it('returns null without a request when the API is unavailable', async () => {
    mockAvailable.mockReturnValue(false);

    expect(await fetchPathfinderSettingsSnapshot()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    await settleTelemetry();
    expect(mockRecord).toHaveBeenCalledWith('api-unavailable');
  });

  it.each([
    [404, 'not-created'],
    [405, 'kind-not-served'],
    [501, 'kind-not-served'],
    [503, 'kind-not-served'],
  ])('degrades to null on %i so the caller falls back to jsonData', async (status, outcome) => {
    fetchMock.mockReturnValueOnce(httpError(status));

    expect(await fetchPathfinderSettingsSnapshot()).toBeNull();
    await settleTelemetry();
    expect(mockRecord).toHaveBeenCalledWith(outcome);
  });

  it('degrades to null on 403, recorded distinctly from an absent kind', async () => {
    // A read the admin's role cannot make is a different operational problem to
    // a kind that was never deployed, and only telemetry can tell them apart.
    fetchMock.mockReturnValueOnce(httpError(403));

    expect(await fetchPathfinderSettingsSnapshot()).toBeNull();
    await settleTelemetry();
    expect(mockRecord).toHaveBeenCalledWith('forbidden');
  });

  it('degrades to null on 400 but reports it as an error, not an absent API', async () => {
    // 400 on a by-name GET is a malformed request of ours; classifying it as
    // "unavailable" would hide the bug behind a silent fallback.
    fetchMock.mockReturnValueOnce(httpError(400));

    expect(await fetchPathfinderSettingsSnapshot()).toBeNull();
    await settleTelemetry();
    expect(mockRecord).toHaveBeenCalledWith('read-error');
  });

  it('returns null when the resource exists with no spec', async () => {
    fetchMock.mockReturnValueOnce(of({ data: { metadata: { resourceVersion: '1' } } }));

    expect(await fetchPathfinderSettingsSnapshot()).toBeNull();
    await settleTelemetry();
    expect(mockRecord).toHaveBeenCalledWith('empty-spec');
  });
});

describe('savePathfinderSettings', () => {
  it('returns false without a request when the API is unavailable', async () => {
    mockAvailable.mockReturnValue(false);

    expect(await savePathfinderSettings({ enableLiveSessions: true })).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('PUTs the spec and reports success', async () => {
    fetchMock.mockReturnValueOnce(of({ data: {} }));

    expect(await savePathfinderSettings({ enableLiveSessions: true })).toBe(true);

    const request = fetchMock.mock.calls[0]![0];
    expect(request.method).toBe('PUT');
    expect(request.url).toBe(itemUrl(NAMESPACE));
    expect(request.data.spec).toEqual({ schemaVersion: SETTINGS_SCHEMA_VERSION, enableLiveSessions: true });
  });

  it('sends the read resourceVersion so a concurrent save conflicts rather than losing', async () => {
    fetchMock.mockReturnValueOnce(of({ data: {} }));

    await savePathfinderSettings({ enableLiveSessions: true }, { config: {}, spec: {}, resourceVersion: '42' });

    expect(fetchMock.mock.calls[0]![0].data.metadata).toEqual({ name: 'default', resourceVersion: '42' });
  });

  it('carries a stored spec forward so a newer backend field is not dropped', async () => {
    // The write is a full replace, so anything this app version does not model —
    // including a schemaVersion it has never heard of — has to come from the read.
    fetchMock.mockReturnValueOnce(of({ data: {} }));

    await savePathfinderSettings(
      { enableLiveSessions: true },
      { config: {}, spec: { schemaVersion: 7, futureField: 'keep me' } as never, resourceVersion: '9' }
    );

    expect(fetchMock.mock.calls[0]![0].data.spec).toEqual({
      schemaVersion: 7,
      futureField: 'keep me',
      enableLiveSessions: true,
    });
  });

  it('clamps a value outside the kind bounds instead of letting the apiserver 422 the save', async () => {
    // One bad legacy value would otherwise block the first migrating save from
    // every tab, not just the tab that owns the field.
    fetchMock.mockReturnValueOnce(of({ data: {} }));

    await savePathfinderSettings({ peerjsPort: 70000, guidedStepTimeout: 5 });

    expect(fetchMock.mock.calls[0]![0].data.spec).toMatchObject({ peerjsPort: 65535, guidedStepTimeout: 1000 });
  });

  it('creates the singleton when the PUT 404s', async () => {
    fetchMock.mockReturnValueOnce(httpError(404)).mockReturnValueOnce(of({ data: {} }));

    expect(await savePathfinderSettings({ enableLiveSessions: true })).toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const create = fetchMock.mock.calls[1]![0];
    expect(create.method).toBe('POST');
    expect(create.url).toBe(collectionUrl(NAMESPACE));
    // A create has nothing to compare against; sending a resourceVersion here
    // would be rejected.
    expect(create.data.metadata).toEqual({ name: 'default' });
  });

  it.each([404, 405, 501, 503])(
    'returns false when the create also fails with %i, so the caller falls back',
    async (status) => {
      // The aggregation toggle is shared with InteractiveGuide, so it cannot say
      // whether *this* kind is served. A stack running the plugin ahead of the
      // backend lands here, and a throw would take every save down with it.
      fetchMock.mockReturnValueOnce(httpError(404)).mockReturnValueOnce(httpError(status));

      expect(await savePathfinderSettings({ enableLiveSessions: true })).toBe(false);
    }
  );

  it('throws when the create is forbidden, rather than silently writing to jsonData', async () => {
    fetchMock.mockReturnValueOnce(httpError(404)).mockReturnValueOnce(httpError(403));

    await expect(savePathfinderSettings({ enableLiveSessions: true })).rejects.toMatchObject({ status: 403 });
  });

  it.each([403, 409, 422, 500])('propagates a %i on the PUT without attempting a create', async (status) => {
    fetchMock.mockReturnValueOnce(httpError(status));

    await expect(savePathfinderSettings({ enableLiveSessions: true })).rejects.toMatchObject({ status });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
