/**
 * Tests for the coda-exit-zero requirement check.
 */

import { codaExitZeroCheck } from './coda';
import { execInSession, PATHFINDER_READY_FILE } from '../../integrations/coda/coda-api';
import { getTerminalSessionId } from '../../integrations/coda/TerminalContext';

// Only the request is mocked. toCodaError and the isNotReady/isRoleForbidden
// classification are the behaviour under test here, so they stay real.
jest.mock('../../integrations/coda/coda-api', () => ({
  ...jest.requireActual('../../integrations/coda/coda-api'),
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
      expect.objectContaining({ command: 'test -f /etc/foo', readyFile: PATHFINDER_READY_FILE })
    );
  });

  it('fails when exit code is non-zero', async () => {
    mockedExec.mockResolvedValue({ stdout: '', stderr: 'no such file\n', exitCode: 1, durationMs: 30 });

    const result = await codaExitZeroCheck('coda-exit-zero:test -f /missing');

    expect(result.pass).toBe(false);
    expect(result.error).toContain('exited with code 1');
    expect(result.error).toContain('no such file');
  });

  // The gate is what stops a "check my work" click evaluating the criterion
  // before the challenge's setup phase has finished writing it.
  it('always gates on the shared ready file', async () => {
    mockedExec.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, durationMs: 1 });

    await codaExitZeroCheck('coda-exit-zero:true');

    expect(mockedExec).toHaveBeenCalledWith(SESSION_ID, expect.objectContaining({ readyFile: PATHFINDER_READY_FILE }));
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

  // 'not yet connected' and 'no longer connected' share neither a status nor
  // a recovery, but both read as not-ready to a learner. Classified by code:
  // the message wording is not a contract.
  it.each([
    ['terminal_not_connected', 409],
    ['terminal_disconnected', 503],
    ['session_not_found', 404],
  ])('translates %s into a setup-prerequisite error', async (code, status) => {
    mockedExec.mockRejectedValue({ status, data: { error: 'backend wording', code } });

    const result = await codaExitZeroCheck('coda-exit-zero:true');

    expect(result.pass).toBe(false);
    expect(result.error).toMatch(/environment is not ready/i);
    expect(result.context).toMatchObject({ code });
  });

  // The Coda plugin gates quota-spending routes on a Grafana basic role, so a
  // Viewer must be told that rather than 'environment is not ready', which
  // would send them round a loop that cannot succeed.
  it('explains a role refusal rather than calling it not-ready', async () => {
    mockedExec.mockRejectedValue({
      status: 403,
      data: { error: 'Your Grafana role does not allow creating sandbox sessions', code: 'role_forbidden' },
    });

    const result = await codaExitZeroCheck('coda-exit-zero:true');

    expect(result.pass).toBe(false);
    expect(result.error).toMatch(/role does not allow/i);
    expect(result.error).not.toMatch(/not ready/i);
  });

  // A 404 with no code did not come from the plugin: it is absent entirely.
  it('reports an absent plugin as unavailable', async () => {
    mockedExec.mockRejectedValue({ status: 404 });

    const result = await codaExitZeroCheck('coda-exit-zero:true');

    expect(result.pass).toBe(false);
    expect(result.error).toMatch(/unavailable/i);
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
