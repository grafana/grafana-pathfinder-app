import { act, renderHook, waitFor } from '@testing-library/react';
import { config } from '@grafana/runtime';
import type { RawContent } from '../../types/content.types';
import type { CatalogPackage } from '../../types/package-catalog.types';
import { useCompletionRecommendations } from './useCompletionRecommendations';

const mockBundled = jest.fn();
const mockOnline = jest.fn();
const mockPrivate = jest.fn();
const mockCatalog = jest.fn();
jest.mock('@grafana/runtime', () => ({ config: { namespace: 'org-a', bootData: { user: { id: 1, orgId: 1 } } } }));
jest.mock('../../learning-paths', () => ({ usePackageCatalog: (options: unknown) => mockCatalog(options) }));
jest.mock('../../package-engine', () => ({
  createBundledResolver: () => ({ resolve: mockBundled }),
  OnlineCdnPackageResolver: class {
    resolve = mockOnline;
  },
  AppPlatformPackageResolver: class {
    resolve = mockPrivate;
  },
}));
const publicIdentity = { guideId: 'current', guideSource: 'online-cdn' as const, sourceConfirmed: true };
const privateIdentity = { ...publicIdentity, guideSource: 'app-platform' as const };
function guide(manifest: Record<string, unknown> = { id: 'current', type: 'guide' }): RawContent {
  return {
    url: 'https://grafana.com/docs/learning-journeys/current/content.json',
    type: 'single-doc',
    content: '',
    lastFetched: '',
    metadata: { title: 'Current', packageManifest: manifest },
  };
}
const scope = () => `${config.namespace}:${config.bootData.user.orgId}:${config.bootData.user.id}`;
const resolveResult = (id: string, repository = 'online-cdn', manifest: Record<string, unknown> = {}) => ({
  ok: true,
  id,
  repository,
  contentUrl:
    repository === 'app-platform'
      ? `backend-guide:${id}`
      : `https://grafana.com/docs/learning-journeys/${id}/content.json`,
  manifestUrl: '',
  entryTitle: `Title ${id}`,
  manifest: { id, type: 'guide', description: 'Useful description', ...manifest },
});
const mockItems: CatalogPackage[] = [];
beforeEach(() => {
  jest.clearAllMocks();
  config.namespace = 'org-a';
  config.bootData.user.orgId = 1;
  mockItems.length = 0;
  mockCatalog.mockImplementation(({ enabled }) => ({
    items: enabled ? mockItems : [],
    scope: scope(),
    loading: false,
  }));
  mockBundled.mockResolvedValue({ ok: false });
  mockOnline.mockImplementation(async (id: string) => resolveResult(id));
  mockPrivate.mockImplementation(async (id: string) => resolveResult(id, 'app-platform'));
});

it('resolves authored public references missing from the index without private fallback', async () => {
  const { result } = renderHook(() =>
    useCompletionRecommendations(
      guide({
        id: 'current',
        type: 'guide',
        suggests: ['next'],
        depends: ['prerequisite'],
        recommends: ['soft-prerequisite'],
      }),
      publicIdentity
    )
  );
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.items).toEqual([
    expect.objectContaining({ id: 'next', title: 'Title next', description: 'Useful description', source: 'grafana' }),
  ]);
  expect(result.current.context.suggests).toEqual(['next']);
  expect(mockBundled).toHaveBeenCalledWith('next', { loadContent: 'metadata-only' });
  expect(mockPrivate).not.toHaveBeenCalled();
  expect(mockOnline).not.toHaveBeenCalledWith('prerequisite', expect.anything());
  expect(mockBundled).not.toHaveBeenCalledWith('soft-prerequisite', expect.anything());
  expect(mockOnline).not.toHaveBeenCalledWith('soft-prerequisite', expect.anything());
  expect(mockCatalog).toHaveBeenCalledWith({ enabled: true, publicOnly: true });
});

