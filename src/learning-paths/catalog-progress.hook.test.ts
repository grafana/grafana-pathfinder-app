import { act, renderHook, waitFor } from '@testing-library/react';
import { useCatalogProgress } from './catalog-progress.hook';
import type { CatalogPackage } from '../types/package-catalog.types';
import type { LearningPath } from '../types/learning-paths.types';
import {
  interactiveCompletionStorage,
  journeyCompletionStorage,
  learningProgressStorage,
  milestoneCompletionStorage,
} from '../lib/user-storage';
import { dispatchProgress } from '../global-state/progress-events';
import { getOrMintAttempt } from '../completion-records/guide-attempts';

jest.mock('../lib/user-storage', () => ({
  interactiveCompletionStorage: { getAll: jest.fn(), set: jest.fn(), clear: jest.fn() },
  journeyCompletionStorage: { getAll: jest.fn(), set: jest.fn(), clear: jest.fn() },
  learningProgressStorage: { get: jest.fn(), update: jest.fn() },
  milestoneCompletionStorage: { getCompletedSync: jest.fn(() => new Set()) },
}));
jest.mock('../completion-records/guide-attempts', () => ({ getOrMintAttempt: jest.fn() }));

const item = (key: string, url: string, extra: Partial<CatalogPackage> = {}): CatalogPackage => ({
  key,
  id: 'dashboard',
  title: 'Dashboard',
  format: 'guide',
  source: 'grafana',
  url,
  ...extra,
});
const emptyProgress = {
  completedGuides: [],
  earnedBadges: [],
  streakDays: 0,
  lastActivityDate: '',
  pendingCelebrations: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(milestoneCompletionStorage.getCompletedSync).mockReturnValue(new Set());
  jest.mocked(interactiveCompletionStorage.getAll).mockResolvedValue({});
  jest.mocked(journeyCompletionStorage.getAll).mockResolvedValue({});
  jest.mocked(learningProgressStorage.get).mockResolvedValue(emptyProgress);
});

it('settles with unknown progress when storage fails so suggestions can still load', async () => {
  jest.mocked(interactiveCompletionStorage.getAll).mockRejectedValue(new Error('Unavailable'));
  const items = [item('bundled:dashboard', 'bundled:dashboard')];
  const { result } = renderHook(() => useCatalogProgress(items, 'org:user'));
  await waitFor(() => expect(result.current.size).toBe(1));
  expect(result.current.get('bundled:dashboard')?.percent).toBe(0);
  expect(getOrMintAttempt).not.toHaveBeenCalled();
});

it('keeps progress distinct for public and private packages with the same ID', async () => {
  const publicUrl = 'https://grafana.com/developer-resources/interactive-tutorials/dashboard/content.json';
  const items = [
    item('online-cdn:dashboard', publicUrl),
    item('app-platform:dashboard', 'backend-guide:dashboard', { source: 'organization' }),
  ];
  jest.mocked(interactiveCompletionStorage.getAll).mockResolvedValue({
    [publicUrl]: 25,
    'backend-guide:dashboard': 75,
    dashboard: 100,
  });
  const { result } = renderHook(() => useCatalogProgress(items, 'org:1:user:1'));
  await waitFor(() => expect(result.current.size).toBe(2));
  expect(result.current.get('online-cdn:dashboard')?.percent).toBe(25);
  expect(result.current.get('app-platform:dashboard')?.percent).toBe(75);
});

it('honors completion evidence only for confirmed bundled guides, not colliding public or private IDs', async () => {
  const id = 'first-dashboard';
  const onlineUrl = 'https://grafana.com/first-dashboard/content.json';
  const items = [
    item(`bundled:${id}`, `bundled:${id}/content.json`, { id }),
    item(`online-cdn:${id}`, onlineUrl, { id }),
    item(`app-platform:${id}`, `backend-guide:${id}`, { id, source: 'organization' }),
    item('bundled:not-in-repository', 'bundled:not-in-repository', { id: 'not-in-repository' }),
  ];
  jest.mocked(learningProgressStorage.get).mockResolvedValue({
    ...emptyProgress,
    completedGuides: [id, 'not-in-repository'],
  });
  jest.mocked(interactiveCompletionStorage.getAll).mockResolvedValue({
    [`bundled:${id}`]: 30,
    [onlineUrl]: 25,
    [`backend-guide:${id}`]: 75,
  });
  const { result } = renderHook(() => useCatalogProgress(items, 'scope'));
  await waitFor(() => expect(result.current.size).toBe(4));
  expect(result.current.get(`bundled:${id}`)?.percent).toBe(100);
  expect(result.current.get(`online-cdn:${id}`)?.percent).toBe(25);
  expect(result.current.get(`app-platform:${id}`)?.percent).toBe(75);
  expect(result.current.get('bundled:not-in-repository')?.percent).toBe(0);
});

