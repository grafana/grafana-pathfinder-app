import { act, renderHook } from '@testing-library/react';
import { useCatalogLaunch } from './useCatalogLaunch';
import { prepareGuideLaunch } from '../docs-panel/utils/prepare-guide-launch';
import { openGuideInSidebar } from '../docs-panel/utils/open-prepared-guide';
import { finishGuideLoad } from '../../lib/telemetry/guide-load';
import { reportAppInteraction, UserInteraction } from '../../lib/analytics';
import type { CatalogPackage } from '../../types/package-catalog.types';

jest.mock('../docs-panel/utils/prepare-guide-launch', () => ({ prepareGuideLaunch: jest.fn() }));
jest.mock('../docs-panel/utils/open-prepared-guide', () => ({ openGuideInSidebar: jest.fn() }));
jest.mock('../../lib/telemetry/guide-load', () => ({
  beginGuideLoad: jest.fn(() => ({ id: 'load' })),
  finishGuideLoad: jest.fn(),
}));
jest.mock('../../lib/analytics', () => ({
  reportAppInteraction: jest.fn(),
  UserInteraction: { OpenResourceClick: 'open_resource_click' },
  AnalyticsContentType: { InteractiveGuide: 'interactive-guide', LearningJourney: 'learning-journey' },
}));
const mockResolve = jest.fn();
jest.mock('../../package-engine', () => ({
  AppPlatformPackageResolver: jest.fn().mockImplementation(() => ({ resolve: mockResolve })),
}));

const entry: CatalogPackage = {
  key: 'online-cdn:guide',
  id: 'guide',
  title: 'Guide',
  source: 'grafana',
  format: 'guide',
  url: 'https://cdn.example/guide/content.json',
};
const prepareMock = prepareGuideLaunch as jest.Mock;
const launch = { url: entry.url, title: entry.title, source: 'package_browser' };
const progress = new Map();
function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  jest.clearAllMocks();
  prepareMock.mockResolvedValue({ ok: true, launch });
});

it('prepares once and hands the prepared result directly to the sidebar', async () => {
  const pending = deferred();
  prepareMock.mockReturnValue(pending.promise);
  const { result } = renderHook(() => useCatalogLaunch([entry], 'org:1', progress));
  let first!: Promise<void>;
  act(() => {
    first = result.current.launch(entry);
  });
  await act(async () => {
    await result.current.launch(entry);
  });
  expect(prepareMock).toHaveBeenCalledTimes(1);
  expect(reportAppInteraction).toHaveBeenCalledTimes(1);
  expect(reportAppInteraction).toHaveBeenCalledWith(UserInteraction.OpenResourceClick, {
    interaction_location: 'my_learning_continue',
    content_type: 'interactive-guide',
    content_title: entry.title,
    content_url: entry.url,
  });
  await act(async () => {
    pending.resolve({ ok: true, launch });
    await first;
  });
  expect(openGuideInSidebar).toHaveBeenCalledWith(launch);
  expect(result.current.launchingKey).toBeNull();
});

it('does not open late prepared content after the user or organization changes', async () => {
  const pending = deferred();
  prepareMock.mockReturnValue(pending.promise);
  const { result, rerender } = renderHook(({ scope }) => useCatalogLaunch([entry], scope, progress), {
    initialProps: { scope: 'org:1:user:1' },
  });
  let first!: Promise<void>;
  act(() => {
    first = result.current.launch(entry);
  });
  rerender({ scope: 'org:2:user:2' });
  expect(result.current.launchingKey).toBeNull();
  await act(async () => {
    pending.resolve({ ok: true, launch });
    await first;
  });
  expect(openGuideInSidebar).not.toHaveBeenCalled();
  expect(finishGuideLoad).toHaveBeenCalledWith(expect.anything(), 'cancelled');
});

it('freshly validates a private package and rejects unpublished content without a public fallback', async () => {
  mockResolve.mockResolvedValue({ ok: false });
  const privateEntry = {
    ...entry,
    source: 'organization' as const,
    key: 'app-platform:guide',
    url: 'backend-guide:guide',
  };
  const { result } = renderHook(() => useCatalogLaunch([entry, privateEntry], 'org:1', progress));
  await act(async () => {
    await result.current.launch(privateEntry);
  });
  expect(mockResolve).toHaveBeenCalledWith('guide', { loadContent: 'metadata-only' });
  expect(prepareMock).not.toHaveBeenCalled();
  expect(openGuideInSidebar).not.toHaveBeenCalled();
  expect(result.current.launchError?.key).toBe('app-platform:guide');
});