it('keeps private completions without references neutral and avoids catalog or resolver reads', async () => {
  const { result } = renderHook(() => useCompletionRecommendations(guide(), privateIdentity));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(mockCatalog).toHaveBeenCalledWith({ enabled: false, publicOnly: true });
  expect(result.current.items).toEqual([]);
  expect(mockPrivate).not.toHaveBeenCalled();
  expect(mockOnline).not.toHaveBeenCalled();
  expect(mockBundled).not.toHaveBeenCalled();
});

it('resolves private references only as published organization packages', async () => {
  const { result } = renderHook(() =>
    useCompletionRecommendations(
      guide({ id: 'current', type: 'guide', suggests: [['next', 'other']] }),
      privateIdentity
    )
  );
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.items.every((item) => item.source === 'organization')).toBe(true);
  expect(mockPrivate).toHaveBeenCalledWith('next', { loadContent: 'metadata-only', verifyPublished: true });
  expect(mockOnline).not.toHaveBeenCalled();
  expect(mockBundled).not.toHaveBeenCalled();
});

it('does not expose a delayed private resolution after an organization changes', async () => {
  let finish: (value: unknown) => void = () => {};
  mockPrivate.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const content = guide({ id: 'current', type: 'guide', suggests: ['secret'] });
  const { result, rerender } = renderHook(() => useCompletionRecommendations(content, privateIdentity));
  await waitFor(() => expect(mockPrivate).toHaveBeenCalledTimes(1));
  config.bootData.user.orgId = 2;
  mockPrivate.mockResolvedValue({ ok: false });
  rerender();
  await act(async () => finish(resolveResult('secret', 'app-platform')));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.items).toEqual([]);
});

it('loads the current CDN manifest instead of a same-ID bundled manifest and prepends confirmed terminal path references', async () => {
  mockItems.push({
    key: 'bundled:current',
    id: 'current',
    title: 'Wrong source',
    format: 'guide',
    source: 'grafana',
    url: 'bundled:current/content.json',
    packageInfo: { repository: 'bundled', packageManifest: { id: 'current', type: 'guide', suggests: ['wrong'] } },
  });
  mockOnline.mockImplementation(async (id: string) =>
    resolveResult(id, 'online-cdn', id === 'current' ? { suggests: ['member-next'] } : {})
  );
  const { result } = renderHook(() =>
    useCompletionRecommendations(
      guide({ id: 'parent', type: 'path', suggests: ['parent-next'] }),
      { ...publicIdentity, pathIdentity: { guideId: 'parent', guideSource: 'online-cdn', sourceConfirmed: true } },
      true
    )
  );
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.context.suggests).toEqual(['parent-next', 'member-next']);
  expect(mockOnline).toHaveBeenCalledWith('current', { loadContent: 'metadata-only' });
  expect(mockBundled).not.toHaveBeenCalledWith('current', expect.anything());
  expect(mockOnline).not.toHaveBeenCalledWith('wrong', expect.anything());
});

it('does not infer parent relationships without a confirmed parent identity', async () => {
  const { result } = renderHook(() =>
    useCompletionRecommendations(guide({ id: 'parent', type: 'path', suggests: ['parent-next'] }), publicIdentity, true)
  );
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.context.suggests).toEqual([]);
});

it('bounds metadata requests to eight unique valid IDs', async () => {
  const { result } = renderHook(() =>
    useCompletionRecommendations(
      guide({ id: 'current', type: 'guide', suggests: Array.from({ length: 15 }, (_, index) => `next-${index}`) }),
      publicIdentity
    )
  );
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(mockOnline).toHaveBeenCalledTimes(8);
  expect(result.current.items).toHaveLength(8);
});

it('ignores malformed relationship data instead of fetching it', async () => {
  const { result } = renderHook(() =>
    useCompletionRecommendations(guide({ id: 'current', type: 'guide', suggests: [null] }), publicIdentity)
  );
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.context.suggests).toEqual([]);
  expect(mockOnline).not.toHaveBeenCalled();
});

