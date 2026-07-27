import { of, throwError } from 'rxjs';

let mockToggles: Record<string, boolean> = {};
const mockFetch = jest.fn();

jest.mock('@grafana/runtime', () => ({
  config: {
    get featureToggles() {
      return mockToggles;
    },
  },
  getBackendSrv: () => ({ fetch: mockFetch }),
}));

const mockWarn = jest.fn();
jest.mock('../lib/logging', () => ({
  logger: { warn: (...args: unknown[]) => mockWarn(...args) },
}));

import {
  apiVersionFor,
  collectionUrl,
  dualWrite,
  isBackendApiAvailable,
  itemUrl,
  readItemWithFallback,
  readListMerged,
  resolveAvailability,
} from './interactive-guides-api';

const NEW_TOGGLE = 'aggregation.pathfinderbackend-ext-grafana-app.enabled';
const OLD_TOGGLE = 'aggregation.pathfinderbackend-ext-grafana-com.enabled';
const NEW_V = 'pathfinderbackend.ext.grafana.app/v1alpha1';
const OLD_V = 'pathfinderbackend.ext.grafana.com/v1alpha1';

beforeEach(() => {
  jest.clearAllMocks();
  mockToggles = {};
});

describe('availability resolution', () => {
  it.each([
    [{ [NEW_TOGGLE]: true, [OLD_TOGGLE]: true }, true, true],
    [{ [NEW_TOGGLE]: true }, true, false],
    [{ [OLD_TOGGLE]: true }, false, true],
    [{}, false, false],
  ])('toggles %o → new=%s old=%s', (toggles, newAvailable, oldAvailable) => {
    mockToggles = toggles as Record<string, boolean>;
    expect(resolveAvailability()).toEqual({ newAvailable, oldAvailable });
    expect(isBackendApiAvailable()).toBe(newAvailable || oldAvailable);
  });
});

describe('url + apiVersion builders', () => {
  it('derives apiVersion per group', () => {
    expect(apiVersionFor('new')).toBe(NEW_V);
    expect(apiVersionFor('old')).toBe(OLD_V);
  });

  it('builds collection and item URLs, encoding the name', () => {
    expect(collectionUrl(NEW_V, 'stacks-1')).toBe(`/apis/${NEW_V}/namespaces/stacks-1/interactiveguides`);
    expect(itemUrl(NEW_V, 'stacks-1', '../x')).toBe(
      `/apis/${NEW_V}/namespaces/stacks-1/interactiveguides/${encodeURIComponent('../x')}`
    );
  });
});

