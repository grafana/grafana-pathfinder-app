import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PackageBrowser } from './PackageBrowser';
import { updateCatalogView } from '../../global-state/package-browser';
import { fetchCustomGuideCatalogue } from '../../lib/custom-guide-repository-client';
import { fetchOnlinePackageRecommendations } from '../../lib/package-recommendations-client';

jest.mock('../../learning-paths', () => ({
  catalogIdentity: jest.requireActual('../../learning-paths/catalog-learning-core').catalogIdentity,
  selectLearningPathEntries: jest.requireActual('../../learning-paths/learning-path-entries').selectLearningPathEntries,
  usePackageCatalog: jest.requireActual('../../learning-paths/package-catalog.hook').usePackageCatalog,
  useCatalogProgress: () => new Map(),
}));
jest.mock('../../learning-paths/paths-data', () => ({ getPathsData: () => ({ paths: [], guideMetadata: {} }) }));
jest.mock('../../lib/custom-guide-repository-client', () => ({ fetchCustomGuideCatalogue: jest.fn() }));
jest.mock('../../lib/package-recommendations-client', () => ({
  ...jest.requireActual('../../lib/package-recommendations-client'),
  fetchOnlinePackageRecommendations: jest.fn(),
}));
jest.mock('../LearningPaths/useCatalogLaunch', () => ({
  useCatalogLaunch: () => ({ launch: jest.fn(), launchingKey: null, launchError: null }),
}));
jest.mock('@grafana/runtime', () => ({
  config: { namespace: 'catalog-test', bootData: { user: { id: 1, orgId: 1 } } },
}));
jest.mock('@grafana/i18n', () => ({
  t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(values?.[key] ?? '')),
}));

const originalObserver = global.IntersectionObserver;
let canvasSpy: jest.SpyInstance;
beforeAll(() => {
  canvasSpy = jest
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue({ measureText: () => ({ width: 100 }) } as unknown as CanvasRenderingContext2D);
  global.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof IntersectionObserver;
});
afterAll(() => {
  global.IntersectionObserver = originalObserver;
  canvasSpy.mockRestore();
});

beforeEach(() => {
  jest.clearAllMocks();
  updateCatalogView('catalog-test:1:1', { mode: 'all', query: '', source: 'all', format: 'all', category: 'all' });
  jest.mocked(fetchOnlinePackageRecommendations).mockResolvedValue({ baseUrl: '', packages: [], available: true });
});

it.each(['unsupported', 'feature-toggle-disabled', 'obo-unavailable', 'identity-unavailable', 'identity-unverifiable'])(
  'keeps unprovisioned organization content quiet for %s',
  async (reason) => {
    jest.mocked(fetchCustomGuideCatalogue).mockResolvedValue({ available: false, entries: [], reason });
    render(<PackageBrowser onOpenGuide={jest.fn()} />);
    await waitFor(() => expect(screen.getByRole('status')).not.toHaveTextContent('Loading more content'));
    expect(screen.queryByText('Some content is unavailable')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(screen.getByText('Create your first dashboard')).toBeInTheDocument();
  }
);

it.each(['request-failed', 'upstream-503', 'signing-keys-unreachable'])(
  'shows a recoverable warning for %s and loads organization content after Retry',
  async (reason) => {
    jest
      .mocked(fetchCustomGuideCatalogue)
      .mockResolvedValueOnce({ available: false, entries: [], reason })
      .mockResolvedValueOnce({
        available: true,
        entries: [{ id: 'team-guide', title: 'Team onboarding', status: 'published' }],
      });
    render(<PackageBrowser onOpenGuide={jest.fn()} />);
    expect(await screen.findByText('Organization content could not be loaded.')).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: 'Retry' });
    await waitFor(() => expect(retry).toBeEnabled());
    fireEvent.click(retry);
    expect(await screen.findByText('Team onboarding')).toBeInTheDocument();
    expect(screen.queryByText('Some content is unavailable')).not.toBeInTheDocument();
    expect(fetchCustomGuideCatalogue).toHaveBeenLastCalledWith('catalog-test', { refresh: true });
    expect(fetchOnlinePackageRecommendations).toHaveBeenLastCalledWith({ refresh: true });
  }
);
