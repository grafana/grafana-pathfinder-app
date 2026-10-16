import { logger } from '../../lib/logging';
import { recordKioskCatalogLoaded } from '../../lib/telemetry';
import { reportAppInteraction, UserInteraction } from '../../lib/analytics';
import { getKioskName, startKioskSession } from '../../lib/kiosk-analytics';
jest.mock('../../lib/analytics', () => ({
  reportAppInteraction: jest.fn(),
  UserInteraction: { KioskCatalogLoaded: 'kiosk_catalog_loaded' },
}));
jest.mock('../../lib/logging', () => ({ logger: { warn: jest.fn() } }));
jest.mock('../../lib/telemetry', () => ({ recordKioskCatalogLoaded: jest.fn() }));
import { BUNDLED_KIOSK_RULES, DEFAULT_BANNER, DEFAULT_KIOSK_URL, loadKioskData, prepareKioskData } from './kiosk-rules';
import demo from '../../../docs/examples/kiosk/dem.json';

const defaultUrl = 'https://catalog.example.com/default.json';
const overrideUrl = 'https://catalog.example.com/custom.json';
const rule = { title: 'A guide', url: 'bundled:welcome', description: 'Learn Grafana' };
const mockFetch = jest.fn();
const response = (title: string) => ({ ok: true, json: async () => ({ banner: title, rules: [{ ...rule, title }] }) });

beforeEach(() => {
  jest.clearAllMocks();
  mockFetch.mockReset();
  global.fetch = mockFetch;
});

afterEach(() => {
  expect(jest.mocked(reportAppInteraction).mock.calls).toEqual(
    jest
      .mocked(recordKioskCatalogLoaded)
      .mock.calls.map(([tier, degraded]) => [
        UserInteraction.KioskCatalogLoaded,
        expect.objectContaining({ tier, degraded }),
      ])
  );
});

it('reports the catalog outcome with the opening session and no catalog contents', async () => {
  mockFetch.mockResolvedValue(response('Private catalog title'));
  await loadKioskData(defaultUrl, overrideUrl, undefined, { sessionId: 'opening-session', mode: 'instance' });
  expect(reportAppInteraction).toHaveBeenCalledWith(UserInteraction.KioskCatalogLoaded, {
    tier: 'override',
    kiosk_name: 'custom',
    degraded: false,
    kiosk_session_id: 'opening-session',
    launch_mode: 'instance',
  });
});

it('names the served fallback catalog instead of the failed requested kiosk', async () => {
  const session = startKioskSession('dem');
  mockFetch.mockRejectedValue(new Error('unavailable'));
  await loadKioskData(defaultUrl, undefined, undefined, { sessionId: session.id, mode: 'instance' });
  expect(getKioskName()).toBe('default');
  expect(reportAppInteraction).toHaveBeenCalledWith(
    UserInteraction.KioskCatalogLoaded,
    expect.objectContaining({ tier: 'bundled', degraded: true, kiosk_name: 'default' })
  );
  session.end();
});

it('uses the override first and does not fetch the default', async () => {
  mockFetch.mockResolvedValue(response('Custom kiosk'));
  const result = await loadKioskData(defaultUrl, overrideUrl);
  expect(result.rules[0]?.title).toBe('Custom kiosk');
  expect(result.warning).toBeUndefined();
  expect(mockFetch).toHaveBeenCalledTimes(1);
  expect(mockFetch).toHaveBeenCalledWith(
    overrideUrl,
    expect.objectContaining({ credentials: 'omit', redirect: 'error' })
  );
});

it('uses the configured default when no override is supplied', async () => {
  mockFetch.mockResolvedValue(response('Default kiosk'));
  const result = await loadKioskData(defaultUrl);
  expect(result.rules[0]?.title).toBe('Default kiosk');
  expect(result.warning).toBeUndefined();
  expect(mockFetch).toHaveBeenCalledWith(defaultUrl, expect.anything());
});

it.each([{ rules: [rule] }, demo])('loads an exit label from a catalog', async (catalog) => {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ ...catalog, exitButtonLabel: '  Explore all options  ' }),
  });
  expect((await loadKioskData(defaultUrl, overrideUrl)).exitButtonLabel).toBe('Explore all options');
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

