/** Terminal UI and VM lifetime state for the SDK-managed recovering connection. */

import { useCallback, useEffect, useRef, useState, RefObject } from 'react';
import type { Terminal } from '@xterm/xterm';
import { CodaTerminalLink } from '@grafana/coda-client';
import { logger } from '../../lib/logging';
import {
  codaErrorCodeMessage,
  createSession,
  listVMs,
  toCodaError,
  type TerminalVMOptions,
  type LifetimeVM,
} from './coda-api';

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

const RECOVERY_EXHAUSTED_MESSAGE = 'Automatic reconnection stopped. Select Retry to try again.';

function codaSessionErrorMessage(err: unknown): string {
  const codaErr = toCodaError(err);
  if (codaErr.code === 'recovery_exhausted') {
    return RECOVERY_EXHAUSTED_MESSAGE;
  }
  return codaErrorCodeMessage(codaErr.code, codaErr.message);
}

const PROTOCOL_MISMATCH_MESSAGE =
  'Unreadable message from the sandbox backend — the plugin and backend may be out of sync.';

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
  unreachableVmId: string | null;
  /** Active Coda session id, or null when disconnected. Needed to run exec calls. */
  sessionId: string | null;
  /** Server-reported expiry of the active VM, or null when it is unknown. */
  vmExpiresAt: string | null;
  lifetimeVM: LifetimeVM | undefined;
  onExpiryChange?: (expiry: string) => void;
  vmId: string | null;
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
  const [unreachableVmId, setUnreachableVmId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [vmId, setVmId] = useState<string | null>(null);
  const [lifetimeVM, setLifetimeVM] = useState<LifetimeVM>();
  const [vmExpiresAt, setVmExpiresAt] = useState<string | null>(null);

  const connectionLogRef = useRef<ConnectionLog>(createConnectionLog());

  const sessionRef = useRef<CodaTerminalLink | null>(null);
  // Tracks the current session's VM for logging and identity changes.
  const currentVmIdRef = useRef<string | null>(null);
  const inputDisposerRef = useRef<{ dispose: () => void } | null>(null);
  // SDK 1.11 checks its outage budget only between attempts, so a slow reattach can outlive it.
  const recoveryDeadlineRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearRecoveryDeadline = useCallback(() => {
    if (recoveryDeadlineRef.current) {
      clearTimeout(recoveryDeadlineRef.current);
      recoveryDeadlineRef.current = null;
    }
  }, []);

  // Provision progress bar state (animated bar during pending/provisioning)
  const provisionProgressRef = useRef<{
    intervalId: ReturnType<typeof setInterval>;
    startTime: number;
    stateLabel: string;
  } | null>(null);
  // Dedup guard for non-progress-bar status lines
  const lastStatusLineRef = useRef('');
  const rememberVmId = useCallback((nextVmId?: string) => {
    const normalized = nextVmId || null;
    if (normalized === currentVmIdRef.current) {
      return;
    }
    currentVmIdRef.current = normalized;
    setVmId(normalized);
    setVmExpiresAt(null);
    setLifetimeVM(undefined);
  }, []);

  // Exec must never reuse a closed session id.
  const cleanup = useCallback(() => {
    clearRecoveryDeadline();
    setSessionId(null);
    currentVmIdRef.current = null;
    setVmId(null);
    setVmExpiresAt(null);
    setLifetimeVM(undefined);
    const session = sessionRef.current;
    sessionRef.current = null;
    if (session) {
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
  }, [clearRecoveryDeadline]);

  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  useEffect(() => {
    if (status !== 'connected' || !vmId) {
      return undefined;
    }

    let cancelled = false;
    const loadExpiry = async () => {
      try {
        const vms = await listVMs();
        if (cancelled) {
          return;
        }
        const vm = vms.find((entry) => entry.id === vmId);
        setVmExpiresAt(vm?.expiresAt ?? null);
        setLifetimeVM(vm);
      } catch {
        // Expiry is advisory; leave the indicator hidden when the lookup fails.
      }
    };

    void loadExpiry();
    const poll = window.setInterval(() => void loadExpiry(), 15000);
    const focus = () => void loadExpiry();
    window.addEventListener('focus', focus);

    return () => {
      window.clearInterval(poll);
      window.removeEventListener('focus', focus);
      cancelled = true;
    };
  }, [status, vmId]);

  const connectLiveStream = useCallback(
    (session: CodaTerminalLink, terminal: Terminal) => {
      session.start({
        onState: (next) => {
          if (sessionRef.current !== session) {
            return;
          }
          if (next === 'reconnecting' || next === 'connecting' || next === 'provisioning') {
            setSessionId(null);
            setStatus('connecting');
          }
        },
        onReconnect: ({ outageMs, budgetMs }) => {
          setError(null);
          terminal.writeln('\r\nReconnecting to sandbox...');
          if (recoveryDeadlineRef.current) {
            return;
          }
          recoveryDeadlineRef.current = setTimeout(
            () => {
              recoveryDeadlineRef.current = null;
              if (sessionRef.current !== session) {
                return;
              }
              cleanup();
              connectionLogRef.current.error('Sandbox recovery deadline passed during a reattach', undefined, {
                backendErrorCode: 'recovery_exhausted',
                category: 'backend_error',
              });
              setError(RECOVERY_EXHAUSTED_MESSAGE);
              setStatus('error');
            },
            Math.max(0, budgetMs - outageMs)
          );
        },
        onOutput: (data) => {
          terminal.write(data);
        },

        onStatus: ({
          state,
          message,
          vmId,
          expiresAt,
        }: {
          state?: string;
          message?: string;
          vmId?: string;
          expiresAt?: string;
        }) => {
          if (vmId) {
            rememberVmId(vmId);
          }
          if (expiresAt) {
            setVmExpiresAt(expiresAt);
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
          } else if (state !== 'ssh_connecting') {
            const line = `\x1b[90m   │  ${message || `Status: ${state}`}\x1b[0m`;
            if (line !== lastStatusLineRef.current) {
              lastStatusLineRef.current = line;
              terminal.writeln(line);
            }
          }
        },

        onConnected: ({ vmId, sessionId: nextSessionId, expiresAt, reattached }) => {
          clearRecoveryDeadline();
          setSessionId(nextSessionId);
          setError(null);
          if (vmId) {
            rememberVmId(vmId);
          }

          if (expiresAt) {
            setVmExpiresAt(expiresAt);
          }
          if (reattached) {
            terminal.writeln('\r\nReconnected to sandbox. A new shell is ready.');
          }
          setStatus('connected');
          if (inputDisposerRef.current) {
            inputDisposerRef.current.dispose();
          }
          inputDisposerRef.current = terminal.onData((inputData) => {
            sessionRef.current?.write(inputData);
          });

          session.resize(terminal.rows, terminal.cols);
        },

        onEnded: ({ error: err }) => {
          if (sessionRef.current !== session) {
            return;
          }
          const failedVmId = currentVmIdRef.current;
          cleanup();
          if (err) {
            const codaErr = toCodaError(err);
            connectionLogRef.current.error('Sandbox connection ended', err, {
              backendErrorCode: codaErr.code,
              category: 'backend_error',
            });
            setUnreachableVmId(codaErr.code === 'vm_unreachable' ? failedVmId : null);
            setError(codaSessionErrorMessage(err));
            setStatus('error');
          } else {
            setStatus('disconnected');
            terminal.writeln('\r\nSession ended - VM disconnected');
          }
        },

        onProtocolError: ({ detail, sessionId: sid, vmId }) => {
          // CodaSession deliberately reports an invalid frame without ending the
          // stream. Keep that non-fatal contract so a later compatible frame can
          // still recover; the visible diagnostic is the consumer-side action.
          connectionLogRef.current.error('Coda protocol mismatch', undefined, {
            detail,
            sessionId: sid,
            vmId,
            category: 'protocol_error',
          });

          terminal.writeln('\r\n');
          terminal.writeln(`\x1b[31m✖ Error: ${PROTOCOL_MISMATCH_MESSAGE}\x1b[0m`);
          setError(PROTOCOL_MISMATCH_MESSAGE);
        },
      });
    },
    [cleanup, clearRecoveryDeadline, rememberVmId]
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
      setUnreachableVmId(null);
      cleanup();

      terminal.clear();
      terminal.writeln('Connecting to sandbox...');

      const session = new CodaTerminalLink({
        client: {
          createSession: async (options) => {
            const transport = await createSession(options);
            const subscribe = transport.subscribe.bind(transport);
            // Preserve replacement until https://github.com/grafana/grafana-coda-app/blob/main/packages/coda-client/src/recovery.ts ends vm_unreachable.
            transport.subscribe = (handlers) =>
              subscribe({
                ...handlers,
                onError: (err) => {
                  if (toCodaError(err).code === 'vm_unreachable' && sessionRef.current === session) {
                    const failedVmId = currentVmIdRef.current;
                    cleanup();
                    setUnreachableVmId(failedVmId);
                    setError(codaSessionErrorMessage(err));
                    setStatus('error');
                    return;
                  }
                  handlers.onError?.(err);
                },
              });
            return transport;
          },
        },
        intent: vmOpts,
      });
      sessionRef.current = session;
      connectLiveStream(session, terminal);
    },
    [terminalRef, cleanup, connectLiveStream]
  );

  const disconnect = useCallback(() => {
    cleanup();
    setStatus('disconnected');
    setError(null);
    setUnreachableVmId(null);

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
    unreachableVmId,
    sessionId,
    vmExpiresAt,
    lifetimeVM,
    onExpiryChange: setVmExpiresAt,
    vmId,
  };
}
