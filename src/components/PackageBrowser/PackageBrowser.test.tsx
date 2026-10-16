import { reportAppInteraction, UserInteraction } from '../../lib/analytics';
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CatalogPackage } from '../../types/package-catalog.types';
import { PackageBrowser } from './PackageBrowser';
import { updateCatalogView } from '../../global-state/package-browser';
import { prepareGuideLaunch } from '../docs-panel/utils/prepare-guide-launch';
import { AppPlatformPackageResolver } from '../../package-engine';
import { finishGuideLoad } from '../../lib/telemetry/guide-load';

const mockItems: CatalogPackage[] = [
  {
    key: 'bundled:dashboard',
    id: 'dashboard',
    title: 'Build a dashboard',
    description: 'Turn metrics into a dashboard.',
    format: 'guide',
    source: 'grafana',
    category: 'dashboards',
    url: 'bundled:dashboard',
    estimatedMinutes: 10,
    activityCount: 14,
  },
  {
    key: 'app-platform:team',
    id: 'team',
    title: 'Team guide',
    format: 'guide',
    source: 'organization',
    url: 'backend-guide:team',
    packageInfo: { packageId: 'team', repository: 'app-platform' },
  },
];
let mockScope = 'test';
const mockRetry = jest.fn();
const mockResolve = jest.fn();
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

jest.mock('../../lib/analytics', () => ({
  ...jest.requireActual('../../lib/analytics'),
  reportAppInteraction: jest.fn(),
}));

jest.mock('../../learning-paths', () => ({
  useCatalogProgress: () => new Map(),
  usePackageCatalog: () => ({
    scope: mockScope,
    items: mockItems,
    loading: false,
    publicUnavailable: false,
    privateUnavailable: false,
    retry: mockRetry,
  }),
}));
jest.mock('../../docs-retrieval', () => ({ resolvePackageMilestones: jest.fn(async () => []) }));
jest.mock('../../package-engine', () => ({
  AppPlatformPackageResolver: jest.fn().mockImplementation(() => ({ resolve: mockResolve })),
}));
jest.mock('../docs-panel/utils/prepare-guide-launch', () => ({ prepareGuideLaunch: jest.fn() }));
jest.mock('../../lib/telemetry/guide-load', () => ({
  beginGuideLoad: jest.fn(() => ({ id: 'load-test' })),
  finishGuideLoad: jest.fn(),
}));
jest.mock('@grafana/runtime', () => ({
  config: { bootData: { user: {} } },
}));
jest.mock('@grafana/i18n', () => ({
  t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(values?.[key] ?? '')),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockScope = 'test';
  mockItems.splice(2);
  updateCatalogView('test', {
    mode: 'all',
    query: '',
    format: 'all',
    source: 'all',
    category: 'all',
    expandedKeys: [],
    focusKey: null,
    scrollTop: 0,
    visibleCount: 24,
  });
});

it('renders a bounded batch while search covers the entire catalog', () => {
  for (let index = 0; index < 65; index++) {
    mockItems.push({
      key: `extra:${index}`,
      id: `extra-${index}`,
      title: `Extra guide ${index}`,
      format: 'guide',
      source: 'grafana',
      url: `bundled:extra-${index}`,
    });
  }
  render(<PackageBrowser onOpenGuide={jest.fn()} />);
  expect(screen.getAllByRole('article')).toHaveLength(24);
  fireEvent.click(screen.getByText('Show more'));
  expect(screen.getAllByRole('article')).toHaveLength(48);
  fireEvent.change(screen.getByLabelText('Search guides and paths'), { target: { value: 'Extra guide 64' } });
  expect(screen.getAllByRole('article')).toHaveLength(1);
  expect(screen.getByText('Extra guide 64')).toBeInTheDocument();
});