it.each(['', '   ', 42, null, 'x'.repeat(201)])('falls back after an invalid exit label %j', async (label) => {
  mockFetch
    .mockResolvedValueOnce({ ok: true, json: async () => ({ rules: [rule], exitButtonLabel: label }) })
    .mockResolvedValueOnce(response('Default kiosk'));
  const result = await loadKioskData(defaultUrl, overrideUrl);
  expect(result.exitButtonLabel).toBeUndefined();
  expect(result.rules[0]?.title).toBe('Default kiosk');
  expect(result.warning).toBeDefined();
});

it.each(['https://evil.example.com/custom.json', 'javascript:alert(1)', 'not-a-url'])(
  'falls back without fetching rejected override %s',
  async (override) => {
    mockFetch.mockResolvedValue(response('Default kiosk'));
    const result = await loadKioskData(defaultUrl, override);
    expect(result.rules[0]?.title).toBe('Default kiosk');
    expect(result.warning).toBe('The requested kiosk could not be loaded. Showing the configured default kiosk.');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(defaultUrl, expect.anything());
  }
);

it.each([
  ['HTTP failure', () => Promise.resolve({ ok: false, status: 404 })],
  ['network or redirect rejection', () => Promise.reject(new TypeError('Failed to fetch'))],
  ['timeout', () => Promise.reject(new DOMException('Timed out', 'TimeoutError'))],
  [
    'invalid JSON',
    () =>
      Promise.resolve({
        ok: true,
        json: async () => {
          throw new SyntaxError('JSON');
        },
      }),
  ],
  ['empty rules', () => Promise.resolve({ ok: true, json: async () => ({ rules: [] }) })],
])('tries the configured default after %s', async (_label, fail) => {
  mockFetch.mockImplementationOnce(fail).mockResolvedValueOnce(response('Default kiosk'));
  const result = await loadKioskData(defaultUrl, overrideUrl);
  expect(result.rules[0]?.title).toBe('Default kiosk');
  expect(result.warning).toBe('The requested kiosk could not be loaded. Showing the configured default kiosk.');
  expect(mockFetch.mock.calls.map(([url]) => url)).toEqual([overrideUrl, defaultUrl]);
});

it('names both requested and configured failures when all catalogs fail', async () => {
  mockFetch.mockRejectedValue(new Error('offline'));
  const result = await loadKioskData(defaultUrl, overrideUrl);
  expect(result.rules).toBe(BUNDLED_KIOSK_RULES);
  expect(result.banner).toBe(DEFAULT_BANNER);
  expect(result.warning).toBe(
    'The requested kiosk and the configured default kiosk could not be loaded. Showing bundled guides.'
  );
  expect(mockFetch.mock.calls.map(([url]) => url)).toEqual([overrideUrl, defaultUrl, DEFAULT_KIOSK_URL]);
  expect(recordKioskCatalogLoaded).toHaveBeenCalledTimes(1);
  expect(recordKioskCatalogLoaded).toHaveBeenCalledWith('bundled', true);
});

it('does not blame the skipped configured tier when matching requested and configured URLs fail', async () => {
  mockFetch.mockRejectedValue(new Error('offline'));
  const result = await loadKioskData(defaultUrl, defaultUrl);
  expect(result.rules).toBe(BUNDLED_KIOSK_RULES);
  expect(result.banner).toBe(DEFAULT_BANNER);
  expect(result.warning).toBe('The requested kiosk could not be loaded. Showing bundled guides.');
  expect(mockFetch.mock.calls.map(([url]) => url)).toEqual([defaultUrl, DEFAULT_KIOSK_URL]);
  expect(recordKioskCatalogLoaded).toHaveBeenCalledTimes(1);
  expect(recordKioskCatalogLoaded).toHaveBeenCalledWith('bundled', true);
});

