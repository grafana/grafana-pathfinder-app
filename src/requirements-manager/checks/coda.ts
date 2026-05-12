/**
 * Coda VM exec-based requirement check: `coda-exit-zero:<command>`.
 *
 * Runs the command against the caller's active terminal VM via the
 * `/coda/exec` plugin resource. Always uses gated mode, so the check cannot
 * pass before the challenge's setup phase has written the sentinel file at
 * `/tmp/pathfinder-ready`. This protects against verifications firing
 * before setup completes (e.g., user clicks "Check my work" the instant the
 * terminal connects, before the environment has been broken).
 *
 * Use `grep -q`, `jq -e`, `test -f`, or any unix tool that returns 0 on
 * success to express richer matchers — the check is intentionally restricted
 * to exit-code semantics rather than a separate regex matcher type.
 */

import type { CheckResultError } from '../requirements-checker.utils';
import { getBackendSrv } from '@grafana/runtime';
import { lastValueFrom } from 'rxjs';

const CODA_EXEC_URL = '/api/plugins/grafana-pathfinder-app/resources/coda/exec';

interface CodaExecResponse {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  truncated?: boolean;
}

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

  try {
    // .fetch with showErrorAlert: false so a check that finds the env not
    // ready (or any other backend error) doesn't trigger a global toast on
    // top of the in-block failure message.
    const resp = await lastValueFrom(
      getBackendSrv().fetch<CodaExecResponse>({
        url: CODA_EXEC_URL,
        method: 'POST',
        data: { command, mode: 'gated' },
        showErrorAlert: false,
      })
    );
    const data = resp.data;

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
    // 409 from the backend means no active terminal — translate that to a
    // user-meaningful explanation that explains the prerequisite rather than
    // surfacing the raw HTTP error.
    const isNoSession = /409|no active terminal/i.test(message);
    return {
      requirement: check,
      pass: false,
      error: isNoSession
        ? 'Challenge environment is not ready. Start the challenge to provision a VM.'
        : `Could not reach the challenge VM: ${message}`,
      context: { error: message },
    };
  }
}
