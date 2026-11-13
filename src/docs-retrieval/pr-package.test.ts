import { fetchPrPackageInfo, resolvePrPath } from './pr-package';
import { fetchSnapshotJson, PrSnapshotFetchError } from '../lib/pr-preview-fetch';
import { prPreviewContext } from '../lib/pr-preview-core';
import { fetchPackageContent, setPackageResolver } from './content-fetcher/package-content';

jest.mock('../lib/pr-preview-fetch', () => ({
  ...jest.requireActual('../lib/pr-preview-fetch'),
  fetchSnapshotJson: jest.fn(),
  activePrPreview: (url: string) => prPreviewContext(url),
}));
const url = `https://raw.githubusercontent.com/fork/repo/${'a'.repeat(40)}/path/content.json#pf-pr-kiosk123`;
it('reads the sibling manifest from the pinned snapshot', async () => {
  jest.mocked(fetchSnapshotJson).mockResolvedValue({ id: 'path', type: 'path', milestones: ['first'] });
  const result = await fetchPrPackageInfo(url);
  expect(result?.packageManifest.type).toBe('path');
  expect(fetchSnapshotJson).toHaveBeenLastCalledWith(
    expect.objectContaining({ sha: 'a'.repeat(40) }),
    'path/manifest.json'
  );
});
it('resolves milestones and tracks from the snapshot with isolated URLs', async () => {
  jest
    .mocked(fetchSnapshotJson)
    .mockImplementation(async (_snapshot, path) =>
      path.endsWith('manifest.json')
        ? { id: path.split('/')[0], type: 'guide' }
        : { id: path.split('/')[0], title: path.split('/')[0] }
    );
  const result = await resolvePrPath(url, {
    id: 'path',
    type: 'path',
    milestones: ['first'],
    tracks: [{ trackId: 'extra', label: 'Extra', guides: ['second'] }],
  });
  expect(result.milestones[0]?.url).toBe(url.replace('/path/', '/first/'));
  expect(result.tracks.resolved[0]?.milestones[0]?.url).toBe(url.replace('/path/', '/second/'));
  expect(result.baseUrl).toBe(url);
});
it('fails missing dependencies without substituting published content', async () => {
  jest.mocked(fetchSnapshotJson).mockRejectedValue(new Error('PR snapshot file missing'));
  await expect(resolvePrPath(url, { id: 'path', type: 'path', milestones: ['missing'] })).rejects.toThrow('missing');
});

it('allows a missing manifest only for a legacy guide', async () => {
  jest.mocked(fetchSnapshotJson).mockRejectedValue(new PrSnapshotFetchError(404, 'path/manifest.json'));
  await expect(fetchPrPackageInfo(url.replace('kiosk123', 'kiosklegacy123'))).resolves.toBeUndefined();
  await expect(fetchPrPackageInfo(url)).rejects.toThrow('manifest.json');
});

it('does not hide other legacy snapshot errors', async () => {
  jest.mocked(fetchSnapshotJson).mockRejectedValue(new PrSnapshotFetchError(403, 'path/manifest.json'));
  await expect(fetchPrPackageInfo(url.replace('kiosk123', 'kiosklegacy123'))).rejects.toThrow('HTTP 403');
});

it('replaces supplied published milestones with snapshot navigation without consulting the published resolver', async () => {
  const resolve = jest.fn();
  setPackageResolver({ resolve });
  jest
    .mocked(fetchSnapshotJson)
    .mockImplementation(async (_snapshot, path) =>
      path.endsWith('manifest.json')
        ? { id: path.split('/')[0], type: 'guide' }
        : { id: path.split('/')[0], title: path.split('/')[0] }
    );
  const source = url.replace('kiosk123', 'kiosk789');
  const manifest = { id: 'path', type: 'path', milestones: ['first'] };
  const result = await fetchPackageContent(
    source,
    manifest,
    [
      {
        id: 'first',
        title: 'Published',
        number: 1,
        isActive: false,
        url: 'https://example.com/published/content.json',
      },
    ],
    undefined,
    {
      content: {
        content: JSON.stringify({ id: 'path', title: 'Path', blocks: [{ type: 'markdown', content: 'Start' }] }),
        url: source,
        type: 'interactive',
        metadata: { title: 'Path' },
        lastFetched: '',
      },
    }
  );
  expect(result.content?.metadata.learningJourney?.milestones[0]?.url).toBe(source.replace('/path/', '/first/'));
  expect(resolve).not.toHaveBeenCalled();
});