it('reports only the requested failure when every catalog URL matches', async () => {
  mockFetch.mockRejectedValue(new Error('offline'));
  const result = await loadKioskData(DEFAULT_KIOSK_URL, DEFAULT_KIOSK_URL);
  expect(result.rules).toBe(BUNDLED_KIOSK_RULES);
  expect(result.banner).toBe(DEFAULT_BANNER);
  expect(result.warning).toBe('The requested kiosk could not be loaded. Showing bundled guides.');
  expect(mockFetch.mock.calls.map(([url]) => url)).toEqual([DEFAULT_KIOSK_URL]);
  expect(recordKioskCatalogLoaded).toHaveBeenCalledTimes(1);
  expect(recordKioskCatalogLoaded).toHaveBeenCalledWith('bundled', true);
});

it('uses bundled guides without a network request or warning when nothing is configured', async () => {
  mockFetch.mockResolvedValue(response('Generic kiosk'));
  const result = await loadKioskData('');
  expect(result.rules).toBe(BUNDLED_KIOSK_RULES);
  expect(result.warning).toBeUndefined();
  expect(mockFetch).not.toHaveBeenCalled();
  expect(recordKioskCatalogLoaded).toHaveBeenCalledWith('bundled', false);
});

it('recovers through the generic catalog after override and configured default fail', async () => {
  mockFetch
    .mockRejectedValueOnce(new Error('missing'))
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(response('Generic kiosk'));
  const result = await loadKioskData(defaultUrl, overrideUrl);
  expect(result.rules[0]?.title).toBe('Generic kiosk');
  expect(result.warning).toBe(
    'The requested kiosk and the configured default kiosk could not be loaded. Showing the generic learning kiosk.'
  );
  expect(recordKioskCatalogLoaded).toHaveBeenCalledTimes(1);
  expect(recordKioskCatalogLoaded).toHaveBeenCalledWith('generic', true);
  expect(mockFetch.mock.calls.map(([url]) => url)).toEqual([overrideUrl, defaultUrl, DEFAULT_KIOSK_URL]);
});

it('names a rejected selection and failed configured catalog when the generic catalog serves', async () => {
  mockFetch.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(response('Generic kiosk'));
  const result = await loadKioskData(defaultUrl, 'https://untrusted.example/rules.json');
  expect(result.rules[0]?.title).toBe('Generic kiosk');
  expect(result.warning).toBe(
    'The requested kiosk and the configured default kiosk could not be loaded. Showing the generic learning kiosk.'
  );
  expect(mockFetch.mock.calls.map(([url]) => url)).toEqual([defaultUrl, DEFAULT_KIOSK_URL]);
  expect(recordKioskCatalogLoaded).toHaveBeenCalledTimes(1);
  expect(recordKioskCatalogLoaded).toHaveBeenCalledWith('generic', true);
});

it('names a rejected selection and failed configured catalog when bundled guides serve', async () => {
  mockFetch.mockRejectedValue(new Error('offline'));
  const result = await loadKioskData(defaultUrl, 'https://untrusted.example/rules.json');
  expect(result.rules).toBe(BUNDLED_KIOSK_RULES);
  expect(result.banner).toBe(DEFAULT_BANNER);
  expect(result.warning).toBe(
    'The requested kiosk and the configured default kiosk could not be loaded. Showing bundled guides.'
  );
  expect(mockFetch.mock.calls.map(([url]) => url)).toEqual([defaultUrl, DEFAULT_KIOSK_URL]);
  expect(recordKioskCatalogLoaded).toHaveBeenCalledTimes(1);
  expect(recordKioskCatalogLoaded).toHaveBeenCalledWith('bundled', true);
});

it('reports only the requested failure when matching URLs fall back to the generic catalog', async () => {
  mockFetch.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(response('Generic kiosk'));
  const result = await loadKioskData(defaultUrl, defaultUrl);
  expect(result.rules[0]?.title).toBe('Generic kiosk');
  expect(result.warning).toBe('The requested kiosk could not be loaded. Showing the generic learning kiosk.');
  expect(mockFetch.mock.calls.map(([url]) => url)).toEqual([defaultUrl, DEFAULT_KIOSK_URL]);
  expect(recordKioskCatalogLoaded).toHaveBeenCalledTimes(1);
  expect(recordKioskCatalogLoaded).toHaveBeenCalledWith('generic', true);
});

