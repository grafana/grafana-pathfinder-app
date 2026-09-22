import { BUNDLED_KIOSK_RULES, DEFAULT_BANNER, DEFAULT_KIOSK_URL, loadKioskData } from './kiosk-rules';

const defaultUrl = 'https://catalog.example.com/default.json';
const overrideUrl = 'https://catalog.example.com/custom.json';
const rule = { title: 'A guide', url: 'bundled:welcome', description: 'Learn Grafana' };
const mockFetch = jest.fn();
const response = (title: string) => ({ ok: true, json: async () => ({ banner: title, rules: [{ ...rule, title }] }) });

beforeEach(() => {
  mockFetch.mockReset();
  global.fetch = mockFetch;
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
  expect((await loadKioskData(defaultUrl)).rules[0]?.title).toBe('Default kiosk');
  expect(mockFetch).toHaveBeenCalledWith(defaultUrl, expect.anything());
});

it.each(['https://evil.example.com/custom.json', 'javascript:alert(1)', 'not-a-url'])(
  'falls back without fetching rejected override %s',
  async (override) => {
    mockFetch.mockResolvedValue(response('Default kiosk'));
    const result = await loadKioskData(defaultUrl, override);
    expect(result.rules[0]?.title).toBe('Default kiosk');
    expect(result.warning).toContain('default kiosk');
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
  expect(result.warning).toBeDefined();
  expect(mockFetch.mock.calls.map(([url]) => url)).toEqual([overrideUrl, defaultUrl]);
});

it('uses bundled guides when all catalogs fail and deduplicates matching URLs', async () => {
  mockFetch.mockRejectedValue(new Error('offline'));
  const result = await loadKioskData(defaultUrl, overrideUrl);
  expect(result.rules).toBe(BUNDLED_KIOSK_RULES);
  expect(result.banner).toBe(DEFAULT_BANNER);
  expect(result.warning).toContain('bundled');
  mockFetch.mockClear();
  await loadKioskData(defaultUrl, defaultUrl);
  expect(mockFetch.mock.calls.map(([url]) => url)).toEqual([defaultUrl, DEFAULT_KIOSK_URL]);
  mockFetch.mockClear();
  await loadKioskData(DEFAULT_KIOSK_URL, DEFAULT_KIOSK_URL);
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

it('loads the generic catalog without a warning when nothing is configured', async () => {
  mockFetch.mockResolvedValue(response('Generic kiosk'));
  const result = await loadKioskData('');
  expect(result.rules[0]?.title).toBe('Generic kiosk');
  expect(result.warning).toBeUndefined();
  expect(mockFetch).toHaveBeenCalledWith(DEFAULT_KIOSK_URL, expect.anything());
});

it('recovers through the generic catalog after override and configured default fail', async () => {
  mockFetch
    .mockRejectedValueOnce(new Error('missing'))
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(response('Generic kiosk'));
  const result = await loadKioskData(defaultUrl, overrideUrl);
  expect(result.rules[0]?.title).toBe('Generic kiosk');
  expect(result.warning).toContain('default kiosk');
  expect(mockFetch.mock.calls.map(([url]) => url)).toEqual([overrideUrl, defaultUrl, DEFAULT_KIOSK_URL]);
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
