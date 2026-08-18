/**
 * Grafana Live terminal connection hook
 *
 * Bidirectional terminal I/O over a single Grafana Live WebSocket, driven by
 * `@grafana/coda-client`'s `CodaSession`: it owns the channel address, frame
 * validation, the mandatory `{ useSocket: true }` publish and its own idle
 * timer. This hook keeps only what's Pathfinder-specific — the progress bar,
 * banner text and xterm wiring — hung off `CodaSession`'s handlers.
 *
 * Two things the hand-rolled version had that the class doesn't expose:
 * - the transient "Waiting for SSH handshake..." line, printed on the raw
 *   Live channel's own connect event before any backend frame arrives;
 * - immediate detection of the underlying WebSocket dropping. `CodaSession`
 *   only reports a dead connection via its own idle timer (silence beyond
 *   ~12 heartbeats, floored at 35s), not the instant a socket-level
 *   disconnect event fires.
 * Both are covered, with a delay, by the connecting banner and the idle
 * timer's `terminal_disconnected` respectively.
 */

import { useCallback, useEffect, useRef, useState, RefObject } from 'react';
import type { Terminal } from '@xterm/xterm';
import type { CodaSession } from '@grafana/coda-client';
import { logger } from '../../lib/logging';
import { codaErrorCodeMessage, createSession, toCodaError, type TerminalVMOptions } from './coda-api';

interface ConnectionLog {
  error: (message: string, error?: unknown, data?: Record<string, unknown>) => void;
  warn: (message: string, data?: Record<string, unknown>) => void;
}