it('searches and filters sparse organization content without readiness badges', async () => {
  render(<PackageBrowser onOpenGuide={jest.fn()} />);
  expect(screen.getByRole('combobox', { name: 'Format' })).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Topic' })).toBeInTheDocument();
  expect(screen.getByRole('group', { name: 'Source' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText('14 activities · About 10 min')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Your organization' }));
  expect(screen.getByRole('button', { name: 'Your organization' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false');
  expect(screen.queryByText('Build a dashboard')).not.toBeInTheDocument();
  expect(screen.getByText('Team guide')).toBeInTheDocument();
  expect(screen.queryByText('Requirements unknown')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Search guides and paths'), { target: { value: 'missing' } });
  expect(screen.getByText('No guides match these filters')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Clear filters'));
  expect(screen.getByText('Build a dashboard')).toBeInTheDocument();
});

it('expands path details in the card without preparing content or moving scroll and focus', async () => {
  mockItems.push({
    key: 'curated:path',
    id: 'path',
    title: 'Dashboard path',
    format: 'path',
    source: 'grafana',
    url: '',
    memberIds: ['dashboard'],
    curatedPath: {
      id: 'path',
      title: 'Dashboard path',
      guides: ['dashboard'],
      description: 'Dashboard basics',
      badgeId: 'dashboard',
    },
  });
  const { unmount } = render(<PackageBrowser onOpenGuide={jest.fn()} />);
  fireEvent.change(screen.getByLabelText('Search guides and paths'), { target: { value: 'Dashboard path' } });
  const container = screen.getByTestId('package-browser');
  container.scrollTop = 420;
  fireEvent.scroll(container);
  const toggle = screen.getByRole('button', { name: 'Show modules' });
  toggle.focus();
  fireEvent.click(toggle);
  const details = await screen.findByRole('region', { name: 'Details for Dashboard path' });
  expect(details.closest('article')).toBe(screen.getByRole('article'));
  expect(prepareGuideLaunch).not.toHaveBeenCalled();
  expect(container.scrollTop).toBe(420);
  expect(toggle).toHaveFocus();
  expect(screen.getByRole('button', { name: 'Start path' })).toBeEnabled();
  unmount();
  render(<PackageBrowser onOpenGuide={jest.fn()} />);
  expect(screen.getByLabelText('Search guides and paths')).toHaveValue('Dashboard path');
  expect(screen.getByRole('button', { name: 'Hide modules' })).toHaveAttribute('aria-expanded', 'true');
});

it('omits path milestones from the list and search while keeping them in path details', async () => {
  mockItems.push({
    key: 'curated:path',
    id: 'path',
    title: 'Dashboard path',
    format: 'path',
    source: 'grafana',
    url: '',
    memberIds: ['dashboard'],
  });
  render(<PackageBrowser onOpenGuide={jest.fn()} />);
  expect(screen.queryByRole('heading', { name: 'Build a dashboard' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Search guides and paths'), { target: { value: 'Build a dashboard' } });
  expect(screen.getByText('No guides match these filters')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Search guides and paths'), { target: { value: 'Dashboard path' } });
  fireEvent.click(screen.getByRole('button', { name: 'Show modules' }));
  const details = await screen.findByRole('region', { name: 'Details for Dashboard path' });
  expect(within(details).getByText('Build a dashboard')).toBeInTheDocument();
});

it('refuses stale unpublished private content before preparing or launching it', async () => {
  mockResolve.mockResolvedValue({ ok: false, error: { code: 'not-found' } });
  const onOpen = jest.fn();
  render(<PackageBrowser onOpenGuide={onOpen} />);
  const privateCard = screen.getByText('Team guide').closest('article')!;
  fireEvent.click(within(privateCard).getByText('Start guide'));
  await waitFor(() => expect(screen.getByText(/Could not open this guide/)).toBeInTheDocument());
  expect(AppPlatformPackageResolver).toHaveBeenCalled();
  expect(mockResolve).toHaveBeenCalledWith('team', { loadContent: 'metadata-only' });
  expect(prepareGuideLaunch).not.toHaveBeenCalled();
  expect(onOpen).not.toHaveBeenCalled();
});

it('blocks duplicate launches and preserves the prepared launch payload', async () => {
  let finish: (value: unknown) => void = () => {};
  jest.mocked(prepareGuideLaunch).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve as (value: unknown) => void;
      })
  );
  const onOpen = jest.fn();
  render(<PackageBrowser onOpenGuide={onOpen} />);
  const button = within(screen.getByText('Build a dashboard').closest('article')!).getByText('Start guide');
  fireEvent.click(button);
  fireEvent.click(button);
  expect(prepareGuideLaunch).toHaveBeenCalledTimes(1);
  const launch = { url: 'bundled:dashboard', source: 'package_browser', preparedContent: { content: '{}' } };
  await act(async () => {
    finish({ ok: true, launch });
  });
  expect(onOpen).toHaveBeenCalledWith(launch);
});

it('cancels an unmounted launch without opening or leaving the load pending', async () => {
  let finish: (value: unknown) => void = () => {};
  jest.mocked(prepareGuideLaunch).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve as (value: unknown) => void;
      })
  );
  const onOpen = jest.fn();
  const { unmount } = render(<PackageBrowser onOpenGuide={onOpen} />);
  fireEvent.click(within(screen.getByText('Build a dashboard').closest('article')!).getByText('Start guide'));
  unmount();
  await act(async () => {
    finish({ ok: true, launch: { url: 'bundled:dashboard' } });
  });
  expect(onOpen).not.toHaveBeenCalled();
  expect(finishGuideLoad).toHaveBeenCalledWith({ id: 'load-test' }, 'cancelled');
});

it('starts with curated introductions and topic shortcuts rather than the full catalog', () => {
  const starter: CatalogPackage = {
    key: 'curated:getting-started',
    id: 'getting-started',
    title: 'Getting started with Grafana',
    format: 'path',
    source: 'grafana',
    url: '',
    memberIds: ['dashboard'],
    curatedPath: {
      id: 'getting-started',
      title: 'Getting started with Grafana',
      description: 'Basics',
      guides: ['dashboard'],
      badgeId: 'basics',
    },
  };
  mockItems.push(starter, {
    key: 'bundled:alerts',
    id: 'alerts',
    title: 'Create an alert',
    format: 'guide',
    source: 'grafana',
    category: 'alerting',
    url: 'bundled:alerts',
  });
  updateCatalogView('test', { mode: 'explore' });
  render(<PackageBrowser onOpenGuide={jest.fn()} />);
  expect(screen.getByRole('heading', { name: 'Start with the essentials', level: 3 })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Getting started with Grafana' })).toBeInTheDocument();
  expect(screen.getByText('Guided introductions')).toBeInTheDocument();
  expect(screen.getByText('A good place to start')).toBeInTheDocument();
  expect(screen.getByText('Prefer a single guide?')).toBeInTheDocument();
  expect(screen.getByText('3 to explore')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Explore learning' })).toBeInTheDocument();
  expect(screen.getByText('Find something to learn or build in Grafana.')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Explore by topic' })).toBeInTheDocument();
  expect(screen.queryByText('Team guide')).not.toBeInTheDocument();
  expect(screen.queryByRole('combobox', { name: 'Format' })).not.toBeInTheDocument();
  expect(screen.queryByText('Expand catalog')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'All content' }));
  expect(screen.getByText('Team guide')).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Format' })).toBeInTheDocument();
});

it('topic shortcuts include category aliases and retain their selection on return', () => {
  mockItems.push({
    key: 'alias:dashboard',
    id: 'alias-dashboard',
    title: 'Dashboard visualizations',
    format: 'guide',
    source: 'grafana',
    category: 'visualizations',
    url: 'bundled:alias-dashboard',
  });
  updateCatalogView('test', { mode: 'explore' });
  const { unmount } = render(<PackageBrowser onOpenGuide={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Dashboards 2 guides and paths' }));
  expect(screen.getAllByRole('article')).toHaveLength(2);
  expect(screen.queryByText('Team guide')).not.toBeInTheDocument();
  const container = screen.getByTestId('package-browser');
  container.scrollTop = 240;
  fireEvent.scroll(container);
  unmount();
  render(<PackageBrowser onOpenGuide={jest.fn()} />);
  expect(screen.getByRole('button', { name: 'All content' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getAllByRole('article')).toHaveLength(2);
  expect(screen.getByTestId('package-browser').scrollTop).toBe(240);
});

it('search from Explore searches the whole catalog and opens All content', () => {
  updateCatalogView('test', { mode: 'explore' });
  render(<PackageBrowser onOpenGuide={jest.fn()} />);
  fireEvent.change(screen.getByLabelText('Search guides and paths'), { target: { value: 'Team' } });
  expect(screen.getByText('Team guide')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'All content' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.queryByRole('heading', { name: 'Explore by topic' })).not.toBeInTheDocument();
});

it('hides launch failures from the previous identity and ignores late scope launches', async () => {
  jest.mocked(prepareGuideLaunch).mockResolvedValue({ ok: false, error: 'unavailable', errorCode: 'fetch-failed' });
  const onOpen = jest.fn();
  const { rerender } = render(<PackageBrowser onOpenGuide={onOpen} />);
  fireEvent.click(within(screen.getByText('Build a dashboard').closest('article')!).getByText('Start guide'));
  await waitFor(() => expect(screen.getByText(/Could not open this guide/)).toBeInTheDocument());
  mockScope = 'test:other-user';
  updateCatalogView(mockScope, { mode: 'all' });
  rerender(<PackageBrowser onOpenGuide={onOpen} />);
  expect(screen.queryByText(/Could not open this guide/)).not.toBeInTheDocument();
  let finish: (value: unknown) => void = () => {};
  jest.mocked(prepareGuideLaunch).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve as (value: unknown) => void;
      })
  );
  fireEvent.click(within(screen.getByText('Build a dashboard').closest('article')!).getByText('Start guide'));
  expect(screen.getByRole('button', { name: 'Opening…' })).toBeDisabled();
  mockScope = 'test:other-org';
  updateCatalogView(mockScope, { mode: 'all' });
  rerender(<PackageBrowser onOpenGuide={onOpen} />);
  expect(screen.queryByRole('button', { name: 'Opening…' })).not.toBeInTheDocument();
  await act(async () => {
    finish({ ok: true, launch: { url: 'bundled:dashboard' } });
  });
  expect(onOpen).not.toHaveBeenCalled();
});

describe('search analytics', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('reports the settled keyword without repeated keystrokes or raw text', () => {
    render(<PackageBrowser onOpenGuide={jest.fn()} />);
    expect(reportAppInteraction).not.toHaveBeenCalled();
    const search = screen.getByLabelText('Search guides and paths');
    for (const value of [' ', 'k', 'k8', 'k8s']) {
      fireEvent.change(search, { target: { value } });
      act(() => jest.advanceTimersByTime(100));
    }
    expect(reportAppInteraction).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(500));
    expect(reportAppInteraction).toHaveBeenCalledTimes(1);
    expect(reportAppInteraction).toHaveBeenLastCalledWith(UserInteraction.CatalogInteraction, {
      action: 'search',
      interaction_location: 'package_browser',
      search_topic: 'kubernetes',
    });
    fireEvent.change(search, { target: { value: 'alice@example.com dashboard' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    fireEvent.blur(search);
    act(() => jest.advanceTimersByTime(500));
    expect(reportAppInteraction).toHaveBeenCalledTimes(2);
    expect(reportAppInteraction).toHaveBeenLastCalledWith(UserInteraction.CatalogInteraction, {
      action: 'search',
      interaction_location: 'package_browser',
      search_topic: 'other',
    });
    fireEvent.change(search, { target: { value: 'Tempo' } });
    fireEvent.blur(search);
    expect(reportAppInteraction).toHaveBeenLastCalledWith(UserInteraction.CatalogInteraction, {
      action: 'search',
      interaction_location: 'package_browser',
      search_topic: 'traces',
    });
  });

  it('waits for Enter or blur before reporting an unmatched query, so a pause mid-word is not counted', () => {
    render(<PackageBrowser onOpenGuide={jest.fn()} />);
    const search = screen.getByLabelText('Search guides and paths');
    fireEvent.change(search, { target: { value: 'dash' } });
    act(() => jest.advanceTimersByTime(500));
    expect(reportAppInteraction).not.toHaveBeenCalled();
    fireEvent.change(search, { target: { value: 'dashboard' } });
    act(() => jest.advanceTimersByTime(500));
    fireEvent.blur(search);
    expect(reportAppInteraction).toHaveBeenCalledTimes(1);
    expect(reportAppInteraction).toHaveBeenLastCalledWith(UserInteraction.CatalogInteraction, {
      action: 'search',
      interaction_location: 'package_browser',
      search_topic: 'dashboards',
    });
    fireEvent.change(search, { target: { value: 'dashboard for Alice' } });
    act(() => jest.advanceTimersByTime(500));
    expect(reportAppInteraction).toHaveBeenCalledTimes(1);
    fireEvent.blur(search);
    expect(reportAppInteraction).toHaveBeenCalledTimes(2);
    expect(reportAppInteraction).toHaveBeenLastCalledWith(UserInteraction.CatalogInteraction, {
      action: 'search',
      interaction_location: 'package_browser',
      search_topic: 'other',
    });
  });

  it('counts a search once when Clear filters is clicked, because the click blurs the search box first', () => {
    render(<PackageBrowser onOpenGuide={jest.fn()} />);
    const search = screen.getByLabelText('Search guides and paths');
    fireEvent.change(search, { target: { value: 'Tempo' } });
    fireEvent.blur(search);
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    act(() => jest.advanceTimersByTime(500));
    expect(reportAppInteraction).toHaveBeenCalledTimes(1);
    expect(reportAppInteraction).toHaveBeenLastCalledWith(UserInteraction.CatalogInteraction, {
      action: 'search',
      interaction_location: 'package_browser',
      search_topic: 'traces',
    });
  });

  it('does not report restored searches, deleted queries, or abandoned pending searches', () => {
    updateCatalogView('test', { query: 'metrics' });
    const { unmount } = render(<PackageBrowser onOpenGuide={jest.fn()} />);
    const search = screen.getByLabelText('Search guides and paths');
    act(() => jest.advanceTimersByTime(500));
    fireEvent.blur(search);
    expect(reportAppInteraction).not.toHaveBeenCalled();
    fireEvent.change(search, { target: { value: 'Tempo' } });
    fireEvent.change(search, { target: { value: '' } });
    act(() => jest.advanceTimersByTime(500));
    fireEvent.blur(search);
    expect(reportAppInteraction).not.toHaveBeenCalled();
    fireEvent.change(search, { target: { value: 'Loki' } });
    unmount();
    act(() => jest.advanceTimersByTime(500));
    expect(reportAppInteraction).not.toHaveBeenCalled();
  });

  it('cancels a pending search when the organization scope changes', () => {
    const { rerender } = render(<PackageBrowser onOpenGuide={jest.fn()} />);
    fireEvent.change(screen.getByLabelText('Search guides and paths'), { target: { value: 'metrics' } });
    mockScope = 'test:search-other-org';
    updateCatalogView(mockScope, { mode: 'all', query: 'logs' });
    rerender(<PackageBrowser onOpenGuide={jest.fn()} />);
    act(() => jest.advanceTimersByTime(500));
    expect(reportAppInteraction).not.toHaveBeenCalled();
  });
});

it('reports explicit source and view changes and topic shortcuts', () => {
  render(<PackageBrowser onOpenGuide={jest.fn()} />);
  for (const label of ['Official', 'Official', 'Your organization', 'All']) {
    fireEvent.click(screen.getByRole('button', { name: label }));
  }
  expect(jest.mocked(reportAppInteraction).mock.calls.map(([, properties]) => properties)).toEqual([
    {
      action: 'source',
      content_source: 'grafana',
      previous_content_source: 'all',
      interaction_location: 'package_browser',
    },
    {
      action: 'source',
      content_source: 'organization',
      previous_content_source: 'grafana',
      interaction_location: 'package_browser',
    },
    {
      action: 'source',
      content_source: 'all',
      previous_content_source: 'organization',
      interaction_location: 'package_browser',
    },
  ]);
  fireEvent.click(screen.getByRole('button', { name: 'Explore' }));
  expect(reportAppInteraction).toHaveBeenLastCalledWith(UserInteraction.CatalogInteraction, {
    action: 'view',
    view: 'explore',
    previous_view: 'all',
    interaction_location: 'package_browser',
  });
  fireEvent.click(screen.getByRole('button', { name: /Dashboards.*guides and paths/ }));
  expect(reportAppInteraction).toHaveBeenLastCalledWith(UserInteraction.CatalogInteraction, {
    action: 'topic',
    topic: 'dashboards',
    control: 'shortcut',
    interaction_location: 'package_browser',
  });
});

it('reports no view change for reselecting the active view or for the switch a search makes', () => {
  render(<PackageBrowser onOpenGuide={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'All content' }));
  expect(reportAppInteraction).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Explore' }));
  jest.mocked(reportAppInteraction).mockClear();
  fireEvent.change(screen.getByLabelText('Search guides and paths'), { target: { value: 'dashboard' } });
  expect(screen.getByRole('button', { name: 'All content' })).toHaveAttribute('aria-pressed', 'true');
  expect(jest.mocked(reportAppInteraction).mock.calls.some(([, properties]) => properties?.action === 'view')).toBe(
    false
  );
});

it('reports a topic chosen from the filter as a filter selection', async () => {
  render(<PackageBrowser onOpenGuide={jest.fn()} />);
  const topic = screen.getByRole('combobox', { name: 'Topic' });
  fireEvent.change(topic, { target: { value: 'Dashboards' } });
  await act(async () => {});
  fireEvent.keyDown(topic, { key: 'ArrowDown' });
  fireEvent.keyDown(topic, { key: 'Enter' });
  expect(reportAppInteraction).toHaveBeenLastCalledWith(UserInteraction.CatalogInteraction, {
    action: 'topic',
    topic: 'dashboards',
    control: 'filter',
    interaction_location: 'package_browser',
  });
});