describe('readItemWithFallback', () => {
  const build = (v: string) => itemUrl(v, 'ns', 'g1');

  it('returns unavailable when neither group is on, without fetching', async () => {
    const result = await readItemWithFallback(build);
    expect(result).toEqual({ ok: false, reason: 'unavailable' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('reads the new group first when available', async () => {
    mockToggles = { [NEW_TOGGLE]: true, [OLD_TOGGLE]: true };
    mockFetch.mockReturnValueOnce(of({ data: { id: 'from-new' } }));

    const result = await readItemWithFallback<{ id: string }>(build);

    expect(result).toEqual({ ok: true, data: { id: 'from-new' }, group: 'new' });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0]![0].url).toContain(NEW_V);
  });

  it('falls back to the old group when new returns an unavailable status (404)', async () => {
    mockToggles = { [NEW_TOGGLE]: true, [OLD_TOGGLE]: true };
    mockFetch
      .mockReturnValueOnce(throwError(() => ({ status: 404 })))
      .mockReturnValueOnce(of({ data: { id: 'from-old' } }));

    const result = await readItemWithFallback<{ id: string }>(build);

    expect(result).toEqual({ ok: true, data: { id: 'from-old' }, group: 'old' });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[1]![0].url).toContain(OLD_V);
  });

  it('re-throws a genuine (non-unavailable) error instead of falling back', async () => {
    mockToggles = { [NEW_TOGGLE]: true, [OLD_TOGGLE]: true };
    mockFetch.mockReturnValueOnce(throwError(() => ({ status: 500 })));

    await expect(readItemWithFallback(build)).rejects.toEqual({ status: 500 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns unavailable when both groups 404', async () => {
    mockToggles = { [NEW_TOGGLE]: true, [OLD_TOGGLE]: true };
    mockFetch
      .mockReturnValueOnce(throwError(() => ({ status: 404 })))
      .mockReturnValueOnce(throwError(() => ({ status: 404 })));

    expect(await readItemWithFallback(build)).toEqual({ ok: false, reason: 'unavailable' });
  });
});

describe('readListMerged', () => {
  const build = (v: string) => collectionUrl(v, 'ns');

  it('returns [] when neither group is available', async () => {
    expect(await readListMerged(build)).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('unions both groups deduped by metadata.name, new winning', async () => {
    mockToggles = { [NEW_TOGGLE]: true, [OLD_TOGGLE]: true };
    mockFetch
      .mockReturnValueOnce(of({ data: { items: [{ metadata: { name: 'a' }, v: 'new' }] } }))
      .mockReturnValueOnce(
        of({ data: { items: [{ metadata: { name: 'a' }, v: 'old' }, { metadata: { name: 'b' } }] } })
      );

    const items = await readListMerged<{ metadata: { name: string }; v?: string }>(build);

    expect(items).toHaveLength(2);
    expect(items.find((i) => i.metadata.name === 'a')!.v).toBe('new');
    expect(items.some((i) => i.metadata.name === 'b')).toBe(true);
  });

  it('surfaces old-group items when the new group is available but empty (pre-backfill)', async () => {
    mockToggles = { [NEW_TOGGLE]: true, [OLD_TOGGLE]: true };
    mockFetch
      .mockReturnValueOnce(of({ data: { items: [] } }))
      .mockReturnValueOnce(of({ data: { items: [{ metadata: { name: 'b' } }] } }));

    const items = await readListMerged<{ metadata: { name: string } }>(build);
    expect(items).toEqual([{ metadata: { name: 'b' } }]);
  });

  it('re-throws a genuine error', async () => {
    mockToggles = { [NEW_TOGGLE]: true };
    mockFetch.mockReturnValueOnce(throwError(() => ({ status: 500 })));
    await expect(readListMerged(build)).rejects.toEqual({ status: 500 });
  });
});

describe('dualWrite', () => {
  const build = (v: string) => itemUrl(v, 'ns', 'g1');

  it('throws when neither group is available', async () => {
    await expect(dualWrite({ method: 'PUT', buildUrl: build })).rejects.toThrow('not available');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('writes to both groups new-first with the correct apiVersion per body', async () => {
    mockToggles = { [NEW_TOGGLE]: true, [OLD_TOGGLE]: true };
    mockFetch.mockReturnValue(of({ data: {} }));

    const result = await dualWrite({
      method: 'POST',
      buildUrl: (v) => collectionUrl(v, 'ns'),
      buildBody: (v) => ({ apiVersion: v }),
    });

    expect(result).toEqual({ primaryGroup: 'new', secondaryFailures: [] });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0]![0].data.apiVersion).toBe(NEW_V);
    expect(mockFetch.mock.calls[0]![0].url).toContain(NEW_V);
    expect(mockFetch.mock.calls[1]![0].data.apiVersion).toBe(OLD_V);
  });

  it('writes only the old group when only old is available (old is primary)', async () => {
    mockToggles = { [OLD_TOGGLE]: true };
    mockFetch.mockReturnValue(of({ data: {} }));

    const result = await dualWrite({ method: 'DELETE', buildUrl: build });

    expect(result.primaryGroup).toBe('old');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0]![0].url).toContain(OLD_V);
  });

  it('tolerates a secondary failure: resolves, records it, and warns', async () => {
    mockToggles = { [NEW_TOGGLE]: true, [OLD_TOGGLE]: true };
    mockFetch
      .mockReturnValueOnce(of({ data: {} })) // new (primary) ok
      .mockReturnValueOnce(throwError(() => ({ status: 409 }))); // old (secondary) fails

    const result = await dualWrite({ method: 'PUT', buildUrl: build });

    expect(result).toEqual({ primaryGroup: 'new', secondaryFailures: ['old'] });
    expect(mockWarn).toHaveBeenCalledTimes(1);
  });

  it('throws on primary failure and never attempts the secondary', async () => {
    mockToggles = { [NEW_TOGGLE]: true, [OLD_TOGGLE]: true };
    mockFetch.mockReturnValueOnce(throwError(() => ({ status: 500 })));

    await expect(dualWrite({ method: 'PUT', buildUrl: build })).rejects.toEqual({ status: 500 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
