/**
 * ChallengeBlock — CTF-style learning task rendered inside a Pathfinder guide.
 *
 * Lifecycle (see `ChallengeState`):
 *   idle → connecting → preparing → ready → checking → solved | failed-check | setup-failed
 *
 * The block runs `setupCommands` server-side via `/coda/exec` after the VM
 * connects, then makes "Check my work" available. A sentinel file is written
 * as the last setup step, and the success criterion is evaluated with
 * `checkPostconditions` (the underlying `coda-exit-zero` check always runs in
 * gated mode), so it cannot pass before setup completes — defense in depth on
 * top of the UI gating.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Button, Icon, useStyles2, Alert } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { getBackendSrv } from '@grafana/runtime';
import { lastValueFrom } from 'rxjs';
import { css } from '@emotion/css';

import { useTerminalContext } from '../../integrations/coda/TerminalContext';
import { checkPostconditions } from '../../requirements-manager';
import { markStepCompleted, useStepCompletion } from '../../global-state/completion-store';

const CODA_EXEC_URL = '/api/plugins/grafana-pathfinder-app/resources/coda/exec';
// /tmp/pathfinder-ready matches codaSentinelPath in the Go backend. The
// atomic temp+rename guarantees the gated coda-exit-zero check never sees a
// partially-written sentinel.
const SENTINEL_WRITE_COMMAND = 'touch /tmp/pathfinder-ready.tmp && mv /tmp/pathfinder-ready.tmp /tmp/pathfinder-ready';

// Module-level stable empty array used as the default for `setupCommands`.
// Defining the default inline (`setupCommands = []`) would mint a new array on
// every render, churning the `runSetup` callback and cascading remounts through
// the dependent useEffect. Frozen so an accidental mutation surfaces in dev.
const EMPTY_SETUP_COMMANDS = Object.freeze([]) as unknown as string[];

export type ChallengeState =
  | 'idle'
  | 'connecting'
  | 'preparing'
  | 'ready'
  | 'checking'
  | 'solved'
  | 'failed-check'
  | 'setup-failed';

export interface ChallengeHintProps {
  text: string;
}

export interface ChallengeBlockProps {
  title: string;
  brief: React.ReactNode;
  /**
   * Execution model. 'standard' runs against the user's Grafana (no VM, no
   * terminal, no setup phase — block renders with Check my work
   * immediately). 'coda' (default for back-compat) runs in a Coda VM with
   * the existing Start → connecting → preparing → ready flow.
   */
  mode?: 'coda' | 'standard';
  vmTemplate?: string;
  vmScenario?: string;
  vmApp?: string;
  /**
   * Deprecated. Use setupScript for new content. When both are present at
   * runtime, setupScript wins. Existing JSON guides with setupCommands still
   * work — the loop runs each command sequentially.
   */
  setupCommands?: string[];
  /** Bash script run as a single /coda/exec call on the remote shell. */
  setupScript?: string;
  successCriteria: string;
  hintLevels?: ChallengeHintProps[];
  failureMessage?: string;

  stepId?: string;
  onStepComplete?: (stepId: string) => void;
  stepIndex?: number;
  totalSteps?: number;
  sectionId?: string;
}

interface ExecResponse {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

async function runExec(command: string, mode: 'raw' | 'gated' = 'raw', timeoutMs = 10000): Promise<ExecResponse> {
  // Use .fetch with showErrorAlert: false so 4xx/5xx don't trigger Grafana's
  // global error toast — the challenge block surfaces these errors in-place.
  const resp = await lastValueFrom(
    getBackendSrv().fetch<ExecResponse>({
      url: CODA_EXEC_URL,
      method: 'POST',
      data: { command, mode, timeoutMs },
      showErrorAlert: false,
    })
  );
  return resp.data;
}

let challengeCounter = 0;

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    padding: theme.spacing(2),
    marginBottom: theme.spacing(2),
    background: theme.colors.background.secondary,
  }),
  title: css({
    margin: 0,
    marginBottom: theme.spacing(1),
    fontSize: theme.typography.h4.fontSize,
    fontWeight: theme.typography.h4.fontWeight,
  }),
  brief: css({
    marginBottom: theme.spacing(2),
    '& p:last-child': { marginBottom: 0 },
  }),
  status: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    marginBottom: theme.spacing(1.5),
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
  }),
  failedCheck: css({
    display: 'flex',
    alignItems: 'flex-start',
    gap: theme.spacing(1),
    marginBottom: theme.spacing(1.5),
    padding: theme.spacing(1, 1.5),
    backgroundColor: theme.colors.warning.transparent,
    border: `1px solid ${theme.colors.warning.border}`,
    borderRadius: theme.shape.radius.default,
    color: theme.colors.text.primary,
    fontSize: theme.typography.bodySmall.fontSize,
    '& > svg': {
      flexShrink: 0,
      marginTop: '2px',
      color: theme.colors.warning.text,
    },
  }),
  actions: css({
    display: 'flex',
    gap: theme.spacing(1),
    alignItems: 'center',
    flexWrap: 'wrap',
  }),
  hints: css({
    marginTop: theme.spacing(2),
    paddingTop: theme.spacing(2),
    borderTop: `1px solid ${theme.colors.border.weak}`,
  }),
  hint: css({
    padding: theme.spacing(1, 1.5),
    marginBottom: theme.spacing(1),
    background: theme.colors.background.primary,
    borderLeft: `3px solid ${theme.colors.info.border}`,
    borderRadius: theme.shape.radius.default,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  hintIndex: css({
    fontWeight: theme.typography.fontWeightBold,
    color: theme.colors.info.text,
    marginRight: theme.spacing(0.5),
  }),
  solved: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    color: theme.colors.success.text,
    fontSize: theme.typography.body.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
  }),
});

