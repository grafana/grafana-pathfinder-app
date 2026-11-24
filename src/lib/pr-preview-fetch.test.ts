import { activePrPreview, fetchSnapshotJson } from './pr-preview-fetch';
import { isDevModeEnabledGlobal } from '../utils/dev-mode';
jest.mock('../utils/dev-mode', () => ({ isDevModeEnabledGlobal: jest.fn(() => true) }));
const snapshot = { owner: 'fork', repo: 'repo', sha: 'a'.repeat(40) };
const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  jest.mocked(isDevModeEnabledGlobal).mockReturnValue(true);
});
it('requires dev mode for fetching and reconstructing a preview', async () => {
  jest.mocked(isDevModeEnabledGlobal).mockReturnValue(false);
  expect(
    activePrPreview(`https://raw.githubusercontent.com/fork/repo/${snapshot.sha}/demo/content.json#pf-pr-kiosk123`)
  ).toBeUndefined();
  global.fetch = jest.fn();
  await expect(fetchSnapshotJson(snapshot, 'demo/content.json')).rejects.toThrow('dev mode');
  expect(global.fetch).not.toHaveBeenCalled();
});
it('omits credentials, rejects redirects, and reports missing snapshot files', async () => {
  global.fetch = jest.fn(async () => ({ ok: false, status: 404 }) as Response);
  await expect(fetchSnapshotJson(snapshot, 'missing/content.json')).rejects.toThrow('missing/content.json');
  expect(global.fetch).toHaveBeenCalledWith(
    expect.stringContaining(snapshot.sha),
    expect.objectContaining({ credentials: 'omit', redirect: 'error', signal: expect.any(AbortSignal) })
  );
});
