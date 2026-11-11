import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PackageBrowser } from './PackageBrowser';
import { updateCatalogView } from '../../global-state/package-browser';
import { fetchCustomGuideCatalogue } from '../../lib/custom-guide-repository-client';
import { fetchEligibleCatalog } from '../../lib/eligible-catalog-client';
import catalogResponse from '../../lib/testdata/eligible-catalog-response.json';

let mockConsent = true;
jest.mock('../../hooks/usePathfinderPluginConfig', () => ({
  usePathfinderPluginConfig: () => ({
    isResolved: true,
    config: { acceptedTermsAndConditions: mockConsent, recommenderServiceUrl: 'https://recommender.grafana.com' },
  }),
}));
jest.mock('../EnableRecommenderBanner', () => ({ EnableRecommenderBanner: () => <div>Enable recommendations</div> }));

jest.mock('@grafana/scenes', () => ({
  ControlsLabel: ({ label, htmlFor }: { label: string; htmlFor?: string }) => <label htmlFor={htmlFor}>{label}</label>,
}));

jest.mock('../../learning-paths', () => ({
  catalogIdentity: jest.requireActual('../../learning-paths/catalog-learning-core').catalogIdentity,
  selectLearningPathEntries: jest.requireActual('../../learning-paths/learning-path-entries').selectLearningPathEntries,
  usePackageCatalog: jest.requireActual('../../learning-paths/package-catalog.hook').usePackageCatalog,
  useCatalogProgress: () => new Map(),
  useLearningPaths: () => ({
    paths: [],
    getPathProgress: () => 0,
    getPathGuides: () => [],
    progress: { completedGuides: [] },
  }),
  useMyAssignments: () => ({ onlinePaths: [], assignmentByTargetId: new Map(), getPathGuides: () => [] }),
}));
jest.mock('../../learning-paths/paths-data', () => ({ getPathsData: () => ({ paths: [], guideMetadata: {} }) }));
jest.mock('../../lib/custom-guide-repository-client', () => ({ fetchCustomGuideCatalogue: jest.fn() }));
jest.mock('../../lib/eligible-catalog-client', () => ({ fetchEligibleCatalog: jest.fn() }));
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
  mockConsent = true;
  jest.mocked(fetchEligibleCatalog).mockResolvedValue({
    available: true,
    items: [
      {
        key: 'official:first-dashboard',
        id: 'first-dashboard',
        title: 'First dashboard',
        format: 'guide',
        source: 'grafana',
        url: 'https://interactive-learning.grafana.net/packages/first-dashboard/content.json',
      },
    ],
  });
});

it.each([false, true])('shows private guides and an enablement CTA without consent (page=%s)', async (page) => {
  mockConsent = false;
  jest
    .mocked(fetchCustomGuideCatalogue)
    .mockResolvedValue({
      available: true,
      entries: [{ id: 'team-guide', name: 'team-guide', title: 'Team guide', status: 'published' }],
    });
  render(<PackageBrowser page={page} onOpenGuide={jest.fn()} />);
  expect(await screen.findByText('Team guide')).toBeInTheDocument();
  expect(screen.getByText('Enable recommendations')).toBeInTheDocument();
  expect(fetchEligibleCatalog).not.toHaveBeenCalled();
  expect(screen.queryByText('Create your first dashboard')).not.toBeInTheDocument();
});

it.each([false, true])(
  'keeps private guides usable and retries a failed public catalog request (page=%s)',
  async (page) => {
    jest.mocked(fetchEligibleCatalog).mockResolvedValueOnce({ available: false, items: [] });
    jest.mocked(fetchCustomGuideCatalogue).mockResolvedValue({
      available: true,
      entries: [{ id: 'team-guide', name: 'team-guide', title: 'Team guide', status: 'published' }],
    });
    render(<PackageBrowser page={page} onOpenGuide={jest.fn()} />);
    expect(await screen.findByText('Team guide')).toBeInTheDocument();
    expect(await screen.findByText('Public learning content could not be loaded. Try again.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Create your first dashboard')).toBeInTheDocument();
    expect(screen.queryByText('Some content is unavailable')).not.toBeInTheDocument();
  }
);

it('shows a valid guide from a mixed service response without a public catalog warning', async () => {
  const client = jest.requireActual<typeof import('../../lib/eligible-catalog-client')>(
    '../../lib/eligible-catalog-client'
  );
  client.resetEligibleCatalogCacheForTests();
  jest.mocked(fetchEligibleCatalog).mockImplementationOnce(client.fetchEligibleCatalog);
  jest.mocked(fetchCustomGuideCatalogue).mockResolvedValue({ available: true, entries: [] });
  const originalFetch = global.fetch;
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => catalogResponse });
  try {
    render(<PackageBrowser onOpenGuide={jest.fn()} />);
    expect(await screen.findByText('Standalone guide')).toBeInTheDocument();
    expect(screen.getByText('Valid path')).toBeInTheDocument();
    expect(screen.queryByText('Broken guide')).not.toBeInTheDocument();
    expect(screen.queryByText('Broken path')).not.toBeInTheDocument();
    expect(screen.queryByText('Nested journey')).not.toBeInTheDocument();
    expect(screen.queryByText('Public learning content could not be loaded. Try again.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  } finally {
    global.fetch = originalFetch;
    client.resetEligibleCatalogCacheForTests();
  }
});

it('does not search raw bundled guides absent from the eligible catalog', async () => {
  jest.mocked(fetchEligibleCatalog).mockResolvedValue({ available: true, items: [] });
  jest.mocked(fetchCustomGuideCatalogue).mockResolvedValue({ available: true, entries: [] });
  render(<PackageBrowser onOpenGuide={jest.fn()} />);
  await waitFor(() => expect(screen.getByRole('status')).not.toHaveTextContent('Loading more content'));
  fireEvent.change(screen.getByRole('textbox', { name: 'Search guides and learning paths' }), {
    target: { value: 'dashboard' },
  });
  expect(screen.getByText('No guides match these filters')).toBeInTheDocument();
  expect(screen.queryByText('Some content is unavailable')).not.toBeInTheDocument();
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
        entries: [{ id: 'team-guide', name: 'team-guide', title: 'Team onboarding', status: 'published' }],
      });
    render(<PackageBrowser onOpenGuide={jest.fn()} />);
    expect(await screen.findByText('Organization content could not be loaded.')).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: 'Retry' });
    await waitFor(() => expect(retry).toBeEnabled());
    fireEvent.click(retry);
    expect(await screen.findByText('Team onboarding')).toBeInTheDocument();
    expect(screen.queryByText('Some content is unavailable')).not.toBeInTheDocument();
    expect(fetchCustomGuideCatalogue).toHaveBeenLastCalledWith('catalog-test', { refresh: true });
    expect(fetchEligibleCatalog).toHaveBeenLastCalledWith('https://recommender.grafana.com', 'catalog-test:1:1', {
      refresh: true,
    });
  }
);