it('reports only the configured failure when configured and generic catalogs fail without a selection', async () => {
  mockFetch.mockRejectedValue(new Error('offline'));
  const result = await loadKioskData(defaultUrl);
  expect(result.rules).toBe(BUNDLED_KIOSK_RULES);
  expect(result.banner).toBe(DEFAULT_BANNER);
  expect(result.warning).toBe('The configured kiosk could not be loaded. Showing bundled guides.');
  expect(mockFetch.mock.calls.map(([url]) => url)).toEqual([defaultUrl, DEFAULT_KIOSK_URL]);
  expect(recordKioskCatalogLoaded).toHaveBeenCalledTimes(1);
  expect(recordKioskCatalogLoaded).toHaveBeenCalledWith('bundled', true);
});

it('reports only the configured failure when its URL matches the skipped generic catalog', async () => {
  mockFetch.mockRejectedValue(new Error('offline'));
  const result = await loadKioskData(DEFAULT_KIOSK_URL);
  expect(result.rules).toBe(BUNDLED_KIOSK_RULES);
  expect(result.banner).toBe(DEFAULT_BANNER);
  expect(result.warning).toBe('The configured kiosk could not be loaded. Showing bundled guides.');
  expect(mockFetch.mock.calls.map(([url]) => url)).toEqual([DEFAULT_KIOSK_URL]);
  expect(recordKioskCatalogLoaded).toHaveBeenCalledTimes(1);
  expect(recordKioskCatalogLoaded).toHaveBeenCalledWith('bundled', true);
});

it('names requested and configured failures when the configured URL matches the skipped generic catalog', async () => {
  const trustedSelection = 'https://interactive-learning.grafana.net/custom.json';
  mockFetch.mockRejectedValue(new Error('offline'));
  const result = await loadKioskData(DEFAULT_KIOSK_URL, trustedSelection);
  expect(result.rules).toBe(BUNDLED_KIOSK_RULES);
  expect(result.banner).toBe(DEFAULT_BANNER);
  expect(result.warning).toBe(
    'The requested kiosk and the configured default kiosk could not be loaded. Showing bundled guides.'
  );
  expect(mockFetch.mock.calls.map(([url]) => url)).toEqual([trustedSelection, DEFAULT_KIOSK_URL]);
  expect(recordKioskCatalogLoaded).toHaveBeenCalledTimes(1);
  expect(recordKioskCatalogLoaded).toHaveBeenCalledWith('bundled', true);
});

it('supports legacy arrays, defaults the type, and drops unsafe tiles', async () => {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => [rule, { ...rule, url: 'javascript:alert(1)' }, { ...rule, targetUrl: 'javascript:alert(1)' }],
  });
  expect((await loadKioskData(defaultUrl)).rules).toEqual([{ ...rule, type: 'guide' }]);
});

it('does not start fallback requests after cancellation', async () => {
  const controller = new AbortController();
  mockFetch.mockImplementationOnce(async () => {
    controller.abort();
    throw new Error('aborted');
  });
  await expect(loadKioskData(defaultUrl, overrideUrl, controller.signal)).rejects.toThrow();
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

it.each([undefined, '', '   '])('uses the learning banner when the catalog banner is %s', async (banner) => {
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ rules: [rule], banner }) });
  expect((await loadKioskData(defaultUrl)).banner).toBe(DEFAULT_BANNER);
});

it('logs rejected fields without catalog values', async () => {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ rules: [rule, { ...rule, page: '//private.example' }] }),
  });
  await loadKioskData(defaultUrl);
  expect(logger.warn).toHaveBeenCalledWith('Kiosk catalog rule rejected', { tier: 'configured', field: 'page' });
});

it.each([
  [new SyntaxError('private payload'), 'invalid_json'],
  [new DOMException('private payload', 'TimeoutError'), 'timeout'],
  [new TypeError('private payload'), 'network'],
])('classifies failures without emitting raw errors', async (error, reason) => {
  mockFetch.mockRejectedValueOnce(error).mockResolvedValueOnce(response('Default kiosk'));
  await loadKioskData(defaultUrl, overrideUrl);
  expect(logger.warn).toHaveBeenCalledWith('Kiosk catalog load failed', { tier: 'override', reason });
  expect(recordKioskCatalogLoaded).toHaveBeenCalledWith('configured', true);
});

