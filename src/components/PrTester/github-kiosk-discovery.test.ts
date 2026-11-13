import { fetchPrContentFiles } from './github-api';
const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});
it('paginates, uses fork head paths, and discovers unchanged kiosks', async () => {
  const sha = 'a'.repeat(40);
  global.fetch = jest.fn(async (input) => {
    const url = String(input);
    const body = url.endsWith('/pulls/1')
      ? { head: { sha, repo: { name: 'fork-repo', owner: { login: 'reviewer' } } } }
      : new URL(url).searchParams.get('page') === '1'
        ? Array.from({ length: 100 }, (_, i) => ({ filename: `assets/${i}.png`, status: 'modified' }))
        : new URL(url).searchParams.get('page') === '2'
          ? [
              { filename: 'kiosk/new/rules.json', status: 'renamed' },
              { filename: 'kiosk/removed/rules.json', status: 'removed' },
            ]
          : {
              tree: [
                { path: 'kiosk/new/rules.json', type: 'blob' },
                { path: 'kiosk/existing/rules.json', type: 'blob' },
              ],
            };
    return { ok: true, json: async () => body } as Response;
  });
  const result = await fetchPrContentFiles('grafana', 'interactive-tutorials', 1);
  expect(result.success).toBe(true);
  if (!result.success) {
    return;
  }
  expect(result.files.map((file) => [file.directoryName, file.status])).toEqual([
    ['kiosk/new', 'renamed'],
    ['kiosk/existing', 'unchanged'],
  ]);
  expect(
    result.files.every((file) => file.rawUrl.startsWith(`https://raw.githubusercontent.com/reviewer/fork-repo/${sha}/`))
  ).toBe(true);
  expect(global.fetch).toHaveBeenCalledWith(
    expect.stringContaining(`/repos/reviewer/fork-repo/git/trees/${sha}`),
    expect.anything()
  );
});
it('warns when unchanged kiosk discovery is incomplete', async () => {
  global.fetch = jest.fn(
    async (input) =>
      ({
        ok: true,
        json: async () =>
          String(input).endsWith('/pulls/1')
            ? { head: { sha: 'a'.repeat(40) } }
            : String(input).includes('/files?')
              ? [{ filename: 'kiosk/demo/rules.json', status: 'added' }]
              : { tree: [], truncated: true },
      }) as Response
  );
  const result = await fetchPrContentFiles('org', 'repo', 1);
  expect(result.success && result.warning).toContain('unchanged kiosks');
});
