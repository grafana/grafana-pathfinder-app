import { loadCatalogMembers } from './catalog-members';
import { AppPlatformPackageResolver } from '../../package-engine';
import { resolvePackageMilestones } from '../../docs-retrieval';
import type { CatalogPackage } from '../../types/package-catalog.types';

const mockResolve = jest.fn();
jest.mock('../../package-engine', () => ({
  AppPlatformPackageResolver: jest.fn().mockImplementation(() => ({ resolve: mockResolve })),
}));
jest.mock('../../docs-retrieval', () => ({ resolvePackageMilestones: jest.fn() }));
const item: CatalogPackage = {
  key: 'app-platform:path',
  id: 'path',
  title: 'Team path',
  format: 'path',
  source: 'organization',
  url: 'backend-guide:path',
  memberIds: ['dashboard'],
};

beforeEach(() => {
  jest.clearAllMocks();
});

it('resolves private members in their own source even when a public guide has the same ID', async () => {
  mockResolve.mockResolvedValue({ ok: true, contentUrl: 'backend-guide:dashboard', entryTitle: 'Team dashboard' });
  const publicGuide: CatalogPackage = {
    ...item,
    key: 'bundled:dashboard',
    id: 'dashboard',
    title: 'Public dashboard',
    format: 'guide',
    source: 'grafana',
    url: 'bundled:dashboard',
    memberIds: undefined,
  };
  const members = await loadCatalogMembers(item, [publicGuide], 'private-scope', new AbortController().signal);
  expect(AppPlatformPackageResolver).toHaveBeenCalled();
  expect(resolvePackageMilestones).not.toHaveBeenCalled();
  expect(members[0]?.title).toBe('Team dashboard');
  expect(mockResolve).toHaveBeenCalledWith('dashboard', { loadContent: 'metadata-only' });
});

it('does not reuse private metadata after the user or organization changes', async () => {
  mockResolve
    .mockResolvedValueOnce({ ok: true, contentUrl: 'backend-guide:dashboard', entryTitle: 'First team' })
    .mockResolvedValueOnce({ ok: true, contentUrl: 'backend-guide:dashboard', entryTitle: 'Second team' });
  await loadCatalogMembers(item, [], 'first-scope', new AbortController().signal);
  const second = await loadCatalogMembers(item, [], 'second-scope', new AbortController().signal);
  expect(mockResolve).toHaveBeenCalledTimes(2);
  expect(second[0]?.title).toBe('Second team');
});

it('skips metadata work when expansion was cancelled before its queue slot opens', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(loadCatalogMembers(item, [], 'cancelled-scope', controller.signal)).rejects.toThrow('cancelled');
  expect(mockResolve).not.toHaveBeenCalled();
});
