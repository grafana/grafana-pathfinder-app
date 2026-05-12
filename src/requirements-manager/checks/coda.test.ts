/**
 * Tests for the coda-exit-zero requirement check.
 */

import { codaExitZeroCheck } from './coda';
import { getBackendSrv } from '@grafana/runtime';

jest.mock('@grafana/runtime', () => ({
  getBackendSrv: jest.fn(),
}));

const mockedGetBackendSrv = getBackendSrv as jest.MockedFunction<typeof getBackendSrv>;

function mockPost(response: unknown): jest.Mock {
  const post = jest.fn().mockResolvedValue(response);
  mockedGetBackendSrv.mockReturnValue({ post } as unknown as ReturnType<typeof getBackendSrv>);
  return post;
}

function mockPostError(error: unknown): jest.Mock {
  const post = jest.fn().mockRejectedValue(error);
  mockedGetBackendSrv.mockReturnValue({ post } as unknown as ReturnType<typeof getBackendSrv>);
  return post;
}

describe('codaExitZeroCheck', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('passes when exit code is 0', async () => {
    const post = mockPost({ stdout: '', stderr: '', exitCode: 0, durationMs: 42 });

    const result = await codaExitZeroCheck('coda-exit-zero:test -f /etc/foo');

    expect(result.pass).toBe(true);
    expect(post).toHaveBeenCalledWith(
      '/api/plugins/grafana-pathfinder-app/resources/coda/exec',
      expect.objectContaining({
        command: 'test -f /etc/foo',
        mode: 'gated',
      })
    );
  });

  it('fails when exit code is non-zero', async () => {
    mockPost({ stdout: '', stderr: 'no such file\n', exitCode: 1, durationMs: 30 });

    const result = await codaExitZeroCheck('coda-exit-zero:test -f /missing');

    expect(result.pass).toBe(false);
    expect(result.error).toContain('exited with code 1');
    expect(result.error).toContain('no such file');
  });

  it('always uses gated mode', async () => {
    const post = mockPost({ stdout: '', stderr: '', exitCode: 0, durationMs: 1 });

    await codaExitZeroCheck('coda-exit-zero:true');

    expect(post).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ mode: 'gated' }));
  });

  it('fails with friendly message when command is missing', async () => {
    const result = await codaExitZeroCheck('coda-exit-zero:');

    expect(result.pass).toBe(false);
    expect(result.error).toMatch(/requires a command/);
  });

  it('translates 409 into a setup-prerequisite error', async () => {
    mockPostError(new Error('Request failed with status 409: no active terminal session'));

    const result = await codaExitZeroCheck('coda-exit-zero:true');

    expect(result.pass).toBe(false);
    expect(result.error).toMatch(/environment is not ready/i);
  });

  it('surfaces other transport errors verbatim', async () => {
    mockPostError(new Error('Network down'));

    const result = await codaExitZeroCheck('coda-exit-zero:true');

    expect(result.pass).toBe(false);
    expect(result.error).toMatch(/Network down/);
  });

  it('preserves shell metacharacters in the command parameter', async () => {
    const post = mockPost({ stdout: '', stderr: '', exitCode: 0, durationMs: 1 });

    await codaExitZeroCheck('coda-exit-zero:curl -sf localhost:9090/-/healthy | grep -q ok');

    expect(post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ command: 'curl -sf localhost:9090/-/healthy | grep -q ok' })
    );
  });
});
