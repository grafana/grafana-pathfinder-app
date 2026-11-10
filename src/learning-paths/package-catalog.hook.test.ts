import { act, renderHook, waitFor } from '@testing-library/react';
import { config } from '@grafana/runtime';
import { fetchCustomGuideCatalogue } from '../lib/custom-guide-repository-client';
import { fetchOnlinePackageRecommendations } from '../lib/package-recommendations-client';
import { usePackageCatalog } from './package-catalog.hook';
import { fetchEligibleCatalog } from '../lib/eligible-catalog-client';

jest.mock('@grafana/runtime', () => ({ config: { namespace: 'org-a', bootData: { user: { id: 1, orgId: 1 } } } }));
jest.mock('./paths-data', () => ({ getPathsData: () => ({ paths: [], guideMetadata: {} }) }));
jest.mock('../lib/custom-guide-repository-client', () => ({ fetchCustomGuideCatalogue: jest.fn() }));
jest.mock('../lib/eligible-catalog-client', () => ({ fetchEligibleCatalog: jest.fn() }));
jest.mock('../lib/package-recommendations-client', () => ({
  ...jest.requireActual('../lib/package-recommendations-client'),
  fetchOnlinePackageRecommendations: jest.fn(),
}));

beforeEach(() => {
  config.namespace = 'org-a';
  jest.mocked(fetchOnlinePackageRecommendations).mockResolvedValue({ baseUrl: '', packages: [], available: false });
  jest.mocked(fetchCustomGuideCatalogue).mockResolvedValue({ entries: [], available: true });
  jest.mocked(fetchEligibleCatalog).mockResolvedValue({ items: [], available: true });
});

it('retains bundled content when online content is unavailable', async () => {
  const { result } = renderHook(usePackageCatalog);
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.publicUnavailable).toBe(true);
  expect(result.current.items.some((item) => item.id === 'first-dashboard')).toBe(true);
});

it.each(['unsupported', 'feature-toggle-disabled', 'obo-unavailable', 'identity-unavailable', 'identity-unverifiable'])(
  'treats %s organization capability as absent rather than a retryable failure',
  async (reason) => {
    jest.mocked(fetchCustomGuideCatalogue).mockResolvedValue({ entries: [], available: false, reason });
    const { result } = renderHook(usePackageCatalog);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.privateUnavailable).toBe(false);
    expect(result.current.items.some((entry) => entry.source === 'organization')).toBe(false);
  }
);

it.each(['request-failed', 'upstream-503', 'signing-keys-unreachable', 'malformed-response', undefined])(
  'reports %s organization failure and retries with fresh catalog data',
  async (reason) => {
    jest.mocked(fetchCustomGuideCatalogue).mockResolvedValueOnce({ entries: [], available: false, reason });
    const { result } = renderHook(usePackageCatalog);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.privateUnavailable).toBe(true);
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.privateUnavailable).toBe(false);
    expect(fetchCustomGuideCatalogue).toHaveBeenLastCalledWith('org-a', { refresh: true });
    expect(fetchOnlinePackageRecommendations).toHaveBeenLastCalledWith({ refresh: true });
  }
);

it('never displays an old organization response after the scope changes', async () => {
  let finish: (value: Awaited<ReturnType<typeof fetchCustomGuideCatalogue>>) => void = () => {};
  jest.mocked(fetchCustomGuideCatalogue).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const { result, rerender } = renderHook(usePackageCatalog);
  config.namespace = 'org-b';
  rerender();
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => {
    finish({ available: true, entries: [{ id: 'old-private-guide', status: 'published', title: 'Private title' }] });
  });
  expect(result.current.items.some((item) => item.id === 'old-private-guide')).toBe(false);
  expect(result.current.scope).toMatch(/^org-b:/);
});

it('does not fetch or expose catalog items when disabled', () => {
  jest.clearAllMocks();
  const { result } = renderHook(() => usePackageCatalog({ enabled: false }));
  expect(result.current.items).toEqual([]);
  expect(result.current.loading).toBe(false);
  expect(fetchOnlinePackageRecommendations).not.toHaveBeenCalled();
  expect(fetchCustomGuideCatalogue).not.toHaveBeenCalled();
});

