/**
 * `prettier` is a devDependency and is absent from `RUNTIME_DEPS` in
 * `scripts/cli-build-utils.js`, so it does not exist in the published CLI
 * image — the artifact `CLI_TOOLS.md` tells content repos to run in CI. Every
 * `build-*` command writes through `formatJsonWithPrettier`, so an unguarded
 * import makes the whole write path fail there with `Cannot find module
 * 'prettier'` while `--check` keeps working: a repo could adopt the documented
 * gate and have no way to satisfy it.
 *
 * This pins the degradation. The Docker smoke test only asserts `--version`,
 * and every other suite mocks prettier with an identity formatter, so nothing
 * else covers the missing-module path.
 */

jest.mock('prettier', () => {
  throw new Error("Cannot find module 'prettier'");
});

import { formatJsonWithPrettier } from '../utils/output';

describe('formatJsonWithPrettier without prettier installed', () => {
  it('returns the input unformatted rather than throwing', async () => {
    const json = JSON.stringify({ id: 'a', stats: { blockCount: 3 } }, null, 2);

    await expect(formatJsonWithPrettier(json)).resolves.toBe(`${json}\n`);
  });

  it('still emits exactly one trailing newline', async () => {
    await expect(formatJsonWithPrettier('{}\n')).resolves.toBe('{}\n');
    await expect(formatJsonWithPrettier('{}')).resolves.toBe('{}\n');
  });

  it('degrades to output a JSON parser still accepts', async () => {
    const formatted = await formatJsonWithPrettier(JSON.stringify({ version: 1, blockCount: 12 }, null, 2));

    expect(JSON.parse(formatted)).toEqual({ version: 1, blockCount: 12 });
  });
});