function createConnectionLog(): ConnectionLog {
  return {
    error: (message: string, error?: unknown, data?: Record<string, unknown>) => {
      const errorDetails =
        error instanceof Error
          ? { errorName: error.name, errorMessage: error.message, errorStack: error.stack }
          : { rawError: error };
      logger.error(`[Terminal] ${message}`, { ...errorDetails, ...data });
    },
    warn: (message: string, data?: Record<string, unknown>) => {
      logger.warn(`[Terminal] ${message}`, data);
    },
  };
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export type { TerminalVMOptions };

function codaSessionErrorMessage(err: unknown): string {
  const codaErr = toCodaError(err);
  return codaErrorCodeMessage(codaErr.code, codaErr.message);
}

interface UseTerminalLiveOptions {
  /** Terminal instance ref - accessed in callbacks, not during render */
  terminalRef: RefObject<Terminal | null>;
}

interface UseTerminalLiveReturn {
  /** Current connection status */
  status: ConnectionStatus;
  /** Connect to terminal (provisions VM if needed). Pass vmOpts for non-default templates. */
  connect: (vmOpts?: TerminalVMOptions) => void;
  /** Disconnect from terminal */
  disconnect: () => void;
  /** Send resize event to backend */
  resize: (rows: number, cols: number) => void;
  /** Send a command string to the terminal (appends newline to execute) */
  sendCommand: (command: string) => Promise<void>;
  /** Error message if status is 'error' */
  error: string | null;
  /** Active Coda session id, or null when disconnected. Needed to run exec calls. */
  sessionId: string | null;
}

// ─── Provision progress bar ──────────────────────────────────────────────────
// Rendered inline in xterm via \r to overwrite the current line every 500ms.
// Uses an asymptotic ease-out curve so the bar never freezes: it reaches ~38%
// at 10 s, ~82% at 45 s, and caps at 95% until "active" arrives.

const PROVISION_ESTIMATED_MS = 55_000;
const PROGRESS_BAR_WIDTH = 20;
const PROGRESS_UPDATE_INTERVAL_MS = 500;

function renderProvisionProgress(label: string, elapsedMs: number, complete = false): string {
  const ratio = complete ? 1 : 0.95 * (1 - Math.exp((-3 * elapsedMs) / PROVISION_ESTIMATED_MS));
  const filled = Math.round(ratio * PROGRESS_BAR_WIDTH);
  const empty = PROGRESS_BAR_WIDTH - filled;
  const pct = Math.round(ratio * 100);
  const secs = Math.round(elapsedMs / 1000);
  const icon = complete ? '✓' : '⏳';
  const color = complete ? '32' : '90';
  return `\x1b[${color}m   │  ${icon} ${label.padEnd(16)} [${'█'.repeat(filled)}${'░'.repeat(empty)}] ${String(pct).padStart(3)}% (${secs}s)\x1b[0m`;
}

export function useTerminalLive({ terminalRef }: UseTerminalLiveOptions): UseTerminalLiveReturn {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const connectionLogRef = useRef<ConnectionLog>(createConnectionLog());

  // The one live session object; owns the channel, frame validation and the
  // idle timer. Replaces the subscription/address/liveSrv refs the hand-rolled
  // version needed.
  const sessionRef = useRef<CodaSession | null>(null);
  // currentVmIdRef tracks the VM ID for the current session (used in logging)
  const currentVmIdRef = useRef<string | null>(null);
  const inputDisposerRef = useRef<{ dispose: () => void } | null>(null);

  // Provision progress bar state (animated bar during pending/provisioning)
  const provisionProgressRef = useRef<{
    intervalId: ReturnType<typeof setInterval>;
    startTime: number;
    stateLabel: string;
  } | null>(null);
  // Dedup guard for non-progress-bar status lines
  const lastStatusLineRef = useRef('');
  // Set right before onClosed would otherwise print its own "session ended"
  // banner — user-initiated disconnect prints its own message instead.
  const suppressClosedBannerRef = useRef(false);
  // onClosed always fires after onError (CodaSession.finish() calls both), so
  // this stops it from printing a second, contradictory banner.
  const hadErrorRef = useRef(false);
  // Bumped by every teardown. connect() reads it before awaiting createSession
  // and compares after, so a Cancel or unmount during that window abandons the
  // session it lost the race to instead of installing it anyway.
  const connectGenerationRef = useRef(0);

  // Tearing the session down invalidates its id: exec is session-scoped, so a
  // retained id would be spent on a session the backend has forgotten. Every
  // terminating path must either call this or clear the id itself.
  const cleanup = useCallback(() => {
    connectGenerationRef.current += 1;
    setSessionId(null);
    const session = sessionRef.current;
    sessionRef.current = null;
    if (session) {
      // finish()'s side effects (unsubscribe, onError/onClosed) run
      // synchronously; close() itself is fire-and-forget and never rejects. It
      // releases the terminal only — the VM keeps its quota slot until expiry.
      void session.close();
    }
    if (inputDisposerRef.current) {
      inputDisposerRef.current.dispose();
      inputDisposerRef.current = null;
    }
    if (provisionProgressRef.current) {
      clearInterval(provisionProgressRef.current.intervalId);
      provisionProgressRef.current = null;
    }
    lastStatusLineRef.current = '';
  }, []);

  // REACT: cleanup on unmount (R1)
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  /**
   * Subscribe a fresh session to its Live channel, wiring Pathfinder's
   * terminal UI onto CodaSession's handlers.
   */
  const connectLiveStream = useCallback(
    (session: CodaSession, terminal: Terminal) => {
      currentVmIdRef.current = session.vmID ?? null;

      session.subscribe({
        onOutput: (data) => {
          terminal.write(data);
        },

        onStatus: ({ state, message, vmId }) => {
          if (vmId && vmId !== currentVmIdRef.current) {
            currentVmIdRef.current = vmId;
          }

          if (state === 'pending' || state === 'provisioning') {
            const label = state === 'pending' ? 'Waiting in queue' : 'Booting VM';
            if (!provisionProgressRef.current) {
              const startTime = Date.now();
              terminal.write(renderProvisionProgress(label, 0));
              const intervalId = setInterval(() => {
                const cur = provisionProgressRef.current;
                if (!cur) {
                  return;
                }
                const elapsed = Date.now() - cur.startTime;
                terminal.write('\r' + renderProvisionProgress(cur.stateLabel, elapsed));
              }, PROGRESS_UPDATE_INTERVAL_MS);
              provisionProgressRef.current = { intervalId, startTime, stateLabel: label };
            } else {
              provisionProgressRef.current.stateLabel = label;
            }
            return;
          }

          // Finish progress bar when leaving pending/provisioning
          const hadProgressBar = provisionProgressRef.current !== null;
          if (provisionProgressRef.current) {
            const elapsed = Date.now() - provisionProgressRef.current.startTime;
            clearInterval(provisionProgressRef.current.intervalId);
            if (state === 'active') {
              terminal.write('\r' + renderProvisionProgress('VM is ready', elapsed, true));
            }
            terminal.writeln('');
            provisionProgressRef.current = null;
          }

          if (state === 'active') {
            if (!hadProgressBar) {
              const line = `\x1b[90m   │  ✓ ${message || 'VM is ready'}\x1b[0m`;
              if (line !== lastStatusLineRef.current) {
                lastStatusLineRef.current = line;
                terminal.writeln(line);
              }
            }
          } else if (state === 'retrying') {
            terminal.writeln(`\x1b[33m   │  ⚠ ${message || 'Retrying...'}\x1b[0m`);
          } else {
            const line = `\x1b[90m   │  ${message || `Status: ${state}`}\x1b[0m`;
            if (line !== lastStatusLineRef.current) {
              lastStatusLineRef.current = line;
              terminal.writeln(line);
            }
          }
        },

        onConnected: (vmId) => {
          if (vmId) {
            currentVmIdRef.current = vmId;
          }

          setStatus('connected');
          terminal.writeln('');
          terminal.writeln('\x1b[32m✓ SSH connection established\x1b[0m');
          terminal.writeln('');
          terminal.writeln('\x1b[36m┌──────────────────────────────────────────────────────────────┐\x1b[0m');
          terminal.writeln(
            '\x1b[36m│\x1b[0m  \x1b[1;33mGrafana Pathfinder Sandbox\x1b[0m                                 \x1b[36m│\x1b[0m'
          );
          terminal.writeln(
            '\x1b[36m│\x1b[0m                                                              \x1b[36m│\x1b[0m'
          );
          terminal.writeln(
            '\x1b[36m│\x1b[0m  \x1b[90mThis is a temporary sandbox VM for learning Grafana.\x1b[0m       \x1b[36m│\x1b[0m'
          );
          terminal.writeln(
            '\x1b[36m│\x1b[0m  \x1b[90mVM will auto-terminate after inactivity.\x1b[0m                   \x1b[36m│\x1b[0m'
          );
          terminal.writeln('\x1b[36m└──────────────────────────────────────────────────────────────┘\x1b[0m');
          terminal.writeln('');

          if (inputDisposerRef.current) {
            inputDisposerRef.current.dispose();
          }
          inputDisposerRef.current = terminal.onData((inputData) => {
            sessionRef.current?.write(inputData);
          });

          session.resize(terminal.rows, terminal.cols);

          // Send a blank newline after a short delay to force the shell
          // to print a fresh prompt. Without this, broadcast messages
          // (e.g. shutdown warnings) or SSH reconnections can leave the
          // terminal on a blank line with no visible prompt.
          setTimeout(() => sessionRef.current?.write('\n'), 300);
        },

        onError: (err) => {
          hadErrorRef.current = true;
          const codaErr = toCodaError(err);
          connectionLogRef.current.error('Backend error received', err, {
            sessionId: session.sessionId,
            backendErrorCode: codaErr.code,
            category: 'backend_error',
          });

          cleanup();

          const message = codaSessionErrorMessage(err);
          terminal.writeln('\r\n');
          terminal.writeln(`\x1b[31m✖ Error: ${message}\x1b[0m`);

          setError(message);
          setStatus('error');
        },

        onClosed: () => {
          if (hadErrorRef.current) {
            hadErrorRef.current = false;
            return;
          }
          if (suppressClosedBannerRef.current) {
            suppressClosedBannerRef.current = false;
            return;
          }

          cleanup();
          setStatus('disconnected');
          terminal.writeln('\r\n');
          terminal.writeln('\x1b[33m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m');
          terminal.writeln('\x1b[33m  Session ended - VM disconnected\x1b[0m');
          terminal.writeln('\x1b[33m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m');
        },

        onProtocolError: ({ detail, sessionId: sid, vmId }) => {
          connectionLogRef.current.warn('Coda protocol mismatch', {
            detail,
            sessionId: sid,
            vmId,
            category: 'protocol_error',
          });
        },
      });
    },
    [cleanup]
  );

  const connect = useCallback(
    async (vmOpts?: TerminalVMOptions) => {
      const terminal = terminalRef.current;
      if (!terminal) {
        connectionLogRef.current.error('Terminal instance not available', null, {
          category: 'terminal_not_ready',
        });
        setError('Terminal instance not available');
        return;
      }

      lastStatusLineRef.current = '';

      setStatus('connecting');
      setError(null);
      cleanup();
      const generation = connectGenerationRef.current;

      currentVmIdRef.current = null;

      terminal.clear();
      terminal.writeln('\x1b[1;36m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m');
      terminal.writeln('\x1b[1;36m  Grafana Pathfinder - Sandbox Terminal\x1b[0m');
      terminal.writeln('\x1b[1;36m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m');
      terminal.writeln('');

      if (vmOpts?.scenario) {
        terminal.writeln(`\x1b[33m⏳ Connecting to ${vmOpts.scenario} scenario sandbox...\x1b[0m`);
      } else if (vmOpts?.app) {
        terminal.writeln(`\x1b[33m⏳ Connecting to ${vmOpts.app} sandbox...\x1b[0m`);
      } else {
        terminal.writeln('\x1b[33m⏳ Connecting to sandbox...\x1b[0m');
      }
      terminal.writeln('\x1b[90m   ├─ Backend will assign your VM...\x1b[0m');
      terminal.writeln('\x1b[90m   └─ Establishing connection...\x1b[0m');

      let session: CodaSession;
      try {
        session = await createSession(vmOpts);
      } catch (err) {
        if (generation !== connectGenerationRef.current) {
          return;
        }
        const message = codaSessionErrorMessage(err);
        connectionLogRef.current.error('Could not create Coda session', err, { category: 'session_create' });
        setError(message);
        setStatus('error');
        terminal.writeln(`\r\n\x1b[31m✖ ${message}\x1b[0m`);
        return;
      }

      if (generation !== connectGenerationRef.current) {
        void session.close();
        return;
      }

      sessionRef.current = session;
      setSessionId(session.sessionId);
      connectLiveStream(session, terminal);
    },
    [terminalRef, cleanup, connectLiveStream]
  );

  const disconnect = useCallback(() => {
    // Only latch when a session is actually open to emit the banner we are
    // suppressing; onClosed never fires otherwise and the flag would survive
    // into the next session and swallow its first genuine close.
    suppressClosedBannerRef.current = sessionRef.current !== null;
    cleanup();
    currentVmIdRef.current = null;
    setStatus('disconnected');
    setError(null);

    const terminal = terminalRef.current;
    if (terminal) {
      terminal.writeln('\r\n');
      terminal.writeln('\x1b[33m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m');
      terminal.writeln('\x1b[33m  Session ended - Disconnected by user\x1b[0m');
      terminal.writeln('\x1b[33m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m');
    }
  }, [cleanup, terminalRef]);

  const resize = useCallback((rows: number, cols: number) => {
    sessionRef.current?.resize(rows, cols);
  }, []);

  const sendCommand = useCallback(async (command: string) => {
    if (!sessionRef.current) {
      connectionLogRef.current.warn('Cannot send command: not connected');
      return;
    }
    sessionRef.current.write(command + '\n');
  }, []);

  return {
    status,
    connect,
    disconnect,
    resize,
    sendCommand,
    error,
    sessionId,
  };
}