it.each([
  { repository: 'app-platform', contentUrl: 'backend-guide:next' },
  { repository: 'online-cdn', contentUrl: 'backend-guide:next' },
  { repository: 'online-cdn', contentUrl: '/apis/private/next' },
])('rejects a public relationship resolving to private content (%j)', async (overrides) => {
  mockOnline.mockResolvedValue({ ...resolveResult('next'), ...overrides });
  const content = guide({ id: 'current', type: 'guide', suggests: ['next'] });
  const { result } = renderHook(() => useCompletionRecommendations(content, publicIdentity));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.items).toEqual([]);
});

it('rejects a private reference with a locator belonging to another package', async () => {
  mockPrivate.mockResolvedValue({ ...resolveResult('next', 'app-platform'), contentUrl: 'backend-guide:other' });
  const content = guide({ id: 'current', type: 'guide', suggests: ['next'] });
  const { result } = renderHook(() => useCompletionRecommendations(content, privateIdentity));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.items).toEqual([]);
});

it('settles unavailable references without exposing invented cards', async () => {
  mockBundled.mockRejectedValue(new Error('unavailable'));
  const content = guide({ id: 'current', type: 'guide', suggests: ['next'] });
  const { result } = renderHook(() => useCompletionRecommendations(content, publicIdentity));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.items).toEqual([]);
});

it('resolves a healthy authored suggestion even when the first lookup hangs', async () => {
  jest.useFakeTimers();
  mockPrivate.mockImplementation((id: string) =>
    id === 'slow' ? new Promise(() => {}) : Promise.resolve(resolveResult(id, 'app-platform'))
  );
  const content = guide({ id: 'current', type: 'guide', suggests: ['slow', 'healthy'] });
  const { result, unmount } = renderHook(() => useCompletionRecommendations(content, privateIdentity));
  await act(async () => {});
  expect(mockPrivate).toHaveBeenCalledWith('healthy', expect.anything());
  await act(async () => jest.advanceTimersByTime(4000));
  expect(result.current.loading).toBe(false);
  expect(result.current.items.map((item) => item.id)).toEqual(['healthy']);
  unmount();
  jest.useRealTimers();
});

it('rejects a public fallback resolving a different package identity', async () => {
  mockOnline.mockResolvedValue(resolveResult('other'));
  const content = guide({ id: 'current', type: 'guide', suggests: ['next'] });
  const { result } = renderHook(() => useCompletionRecommendations(content, publicIdentity));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.items).toEqual([]);
});

it('settles a hanging resolution and ignores its eventual result', async () => {
  jest.useFakeTimers();
  let finish: (value: unknown) => void = () => {};
  mockPrivate.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const content = guide({ id: 'current', type: 'guide', suggests: ['next'] });
  const { result, unmount } = renderHook(() => useCompletionRecommendations(content, privateIdentity));
  expect(result.current.loading).toBe(true);
  await act(async () => jest.advanceTimersByTime(4000));
  expect(result.current.loading).toBe(false);
  await act(async () => finish(resolveResult('next', 'app-platform')));
  expect(result.current.items).toEqual([]);
  unmount();
  jest.useRealTimers();
});

it('rejects references without a human title', async () => {
  mockOnline.mockResolvedValue({ ...resolveResult('next'), entryTitle: undefined });
  const content = guide({ id: 'current', type: 'guide', suggests: ['next'] });
  const { result } = renderHook(() => useCompletionRecommendations(content, publicIdentity));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.items).toEqual([]);
});

it.each([publicIdentity, privateIdentity])(
  'does not resolve prerequisites as next steps for $guideSource content',
  async (identity) => {
    const { result } = renderHook(() =>
      useCompletionRecommendations(
        guide({
          id: 'current',
          type: 'guide',
          depends: ['required-first'],
          recommends: ['recommended-first'],
        }),
        identity
      )
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toEqual([]);
    expect(mockBundled).not.toHaveBeenCalled();
    expect(mockOnline).not.toHaveBeenCalled();
    expect(mockPrivate).not.toHaveBeenCalled();
  }
);
