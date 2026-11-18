import { config } from '@grafana/runtime';

import { hashString } from '../../../lib/hash.util';
import { resolveTenantSettings } from '../../resolve-tenant-settings';
import { createCohortMembershipReader } from './cohort-membership';

jest.mock('@grafana/runtime', () => ({
  config: {
    namespace: 'stacks-123',
    analytics: { enabled: true },
    bootData: { user: { id: 42, orgId: 1, isSignedIn: true, email: 'Case@Example.com' } },
  },
}));
jest.mock('../../../lib/hash.util', () => ({ hashString: jest.fn() }));
jest.mock('../../resolve-tenant-settings', () => ({ resolveTenantSettings: jest.fn() }));
jest.mock('../../dev-mode', () => ({ isDevModeEnabled: () => false }));

const mockFetch = jest.fn();
const onChange = jest.fn();
let reader: ReturnType<typeof createCohortMembershipReader>;
const settings = (overrides = {}) => ({
  config: { pathfinderEnabled: true, acceptedTermsAndConditions: true, ...overrides },
});
const settle = async () => {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  global.fetch = mockFetch;
  config.namespace = 'stacks-123';
  config.analytics.enabled = true;
  config.bootData.user.id = 42;
  config.bootData.user.orgId = 1;
  config.bootData.user.isSignedIn = true;
  config.bootData.user.email = 'Case@Example.com';
  jest.mocked(hashString).mockResolvedValue('a'.repeat(64));
  jest.mocked(resolveTenantSettings).mockResolvedValue(settings() as never);
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ cohorts: ['billing', 'alerts'] }) });
  reader = createCohortMembershipReader(onChange);
});
afterEach(() => {
  reader.dispose();
  jest.useRealTimers();
});

it('sends only the exact-email hash and matches all returned memberships exactly', async () => {
  reader.refresh();
  await settle();
  expect(hashString).toHaveBeenCalledWith('Case@Example.com');
  const [url, options] = mockFetch.mock.calls[0];
  expect(url.toString()).toBe('https://recommender.grafana.com/api/v1/cohorts');
  expect(options).toEqual(
    expect.objectContaining({
      method: 'POST',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email_hash: 'a'.repeat(64) }),
    })
  );
  expect(reader.has('billing')).toBe(true);
  expect(reader.has('alerts')).toBe(true);
  expect(reader.has('Billing')).toBe(false);
  expect(reader.has('unknown')).toBe(false);
  expect(onChange).toHaveBeenCalledTimes(1);
});

it('deduplicates pending requests and caches successful results including empty membership', async () => {
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ cohorts: [] }) });
  reader.refresh();
  reader.refresh();
  await settle();
  jest.advanceTimersByTime(60000);
  reader.refresh();
  await settle();
  expect(mockFetch).toHaveBeenCalledTimes(1);
  expect(reader.has('billing')).toBe(false);
});

it.each([404, 429, 503])('fails closed on HTTP %s and retries only after cooldown on demand', async (status) => {
  mockFetch.mockResolvedValueOnce({ ok: false, status });
  reader.refresh();
  await settle();
  expect(reader.has('billing')).toBe(false);
  reader.refresh();
  await settle();
  expect(mockFetch).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(30000);
  await settle();
  expect(mockFetch).toHaveBeenCalledTimes(1);
  reader.refresh();
  await settle();
  expect(mockFetch).toHaveBeenCalledTimes(2);
  expect(reader.has('billing')).toBe(true);
});

it.each([null, [], {}, { cohorts: 'billing' }, { cohorts: ['billing', 1] }])(
  'rejects malformed response %p',
  async (payload) => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => payload });
    reader.refresh();
    await settle();
    expect(reader.has('billing')).toBe(false);
  }
);

