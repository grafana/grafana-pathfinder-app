/**
 * Tests for the coda-exit-zero requirement check.
 */

import { codaExitZeroCheck } from './coda';
import { execInSession } from '../../integrations/coda/coda-api';
import { getTerminalSessionId } from '../../integrations/coda/TerminalContext';

jest.mock('../../integrations/coda/coda-api', () => ({
  execInSession: jest.fn(),
}));

jest.mock('../../integrations/coda/TerminalContext', () => ({
  getTerminalSessionId: jest.fn(),
}));

const mockedExec = execInSession as jest.MockedFunction<typeof execInSession>;
const mockedSessionId = getTerminalSessionId as jest.MockedFunction<typeof getTerminalSessionId>;

const SESSION_ID = 's_0123456789abcdef0123456789abcdef';

describe('codaExitZeroCheck', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedSessionId.mockReturnValue(SESSION_ID);
  });

  it('passes when exit code is 0', async () => {
    mockedExec.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, durationMs: 42 });

    const result = await codaExitZeroCheck('coda-exit-zero:test -f /etc/foo');

    expect(result.pass).toBe(true);
    expect(mockedExec).toHaveBeenCalledWith(
      SESSION_ID,
      expect.objectContaining({ command: 'test -f /etc/foo', mode: 'gated' })
    );
  });

  it('fails when exit code is non-zero', async () => {
    mockedExec.mockResolvedValue({ stdout: '', stderr: 'no such file\n', exitCode: 1, durationMs: 30 });

    const result = await codaExitZeroCheck('coda-exit-zero:test -f /missing');

    expect(result.pass).toBe(false);
    expect(result.error).toContain('exited with code 1');
    expect(result.error).toContain('no such file');
  });

  it('always uses gated mode', async () => {
    mockedExec.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, durationMs: 1 });

    await codaExitZeroCheck('coda-exit-zero:true');

    expect(mockedExec).toHaveBeenCalledWith(SESSION_ID, expect.objectContaining({ mode: 'gated' }));
  });

  it('fails with friendly message when command is missing', async () => {
    const result = await codaExitZeroCheck('coda-exit-zero:');

    expect(result.pass).toBe(false);
    expect(result.error).toMatch(/requires a command/);
    expect(mockedExec).not.toHaveBeenCalled();
  });

  // Without an active session there is nothing to exec against, so the check
  // must explain the prerequisite rather than spend a request to find out.
  it('reports not-ready when there is no active session', async () => {
    mockedSessionId.mockReturnValue(null);

    const result = await codaExitZeroCheck('coda-exit-zero:true');

    expect(result.pass).toBe(false);
    expect(result.error).toMatch(/environment is not ready/i);
    expect(mockedExec).not.toHaveBeenCalled();
  });

  it('translates 409 into a setup-prerequisite error', async () => {
    mockedExec.mockRejectedValue(new Error('Request failed with status 409: no active terminal'));

    const result = await codaExitZeroCheck('coda-exit-zero:true');

    expect(result.pass).toBe(false);
    expect(result.error).toMatch(/environment is not ready/i);
  });

  // A vanished session reads the same as a not-yet-connected one.
  it('translates 404 into a setup-prerequisite error', async () => {
    mockedExec.mockRejectedValue(new Error('Request failed with status 404'));

    const result = await codaExitZeroCheck('coda-exit-zero:true');

    expect(result.pass).toBe(false);
    expect(result.error).toMatch(/environment is not ready/i);
  });

  it('surfaces other transport errors verbatim', async () => {
    mockedExec.mockRejectedValue(new Error('Network down'));

    const result = await codaExitZeroCheck('coda-exit-zero:true');

    expect(result.pass).toBe(false);
    expect(result.error).toMatch(/Network down/);
  });

  it('preserves shell metacharacters in the command parameter', async () => {
    mockedExec.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, durationMs: 1 });

    await codaExitZeroCheck('coda-exit-zero:curl -sf localhost:9090/-/healthy | grep -q ok');

    expect(mockedExec).toHaveBeenCalledWith(
      SESSION_ID,
      expect.objectContaining({ command: 'curl -sf localhost:9090/-/healthy | grep -q ok' })
    );
  });

  it('reports truncation and duration in the result context', async () => {
    mockedExec.mockResolvedValue({ stdout: 'x', stderr: '', exitCode: 0, durationMs: 77, truncated: true });

    const result = await codaExitZeroCheck('coda-exit-zero:true');

    expect(result.context).toEqual({ exitCode: 0, durationMs: 77, truncated: true });
  });
});
