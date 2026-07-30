/**
 * Coda VM exec-based requirement check: `coda-exit-zero:<command>`.
 *
 * Runs the command against the caller's active terminal session via the Coda
 * app plugin. Always uses gated mode, so the check cannot pass before the
 * challenge's setup phase has written the sentinel file at
 * `/tmp/pathfinder-ready`. This protects against verifications firing before
 * setup completes (e.g., user clicks "Check my work" the instant the terminal
 * connects, before the environment has been broken).
 *
 * Use `grep -q`, `jq -e`, `test -f`, or any unix tool that returns 0 on
 * success to express richer matchers — the check is intentionally restricted
 * to exit-code semantics rather than a separate regex matcher type.
 */

import type { CheckResultError } from '../../types/requirements.types';

const NOT_READY_MESSAGE = 'Challenge environment is not ready. Start the challenge to provision a VM.';

export async function codaExitZeroCheck(check: string): Promise<CheckResultError> {
  const command = check.slice('coda-exit-zero:'.length);
  if (!command) {
    return {
      requirement: check,
      pass: false,
      error: 'coda-exit-zero requires a command (e.g. coda-exit-zero:test -f /etc/foo)',
      context: null,
    };
  }

  // Dynamic import keeps the Coda integration out of the requirements chunk and
  // avoids a requirements-manager → integrations cycle.
  const { getTerminalSessionId } = await import('../../integrations/coda/TerminalContext');
  const { execInSession } = await import('../../integrations/coda/coda-api');

  const sessionId = getTerminalSessionId();
  if (!sessionId) {
    return {
      requirement: check,
      pass: false,
      error: NOT_READY_MESSAGE,
      context: { error: 'no active session' },
    };
  }

  try {
    const data = await execInSession(sessionId, { command, mode: 'gated' });

    const pass = data.exitCode === 0;
    return {
      requirement: check,
      pass,
      error: pass
        ? undefined
        : `Check command exited with code ${data.exitCode}${data.stderr ? `: ${data.stderr.trim().slice(0, 200)}` : ''}`,
      context: {
        exitCode: data.exitCode,
        durationMs: data.durationMs,
        truncated: data.truncated ?? false,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // A 409 means the session exists but its terminal is not connected; a 404
    // means the session is gone. Both are "not ready" from the learner's view.
    const isNotReady = /404|409|no active terminal|not found/i.test(message);
    return {
      requirement: check,
      pass: false,
      error: isNotReady ? NOT_READY_MESSAGE : `Could not reach the challenge VM: ${message}`,
      context: { error: message },
    };
  }
}