export const ChallengeBlock: React.FC<ChallengeBlockProps> = ({
  title,
  brief,
  mode = 'coda',
  vmTemplate,
  vmScenario,
  vmApp,
  setupCommands = EMPTY_SETUP_COMMANDS,
  setupScript,
  successCriteria,
  hintLevels = [],
  failureMessage,
  stepId: providedStepId,
  onStepComplete,
  sectionId,
}) => {
  const styles = useStyles2(getStyles);
  const terminalCtx = useTerminalContext();

  const [generatedStepId] = useState(() => {
    challengeCounter += 1;
    return `challenge-${challengeCounter}`;
  });
  const stepId = providedStepId ?? generatedStepId;

  // Standard-mode challenges have no provisioning step to opt into — the
  // brief and Check my work are visible immediately. Coda-mode challenges
  // start at idle so the learner clicks Start (which triggers terminal
  // open + setup script).
  const [state, setState] = useState<ChallengeState>(mode === 'standard' ? 'ready' : 'idle');
  const [errorDetail, setErrorDetail] = useState<string>('');
  const [hintsRevealed, setHintsRevealed] = useState(0);
  // Setup progress (current step / total) — surfaced in the status banner so
  // a slow setup (multiple commands, ~2-30s each) reads as progress rather
  // than a hang. Reset to null whenever runSetup re-enters.
  const [setupProgress, setSetupProgress] = useState<{ current: number; total: number } | null>(null);
  const setupStartedRef = useRef(false);
  // Cancellation flag checked by runSetup between commands. The in-flight
  // command still completes (we don't abort fetches mid-flight today) but no
  // subsequent commands run and the block returns to idle.
  const cancelRequestedRef = useRef(false);
  // Status the terminal had when the user clicked Start. We use this to
  // ignore a stale 'error' (or any other) status until the terminal has
  // observably transitioned in response to our openTerminal call — otherwise
  // clicking Try again after a credentials failure would immediately bail
  // back to setup-failed before the new connection attempt completes.
  const statusAtStartRef = useRef<string | undefined>(undefined);

  const { completed: storedCompleted } = useStepCompletion(stepId, sectionId);
  const isStandalone = !onStepComplete;
  const isCompleted = storedCompleted || state === 'solved';

  const markComplete = useCallback(() => {
    if (storedCompleted) {
      return;
    }
    if (isStandalone) {
      markStepCompleted(stepId, sectionId, 'manual');
    }
    onStepComplete?.(stepId);
    // Dispatch the same completion event used by the rest of the engine so
    // sections, progress tracking, and analytics all see this as a normal
    // step completion.
    window.dispatchEvent(
      new CustomEvent('interactive-action-completed', {
        detail: { stepId, blockType: 'challenge', state: 'completed' },
      })
    );
  }, [storedCompleted, onStepComplete, stepId, sectionId, isStandalone]);

  const resetToIdle = useCallback(() => {
    setupStartedRef.current = false;
    setSetupProgress(null);
    setErrorDetail('');
    setState('idle');
  }, []);

  const runSetup = useCallback(async () => {
    if (setupStartedRef.current) {
      return;
    }
    setupStartedRef.current = true;
    cancelRequestedRef.current = false;
    setState('preparing');

    // Two paths: a single bash script (preferred, allows multi-line / heredocs
    // / control flow) or the legacy per-command array. setupScript wins when
    // both are set.
    const useScript = !!setupScript && setupScript.trim().length > 0;
    // +1 for the sentinel write that always follows successful setup.
    const totalSteps = useScript ? 2 : setupCommands.length + 1;
    setSetupProgress({ current: 0, total: totalSteps });
    try {
      if (useScript) {
        if (cancelRequestedRef.current) {
          resetToIdle();
          return;
        }
        setSetupProgress({ current: 1, total: totalSteps });
        // 120s timeout — apt-get / systemctl restart / service-startup waits
        // are realistic and need the headroom. Backend hard-caps at the same
        // value, so we just request it.
        const result = await runExec(setupScript!, 'raw', 120_000);
        if (cancelRequestedRef.current) {
          resetToIdle();
          return;
        }
        if (result.exitCode !== 0) {
          setErrorDetail(`Setup script failed (exit ${result.exitCode}): ${result.stderr.trim().slice(0, 500)}`);
          setState('setup-failed');
          return;
        }
      } else {
        for (let i = 0; i < setupCommands.length; i++) {
          if (cancelRequestedRef.current) {
            resetToIdle();
            return;
          }
          setSetupProgress({ current: i + 1, total: totalSteps });
          const cmd = setupCommands[i]!;
          const result = await runExec(cmd, 'raw', 30000);
          if (cancelRequestedRef.current) {
            resetToIdle();
            return;
          }
          if (result.exitCode !== 0) {
            setErrorDetail(
              `Setup command failed (exit ${result.exitCode}): ${cmd}\n${result.stderr.trim().slice(0, 500)}`
            );
            setState('setup-failed');
            return;
          }
        }
      }
      // Sentinel write — must be last. Once present, the gated coda-exit-zero
      // check is allowed to evaluate the author's success criterion.
      if (cancelRequestedRef.current) {
        resetToIdle();
        return;
      }
      setSetupProgress({ current: totalSteps, total: totalSteps });
      const sentinel = await runExec(SENTINEL_WRITE_COMMAND, 'raw', 5000);
      if (cancelRequestedRef.current) {
        resetToIdle();
        return;
      }
      if (sentinel.exitCode !== 0) {
        setErrorDetail(`Could not write readiness sentinel: ${sentinel.stderr.trim().slice(0, 500)}`);
        setState('setup-failed');
        return;
      }
      setSetupProgress(null);
      setState('ready');
    } catch (err) {
      // Grafana FetchError attaches the backend response on .data; fall back to
      // .message and the status code so the surfaced error is actually useful
      // (e.g. a 404 means /coda/exec doesn't exist in the running plugin
      // binary — likely the backend wasn't rebuilt).
      const fetchErr = err as { status?: number; statusText?: string; data?: { error?: string }; message?: string };
      const backendMessage = fetchErr?.data?.error;
      const status = fetchErr?.status;
      let message: string;
      if (status === 404) {
        message =
          'The /coda/exec backend route is missing. Rebuild the plugin binary (npm run build:backend:<platform>) and restart Grafana.';
      } else if (backendMessage) {
        message = status ? `${backendMessage} (HTTP ${status})` : backendMessage;
      } else {
        message = fetchErr?.message ?? String(err);
      }
      setErrorDetail(message);
      setState('setup-failed');
    }
  }, [setupCommands, setupScript, resetToIdle]);

  // Watch terminal status while we're trying to connect. When it goes live,
  // kick off setup. This effect reacts to an external system (the terminal
  // connection state owned by useTerminalLive), which is the legitimate use
  // of useEffect — setState here is the correct way to mirror that state
  // transition into the challenge's own lifecycle.
  /* eslint-disable react-hooks/set-state-in-effect -- Intentional: synchronize challenge state with external terminal connection lifecycle */
  useEffect(() => {
    if (state !== 'connecting') {
      return;
    }
    // Don't react to the status that was already current when the user
    // clicked Start/Try again — wait for it to change in response to our
    // openTerminal call. Otherwise a stale 'error' from a prior failed
    // attempt would cause Try again to immediately re-fail.
    if (terminalCtx?.status === statusAtStartRef.current) {
      return;
    }
    if (terminalCtx?.status === 'connected') {
      runSetup();
    } else if (terminalCtx?.status === 'error') {
      setErrorDetail('Could not start the challenge VM. Please try again.');
      setState('setup-failed');
    }
  }, [state, terminalCtx?.status, runSetup]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleStart = useCallback(() => {
    if (!terminalCtx) {
      setErrorDetail('Terminal integration is not available.');
      setState('setup-failed');
      return;
    }
    setErrorDetail('');
    setupStartedRef.current = false;
    statusAtStartRef.current = terminalCtx.status;
    setState('connecting');
    const vmOpts =
      vmTemplate || vmScenario || vmApp
        ? { template: vmTemplate || 'vm-aws', app: vmApp, scenario: vmScenario }
        : undefined;
    terminalCtx.openTerminal(vmOpts);
    // If the terminal was already connected when the user clicked Start, the
    // effect above won't fire because status didn't change. Trigger setup
    // directly in that case.
    if (terminalCtx.status === 'connected') {
      runSetup();
    }
  }, [terminalCtx, vmTemplate, vmScenario, vmApp, runSetup]);

  const handleCheckMyWork = useCallback(async () => {
    setState('checking');
    setErrorDetail('');
    try {
      const result = await checkPostconditions({
        requirements: successCriteria,
        stepId,
        maxRetries: 0,
      });
      if (result.pass) {
        setState('solved');
        markComplete();
      } else {
        const failure = result.error[0]?.error ?? 'Not solved yet.';
        setErrorDetail(failure);
        setState('failed-check');
      }
    } catch (err) {
      // Unexpected pipeline failure (network blip, requirements bug). Surface it
      // as a failed check so the user can retry instead of being stuck on a
      // spinner with no action available.
      const message = err instanceof Error ? err.message : String(err);
      setErrorDetail(`Could not run the check: ${message}`);
      setState('failed-check');
    }
  }, [successCriteria, stepId, markComplete]);

  const handleRevealNextHint = useCallback(() => {
    setHintsRevealed((n) => Math.min(n + 1, hintLevels.length));
  }, [hintLevels.length]);

  const handleCancel = useCallback(() => {
    cancelRequestedRef.current = true;
    if (state === 'connecting') {
      // No setup is in flight yet — bail immediately. (Setup will see the
      // flag if it starts after this and skip out before running anything.)
      resetToIdle();
    }
    // For 'preparing': the in-flight runExec resolves first; the loop checks
    // cancelRequestedRef on the next iteration and calls resetToIdle itself.
  }, [state, resetToIdle]);

  // The spinner banner only renders for *in-progress* states. Terminal
  // states like failed-check get their own non-animated affordance — see
  // the failed-check render below.
  const statusBanner = (() => {
    switch (state) {
      case 'connecting':
        return 'Provisioning challenge VM…';
      case 'preparing':
        return setupProgress
          ? `Preparing your environment (step ${setupProgress.current} of ${setupProgress.total})…`
          : 'Preparing your environment…';
      case 'checking':
        return 'Checking your work…';
      default:
        return null;
    }
  })();

  if (isCompleted) {
    return (
      <div className={styles.container} data-test-step-state="completed" data-testid={`challenge-block-${stepId}`}>
        <h4 className={styles.title}>{title}</h4>
        <div className={styles.brief}>{brief}</div>
        <div className={styles.solved}>
          <Icon name="check-circle" /> Challenge solved
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container} data-test-step-state={state} data-testid={`challenge-block-${stepId}`}>
      <h4 className={styles.title}>{title}</h4>
      <div className={styles.brief}>{brief}</div>

      {state === 'setup-failed' && (
        <Alert title="Could not start the challenge" severity="error">
          {errorDetail || 'Unknown setup failure.'}
        </Alert>
      )}

      {statusBanner && (
        <div className={styles.status}>
          <Icon name="fa fa-spinner" />
          <span>{statusBanner}</span>
        </div>
      )}

      {state === 'failed-check' && (
        <div className={styles.failedCheck} role="status" aria-live="polite">
          <Icon name="exclamation-triangle" />
          <div>{failureMessage || errorDetail || "The check didn't pass — adjust and try again."}</div>
        </div>
      )}

      <div className={styles.actions}>
        {state === 'idle' && (
          <Button variant="primary" icon="play" onClick={handleStart}>
            Start challenge
          </Button>
        )}
        {state === 'ready' && (
          <Button variant="primary" icon="check" onClick={handleCheckMyWork}>
            Check my work
          </Button>
        )}
        {state === 'failed-check' && (
          <Button variant="primary" icon="check" onClick={handleCheckMyWork}>
            Check again
          </Button>
        )}
        {state === 'setup-failed' && (
          <Button variant="secondary" icon="sync" onClick={handleStart}>
            Try again
          </Button>
        )}
        {(state === 'connecting' || state === 'preparing') && (
          <Button variant="secondary" icon="times" onClick={handleCancel}>
            Cancel
          </Button>
        )}
      </div>

      {hintLevels.length > 0 && (state === 'ready' || state === 'failed-check') && (
        <div className={styles.hints}>
          {hintLevels.slice(0, hintsRevealed).map((hint, idx) => (
            <div key={idx} className={styles.hint}>
              <span className={styles.hintIndex}>Hint {idx + 1}:</span>
              {hint.text}
            </div>
          ))}
          {hintsRevealed < hintLevels.length && (
            <Button size="sm" variant="secondary" icon="info-circle" onClick={handleRevealNextHint}>
              {hintsRevealed === 0 ? 'Show a hint' : 'Show next hint'}
            </Button>
          )}
        </div>
      )}
    </div>
  );
};

ChallengeBlock.displayName = 'ChallengeBlock';

/** Reset the anonymous challenge counter (test/Storybook helper). */
export function resetChallengeCounter(): void {
  challengeCounter = 0;
}