it('uses only eligible official IDs for discovery, preserving private guides', async () => {
  jest.mocked(fetchEligibleCatalog).mockResolvedValue({
    available: true,
    items: [
      {
        key: 'interactive-tutorials:first-dashboard',
        id: 'first-dashboard',
        title: 'First dashboard',
        format: 'guide',
        source: 'grafana',
        url: 'https://interactive-learning.grafana.net/packages/first-dashboard/content.json',
      },
    ],
  });
  jest.mocked(fetchCustomGuideCatalogue).mockResolvedValue({
    available: true,
    entries: [{ id: 'private-guide', title: 'Private guide', status: 'published' }],
  });
  jest.clearAllMocks();
  const { result } = renderHook(() =>
    usePackageCatalog({ discovery: { enabled: true, serviceUrl: 'https://recommender.grafana.com' } })
  );
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.items.map((item) => item.id)).toEqual(['first-dashboard', 'private-guide']);
  expect(result.current.items[0]?.key).toBe('bundled:first-dashboard');
  expect(fetchOnlinePackageRecommendations).not.toHaveBeenCalled();
});

it('keeps private content visible when public discovery is disabled, without calling either public catalog', async () => {
  jest.mocked(fetchCustomGuideCatalogue).mockResolvedValue({
    available: true,
    entries: [{ id: 'private-guide', title: 'Private guide', status: 'published' }],
  });
  jest.clearAllMocks();
  const { result } = renderHook(() =>
    usePackageCatalog({ discovery: { enabled: false, serviceUrl: 'https://recommender.grafana.com' } })
  );
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.items.map((item) => item.id)).toEqual(['private-guide']);
  expect(fetchEligibleCatalog).not.toHaveBeenCalled();
  expect(fetchOnlinePackageRecommendations).not.toHaveBeenCalled();
});

it('hides public content immediately on consent revocation without dropping private guides', async () => {
  jest.mocked(fetchEligibleCatalog).mockResolvedValue({
    available: true,
    items: [
      {
        key: 'official:public',
        id: 'public',
        title: 'Public',
        format: 'guide',
        source: 'grafana',
        url: 'https://interactive-learning.grafana.net/public/content.json',
      },
    ],
  });
  jest.mocked(fetchCustomGuideCatalogue).mockResolvedValue({
    available: true,
    entries: [{ id: 'private-guide', title: 'Private guide', status: 'published' }],
  });
  const { result, rerender } = renderHook(
    ({ consent }) =>
      usePackageCatalog({ discovery: { enabled: consent, serviceUrl: 'https://recommender.grafana.com' } }),
    { initialProps: { consent: true } }
  );
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.items).toHaveLength(2);
  rerender({ consent: false });
  expect(result.current.items.map((item) => item.id)).toEqual(['private-guide']);
});

it('does not accept a late public discovery response from a previous scope', async () => {
  let finish: (value: Awaited<ReturnType<typeof fetchEligibleCatalog>>) => void = () => {};
  jest.mocked(fetchEligibleCatalog).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const { result, rerender } = renderHook(() =>
    usePackageCatalog({ discovery: { enabled: true, serviceUrl: 'https://recommender.grafana.com' } })
  );
  config.namespace = 'org-b';
  rerender();
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => {
    finish({
      available: true,
      items: [
        {
          key: 'old:guide',
          id: 'old-guide',
          title: 'Old',
          format: 'guide',
          source: 'grafana',
          url: 'https://interactive-learning.grafana.net/old/content.json',
        },
      ],
    });
  });
  expect(result.current.items).toEqual([]);
});

it('fetches only public packages in public-only mode', async () => {
  jest.clearAllMocks();
  const { result } = renderHook(() => usePackageCatalog({ publicOnly: true }));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(fetchOnlinePackageRecommendations).toHaveBeenCalledTimes(1);
  expect(fetchCustomGuideCatalogue).not.toHaveBeenCalled();
  expect(result.current.items.every((item) => item.source === 'grafana')).toBe(true);
});