it.each([
  { url: 'bundled:dashboard', storedUrl: 'bundled:dashboard/content.json' },
  { url: 'bundled:dashboard/content.json', storedUrl: 'bundled:dashboard' },
])('reads both bundled URL shapes without borrowing a different source record ($url)', async ({ url, storedUrl }) => {
  const items = [
    item('bundled:dashboard', url),
    item('online-cdn:dashboard', 'https://grafana.com/dashboard/content.json'),
  ];
  jest.mocked(interactiveCompletionStorage.getAll).mockResolvedValue({ [storedUrl]: 40 });
  const { result } = renderHook(() => useCatalogProgress(items, 'scope'));
  await waitFor(() => expect(result.current.size).toBe(2));
  expect(result.current.get('bundled:dashboard')?.percent).toBe(40);
  expect(result.current.get('online-cdn:dashboard')?.percent).toBe(0);
});

it('keeps the furthest valid progress when both bundled URL shapes have evidence', async () => {
  const items = [item('bundled:dashboard', 'bundled:dashboard/content.json')];
  jest.mocked(interactiveCompletionStorage.getAll).mockResolvedValue({
    'bundled:dashboard': 70,
    'bundled:dashboard/content.json': 30,
  });
  const { result } = renderHook(() => useCatalogProgress(items, 'scope'));
  await waitFor(() => expect(result.current.get('bundled:dashboard')?.percent).toBe(70));
});

it('normalizes invalid evidence and preserves zero and complete states without making writes', async () => {
  const items = ['missing', 'zero', 'invalid', 'negative', 'over', 'complete'].map((id) =>
    item(id, `bundled:${id}`, { id })
  );
  items.push(item('path', 'https://grafana.com/path/content.json', { format: 'path' }));
  jest.mocked(interactiveCompletionStorage.getAll).mockResolvedValue({
    'bundled:zero': 0,
    'bundled:invalid': NaN,
    'bundled:negative': -5,
    'bundled:over': 150,
    'bundled:complete': 100,
  });
  jest.mocked(journeyCompletionStorage.getAll).mockResolvedValue({ 'https://grafana.com/path/content.json': Infinity });
  const { result } = renderHook(() => useCatalogProgress(items, 'scope'));
  await waitFor(() => expect(result.current.size).toBe(7));
  for (const key of ['missing', 'zero', 'invalid', 'negative', 'over', 'path']) {
    expect(result.current.get(key)?.percent).toBe(0);
  }
  expect(result.current.get('complete')?.percent).toBe(100);
  expect(interactiveCompletionStorage.set).not.toHaveBeenCalled();
  expect(journeyCompletionStorage.set).not.toHaveBeenCalled();
  expect(learningProgressStorage.update).not.toHaveBeenCalled();
  expect(getOrMintAttempt).not.toHaveBeenCalled();
});

it('rolls up curated members and chooses the first incomplete member to resume', async () => {
  const curatedPath = {
    id: 'starter',
    title: 'Starter',
    guides: ['first', 'second', 'third'],
  } as LearningPath;
  const items = [item('curated:starter', '', { id: 'starter', format: 'path', curatedPath })];
  jest.mocked(learningProgressStorage.get).mockResolvedValue({ ...emptyProgress, completedGuides: ['first'] });
  jest.mocked(interactiveCompletionStorage.getAll).mockResolvedValue({ 'bundled:second/content.json': 50 });
  const { result } = renderHook(() => useCatalogProgress(items, 'scope'));
  await waitFor(() => expect(result.current.get('curated:starter')).toEqual({ percent: 50, nextId: 'second' }));
});

