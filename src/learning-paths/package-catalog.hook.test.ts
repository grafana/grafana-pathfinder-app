import { act, renderHook, waitFor } from '@testing-library/react';
import { config } from '@grafana/runtime';
import { fetchCustomGuideCatalogue } from '../lib/custom-guide-repository-client';
import { fetchOnlinePackageRecommendations } from '../lib/package-recommendations-client';
import { usePackageCatalog } from './package-catalog.hook';

jest.mock('@grafana/runtime', () => ({ config: { namespace: 'org-a', bootData: { user: { id: 1, orgId: 1 } } } }));
jest.mock('./paths-data', () => ({ getPathsData: () => ({ paths: [], guideMetadata: {} }) }));
jest.mock('../lib/custom-guide-repository-client', () => ({ fetchCustomGuideCatalogue: jest.fn() }));
jest.mock('../lib/package-recommendations-client', () => ({
  ...jest.requireActual('../lib/package-recommendations-client'),
  fetchOnlinePackageRecommendations: jest.fn(),
}));

beforeEach(() => {
  config.namespace = 'org-a';
  jest.mocked(fetchOnlinePackageRecommendations).mockResolvedValue({ baseUrl: '', packages: [], available: false });
  jest.mocked(fetchCustomGuideCatalogue).mockResolvedValue({ entries: [], available: true });
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
