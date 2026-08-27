/**
 * Coda VM exec-based requirement check: `coda-exit-zero:<command>`.
 *
 * Runs the command against the caller's active terminal session via the Coda
 * app plugin, asking the backend to gate the exec on `PATHFINDER_READY_FILE` so
 * it cannot pass before the challenge's setup phase has written it. That stops
 * a verification firing before setup completes — the user clicking "Check my
 * work" the instant the terminal connects, before the environment has been
 * broken.
 *
 * A UI-race guard, not a security boundary, and not an unconditional one: a
 * backend predating `exec.readyFile` ignores the field and runs the command
 * ungated. That is an accepted degradation — the challenge state machine only
 * offers "Check my work" after the sentinel write returns exit 0.
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
  const {
    codaRoleForbiddenMessage,
    execInSession,
    isNotReady,
    isRoleForbidden,
    isUnavailable,
    toCodaError,
    PATHFINDER_READY_FILE,
  } = await import('../../integrations/coda/coda-api');

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
    const data = await execInSession(sessionId, { command, readyFile: PATHFINDER_READY_FILE });

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
    // Branch on the backend's error code, never on the message. Several
    // distinct failures share a status — the pair that matters here is
    // terminal_not_connected (409, "not yet") and terminal_disconnected (503,
    // "not any more"), which a status check cannot tell apart.
    const codaErr = toCodaError(err);
    let error: string;
    if (isNotReady(codaErr)) {
      error = NOT_READY_MESSAGE;
    } else if (isRoleForbidden(codaErr)) {
      error = codaRoleForbiddenMessage();
    } else if (isUnavailable(codaErr)) {
      error = 'The sandbox service is unavailable. An administrator may need to finish setting it up.';
    } else {
      error = `Could not reach the challenge VM: ${codaErr.message}`;
    }
    return {
      requirement: check,
      pass: false,
      error,
      context: { error: codaErr.message, code: codaErr.code },
    };
  }
}