it('reports HTTP failures and the actual generic fallback without an override', async () => {
  mockFetch.mockResolvedValueOnce({ ok: false, status: 404 }).mockResolvedValueOnce(response('Generic kiosk'));
  const result = await loadKioskData(defaultUrl);
  expect(logger.warn).toHaveBeenCalledWith('Kiosk catalog load failed', { tier: 'configured', reason: 'http' });
  expect(result.warning).toBe('The configured kiosk could not be loaded. Showing the generic learning kiosk.');
});

it('fetches a trusted selection and uses bundled guides without a generic fallback when no default is configured', async () => {
  const trustedSelection = 'https://interactive-learning.grafana.net/custom.json';
  mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));

  const result = await loadKioskData('', trustedSelection);

  expect(result.rules).toBe(BUNDLED_KIOSK_RULES);
  expect(result.warning).toBe('The requested kiosk could not be loaded. Showing bundled guides.');
  expect(mockFetch.mock.calls.map(([url]) => url)).toEqual([trustedSelection]);
  expect(recordKioskCatalogLoaded).toHaveBeenCalledWith('bundled', true);
});

it('falls directly back to bundled guides after a rejected override with no configured catalog', async () => {
  const result = await loadKioskData('', 'https://untrusted.example/rules.json');
  expect(result.rules).toBe(BUNDLED_KIOSK_RULES);
  expect(result.warning).toBe('The requested kiosk could not be loaded. Showing bundled guides.');
  expect(mockFetch).not.toHaveBeenCalled();
  expect(recordKioskCatalogLoaded).toHaveBeenCalledWith('bundled', true);
});

it('does not report cancellation as degradation or successful loading', async () => {
  const controller = new AbortController();
  mockFetch.mockImplementationOnce(async () => {
    controller.abort();
    return response('Late response');
  });
  await expect(loadKioskData(defaultUrl, undefined, controller.signal)).rejects.toThrow();
  expect(logger.warn).not.toHaveBeenCalled();
  expect(recordKioskCatalogLoaded).not.toHaveBeenCalled();
});

it('accepts a navigation-only rule without validating or fetching its ignored guide URL', async () => {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ rules: [{ ...rule, url: 'unused', interactiveLearning: false, page: '/a/product' }] }),
  });
  const result = await loadKioskData(defaultUrl);
  expect(result.rules[0]?.interactiveLearning).toBe(false);
  expect(result.warning).toBeUndefined();
  expect(mockFetch).toHaveBeenCalledTimes(1);
});
it.each([undefined, '//evil.example', 'javascript:alert(1)'])(
  'rejects navigation-only page %s at catalog load',
  async (page) => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ rules: [{ ...rule, interactiveLearning: false, page }] }),
    });
    expect((await loadKioskData(defaultUrl)).warning).toBeDefined();
  }
);

it('prepares a catalog without recording a view and reuses it for the mounted session', async () => {
  mockFetch.mockResolvedValue(response('Prefetched guide'));
  const prepared = prepareKioskData(defaultUrl);
  await prepared;
  expect(recordKioskCatalogLoaded).not.toHaveBeenCalled();
  expect(reportAppInteraction).not.toHaveBeenCalled();
  const session = startKioskSession('initial');
  try {
    const data = await loadKioskData(
      defaultUrl,
      undefined,
      undefined,
      { sessionId: session.id, mode: 'instance' },
      prepared
    );
    expect(data.rules[0]?.title).toBe('Prefetched guide');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(reportAppInteraction).toHaveBeenCalledWith(
      UserInteraction.KioskCatalogLoaded,
      expect.objectContaining({ kiosk_session_id: session.id })
    );
  } finally {
    session.end();
  }
});

it('does not record a prepared catalog after the view has been cancelled', async () => {
  mockFetch.mockResolvedValue(response('Cancelled guide'));
  const prepared = prepareKioskData(defaultUrl);
  await prepared;
  const controller = new AbortController();
  controller.abort();
  await expect(loadKioskData(defaultUrl, undefined, controller.signal, undefined, prepared)).rejects.toThrow();
  expect(recordKioskCatalogLoaded).not.toHaveBeenCalled();
});