it('clears the old scope immediately and discards its late storage response', async () => {
  let finishOldRead: (records: Record<string, number>) => void = () => undefined;
  jest
    .mocked(interactiveCompletionStorage.getAll)
    .mockImplementationOnce(() => new Promise((resolve) => (finishOldRead = resolve)))
    .mockResolvedValueOnce({ 'backend-guide:dashboard': 15 });
  const items = [item('app-platform:dashboard', 'backend-guide:dashboard', { source: 'organization' })];
  const { result, rerender } = renderHook(({ scope }) => useCatalogProgress(items, scope), {
    initialProps: { scope: 'org-a:user-a' },
  });
  rerender({ scope: 'org-b:user-b' });
  expect(result.current.size).toBe(0);
  await waitFor(() => expect(result.current.get('app-platform:dashboard')?.percent).toBe(15));
  await act(async () => finishOldRead({ 'backend-guide:dashboard': 90 }));
  expect(result.current.get('app-platform:dashboard')?.percent).toBe(15);
});

it('refreshes persisted progress after the shared guide progress event', async () => {
  const items = [item('bundled:dashboard', 'bundled:dashboard')];
  const { result } = renderHook(() => useCatalogProgress(items, 'scope'));
  await waitFor(() => expect(result.current.get('bundled:dashboard')?.percent).toBe(0));
  jest.mocked(interactiveCompletionStorage.getAll).mockResolvedValue({ 'bundled:dashboard': 30 });
  act(() => dispatchProgress({ kind: 'guide', contentKey: 'bundled:dashboard', percentage: 30, hasProgress: true }));
  await waitFor(() => expect(result.current.get('bundled:dashboard')?.percent).toBe(30));
});

it('recalculates a catalogue path from its members and refreshes it when guide progress changes', async () => {
  const items = [
    item('path', 'bundled:path/content.json', { id: 'path', format: 'path', memberIds: ['first', 'second'] }),
    item('first', 'bundled:first/content.json', { id: 'first' }),
    item('second', 'bundled:second/content.json', { id: 'second' }),
  ];
  jest.mocked(journeyCompletionStorage.getAll).mockResolvedValue({ 'bundled:path/content.json': 33 });
  jest.mocked(interactiveCompletionStorage.getAll).mockResolvedValue({ 'bundled:first/content.json': 100 });
  const { result } = renderHook(() => useCatalogProgress(items, 'scope'));
  await waitFor(() => expect(result.current.get('path')).toEqual({ percent: 50, nextId: 'second' }));

  jest.mocked(interactiveCompletionStorage.getAll).mockResolvedValue({
    'bundled:first/content.json': 100,
    'bundled:second/content.json': 50,
  });
  act(() =>
    dispatchProgress({ kind: 'guide', contentKey: 'bundled:second/content.json', percentage: 50, hasProgress: true })
  );
  await waitFor(() => expect(result.current.get('path')).toEqual({ percent: 75, nextId: 'second' }));
  expect(journeyCompletionStorage.set).not.toHaveBeenCalled();
});

it('includes legacy milestone completions in the catalogue path percentage before opening its sidebar', async () => {
  const items = [
    item('path', 'https://grafana.com/docs/learning-paths/path/', {
      id: 'path',
      format: 'path',
      memberIds: ['first', 'second'],
    }),
    item('first', 'https://grafana.com/docs/learning-paths/path/first/', { id: 'first' }),
    item('second', 'https://grafana.com/docs/learning-paths/path/second/', { id: 'second' }),
  ];
  jest.mocked(milestoneCompletionStorage.getCompletedSync).mockReturnValue(new Set(['first']));
  const { result } = renderHook(() => useCatalogProgress(items, 'scope'));
  await waitFor(() => expect(result.current.get('path')).toEqual({ percent: 50, nextId: 'second' }));
  expect(milestoneCompletionStorage.getCompletedSync).toHaveBeenCalledWith(items[0]!.url, [
    items[1]!.url,
    items[2]!.url,
  ]);
  expect(interactiveCompletionStorage.set).not.toHaveBeenCalled();
});

it('keeps a path member in its own source and excludes members missing from that catalogue', async () => {
  const items = [
    item('public-path', 'bundled:public-path/content.json', {
      id: 'public-path',
      format: 'path',
      memberIds: ['shared', 'unpublished'],
    }),
    item('public-guide', 'bundled:shared/content.json', { id: 'shared' }),
    item('private-guide', 'backend-guide:shared', { id: 'shared', source: 'organization' }),
  ];
  jest.mocked(interactiveCompletionStorage.getAll).mockResolvedValue({
    'bundled:shared/content.json': 25,
    'backend-guide:shared': 100,
  });
  const { result } = renderHook(() => useCatalogProgress(items, 'scope'));
  await waitFor(() => expect(result.current.get('public-path')).toEqual({ percent: 25, nextId: 'shared' }));
});