it.each(['settings', 'hash', 'fetch', 'json'])('contains %s failures', async (stage) => {
  const error = new Error('private data must not be logged');
  if (stage === 'settings') {
    jest.mocked(resolveTenantSettings).mockRejectedValueOnce(error);
  }
  if (stage === 'hash') {
    jest.mocked(hashString).mockRejectedValueOnce(error);
  }
  if (stage === 'fetch') {
    mockFetch.mockRejectedValueOnce(error);
  }
  if (stage === 'json') {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => {
        throw error;
      },
    });
  }
  reader.refresh();
  await settle();
  expect(reader.has('billing')).toBe(false);
});

it.each([
  { acceptedTermsAndConditions: false },
  { pathfinderEnabled: false },
  { recommenderServiceUrl: 'http://recommender.grafana.com' },
  { recommenderServiceUrl: 'https://recommender.grafana.com.attacker.example' },
  { recommenderServiceUrl: 'https://user:secret@recommender.grafana.com' },
  { recommenderServiceUrl: 'javascript:alert(1)' },
])('does not send identity when settings reject the lookup: %p', async (overrides) => {
  jest.mocked(resolveTenantSettings).mockResolvedValue(settings(overrides) as never);
  reader.refresh();
  await settle();
  expect(mockFetch).not.toHaveBeenCalled();
  expect(hashString).not.toHaveBeenCalled();
});

it.each(['email', 'signed-out', 'analytics', 'namespace'])('skips lookup without %s eligibility', async (condition) => {
  if (condition === 'email') {
    config.bootData.user.email = '';
  }
  if (condition === 'signed-out') {
    config.bootData.user.isSignedIn = false;
  }
  if (condition === 'analytics') {
    config.analytics.enabled = false;
  }
  if (condition === 'namespace') {
    config.namespace = '';
  }
  reader.dispose();
  reader = createCohortMembershipReader(onChange);
  reader.refresh();
  await settle();
  expect(resolveTenantSettings).not.toHaveBeenCalled();
  expect(mockFetch).not.toHaveBeenCalled();
});

it('aborts a hung request after five seconds and ignores its late response', async () => {
  let resolve!: (value: unknown) => void;
  mockFetch.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    })
  );
  reader.refresh();
  await settle();
  const signal = mockFetch.mock.calls[0][1].signal as AbortSignal;
  jest.advanceTimersByTime(5000);
  await settle();
  expect(signal.aborted).toBe(true);
  resolve({ ok: true, json: async () => ({ cohorts: ['billing'] }) });
  await settle();
  expect(reader.has('billing')).toBe(false);
  jest.advanceTimersByTime(30000);
  reader.refresh();
  await settle();
  expect(reader.has('billing')).toBe(true);
});

it('times out settings resolution without allowing a late identity request', async () => {
  let resolve!: (value: never) => void;
  jest.mocked(resolveTenantSettings).mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    })
  );
  reader.refresh();
  jest.advanceTimersByTime(5000);
  await settle();
  resolve(settings() as never);
  await settle();
  expect(mockFetch).not.toHaveBeenCalled();
});

it.each(['user', 'organization', 'email', 'dispose'])('ignores a response after %s changes', async (change) => {
  let resolve!: (value: unknown) => void;
  mockFetch.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    })
  );
  reader.refresh();
  await settle();
  if (change === 'user') {
    config.bootData.user.id = 43;
  }
  if (change === 'organization') {
    config.bootData.user.orgId = 2;
  }
  if (change === 'email') {
    config.bootData.user.email = 'next@example.com';
  }
  if (change === 'dispose') {
    reader.dispose();
  }
  resolve({ ok: true, json: async () => ({ cohorts: ['billing'] }) });
  await settle();
  expect(reader.has('billing')).toBe(false);
  expect(onChange).not.toHaveBeenCalled();
});

it('invalidates cached membership immediately when identity changes', async () => {
  reader.refresh();
  await settle();
  expect(reader.has('billing')).toBe(true);
  config.bootData.user.orgId = 2;
  expect(reader.has('billing')).toBe(false);
});