it('resumes the next existing curated member without writing enrollment or progress', async () => {
  const path: CatalogPackage = {
    ...entry,
    key: 'curated:path',
    id: 'path',
    format: 'path',
    url: '',
    memberIds: ['first', 'guide'],
    curatedPath: { id: 'path', title: 'Path', description: '', guides: ['first', 'guide'], badgeId: 'badge' },
  };
  const { result } = renderHook(() =>
    useCatalogLaunch([path, entry], 'org:1', new Map([[path.key, { percent: 50, nextId: 'guide' }]]))
  );
  await act(async () => {
    await result.current.launch(path);
  });
  expect(prepareMock).toHaveBeenCalledWith(
    entry.url,
    expect.objectContaining({ title: entry.title, source: 'package_browser' })
  );
  expect(openGuideInSidebar).toHaveBeenCalledWith(launch);
});

it('reports Discover and Browse separately while omitting organization identities', async () => {
  const privateEntry = {
    ...entry,
    source: 'organization' as const,
    key: 'app-platform:private',
    id: 'private',
    url: 'backend-guide:private',
    title: 'Private title',
  };
  mockResolve.mockResolvedValue({ ok: true, manifest: { id: 'private' } });
  const { result } = renderHook(() =>
    useCatalogLaunch([entry, privateEntry], 'org:1', progress, { interactionLocation: 'package_browser' })
  );
  await act(async () => {
    await result.current.launch(privateEntry);
  });
  expect(reportAppInteraction).toHaveBeenLastCalledWith(UserInteraction.OpenResourceClick, {
    interaction_location: 'package_browser',
    content_type: 'interactive-guide',
  });
  await act(async () => {
    await result.current.launch({ ...entry, format: 'path' }, 'my_learning_discover_more');
  });
  expect(reportAppInteraction).toHaveBeenLastCalledWith(UserInteraction.OpenResourceClick, {
    interaction_location: 'my_learning_discover_more',
    content_type: 'learning-journey',
    content_title: entry.title,
    content_url: entry.url,
  });
});

it('hides old scope errors and ignores late failures after identity changes', async () => {
  prepareMock.mockResolvedValue({ ok: false });
  const { result, rerender } = renderHook(({ scope }) => useCatalogLaunch([entry], scope, progress), {
    initialProps: { scope: 'org:1:user:1' },
  });
  await act(async () => {
    await result.current.launch(entry);
  });
  expect(result.current.launchError?.key).toBe(entry.key);
  rerender({ scope: 'org:2:user:2' });
  expect(result.current.launchError).toBeNull();
  const pending = deferred();
  prepareMock.mockReturnValue(pending.promise);
  let first!: Promise<void>;
  act(() => {
    first = result.current.launch(entry);
  });
  rerender({ scope: 'org:3:user:3' });
  await act(async () => {
    pending.resolve({ ok: false });
    await first;
  });
  expect(result.current.launchError).toBeNull();
  expect(result.current.launchingKey).toBeNull();
});

it('opens page launches immediately and lets the reader load the content', async () => {
  prepareMock.mockReturnValue(new Promise(() => {}));
  const { result } = renderHook(() => useCatalogLaunch([entry], 'org:1', progress, { loadInSidebar: true }));
  await act(async () => {
    await result.current.launch(entry);
  });
  expect(openGuideInSidebar).toHaveBeenCalledWith({ ...launch, packageInfo: undefined });
  expect(prepareMock).not.toHaveBeenCalled();
});

it('still checks private package availability before an immediate page launch', async () => {
  mockResolve.mockResolvedValue({ ok: false });
  const privateEntry = { ...entry, source: 'organization' as const, url: 'backend-guide:guide' };
  const { result } = renderHook(() => useCatalogLaunch([privateEntry], 'org:1', progress, { loadInSidebar: true }));
  await act(async () => {
    await result.current.launch(privateEntry);
  });
  expect(mockResolve).toHaveBeenCalledWith('guide', { loadContent: 'metadata-only' });
  expect(openGuideInSidebar).not.toHaveBeenCalled();
  expect(prepareMock).not.toHaveBeenCalled();
});
