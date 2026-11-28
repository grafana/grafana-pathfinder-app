import { prSnippetResolver } from './pr-snippet-resolver';
import { fetchSnapshotJson } from '../lib/pr-preview-fetch';
import { prPreviewContext } from '../lib/pr-preview-core';

jest.mock('../lib/pr-preview-fetch', () => ({
  fetchSnapshotJson: jest.fn(),
  activePrPreview: (url: string) => prPreviewContext(url),
}));
const url = `https://raw.githubusercontent.com/fork/repo/${'a'.repeat(40)}/demo/content.json#pf-pr-kiosk123`;
it('loads snippets from the same snapshot', async () => {
  jest.mocked(fetchSnapshotJson).mockResolvedValue({
    schemaVersion: '1.0.0',
    id: 'setup',
    title: 'Setup',
    description: 'Setup',
    blocks: [{ type: 'markdown', content: 'Hello' }],
  });
  expect((await prSnippetResolver(url)!.resolve('setup')).ok).toBe(true);
  expect(fetchSnapshotJson).toHaveBeenLastCalledWith(
    expect.objectContaining({ sha: 'a'.repeat(40) }),
    'shared/snippets/setup.json'
  );
});
it('reports missing snippets and refuses unsafe IDs', async () => {
  jest.mocked(fetchSnapshotJson).mockRejectedValue(new Error('Missing snapshot snippet'));
  expect((await prSnippetResolver(url)!.resolve('missing')).ok).toBe(false);
  expect((await prSnippetResolver(url)!.resolve('../escape')).ok).toBe(false);
});
it('leaves ordinary guide snippet resolution unchanged', () => {
  expect(prSnippetResolver('https://interactive-learning.grafana.net/packages/demo/content.json')).toBeUndefined();
});
