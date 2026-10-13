import { act, renderHook } from '@testing-library/react';
import { useCatalogLaunch } from './useCatalogLaunch';
import { prepareGuideLaunch } from '../docs-panel/utils/prepare-guide-launch';
import { openGuideInSidebar } from '../docs-panel/utils/open-prepared-guide';
import { finishGuideLoad } from '../../lib/telemetry/guide-load';
import type { CatalogPackage } from '../../types/package-catalog.types';

jest.mock('../docs-panel/utils/prepare-guide-launch', () => ({ prepareGuideLaunch: jest.fn() }));
jest.mock('../docs-panel/utils/open-prepared-guide', () => ({ openGuideInSidebar: jest.fn() }));
jest.mock('../../lib/telemetry/guide-load', () => ({
  beginGuideLoad: jest.fn(() => ({ id: 'load' })),
  finishGuideLoad: jest.fn(),
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
