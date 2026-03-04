/**
 * Grafana Live terminal connection hook
 *
 * Bidirectional terminal I/O over a single Grafana Live WebSocket:
 * - Output (SSH → frontend): RunStream sends frames via sender.SendFrame
 * - Input (frontend → SSH): Frontend publishes via liveSrv.publish → PublishStream
 */

import { useCallback, useEffect, useRef, useState, RefObject } from 'react';
import { getGrafanaLiveSrv, type GrafanaLiveSrv } from '@grafana/runtime';
import {
  LiveChannelScope,
  LiveChannelAddress,
  LiveChannelEvent,
  isLiveChannelMessageEvent,
  isLiveChannelStatusEvent,
  LiveChannelConnectionState,
} from '@grafana/data';
import { Subscription } from 'rxjs';
import type { Terminal } from '@xterm/xterm';
import { isDevModeEnabledGlobal } from '../../utils/dev-mode';

interface ConnectionLog {
  startConnection: () => void;
  elapsed: () => number;
  info: (message: string, data?: Record<string, unknown>) => void;
  warn: (message: string, data?: Record<string, unknown>) => void;
  error: (message: string, error?: unknown, data?: Record<string, unknown>) => void;
  liveStream: (event: string, data?: Record<string, unknown>) => void;
}

/**
 * Creates a connection logger with its own timing state.
 * Logs are gated behind dev mode (except errors, which always log).
 */
function createConnectionLog(): ConnectionLog {
  let connectionStartTime = 0;

  const elapsed = () => Math.round(performance.now() - connectionStartTime);

  const devLog = (fn: (...args: unknown[]) => void, ...args: unknown[]) => {
    if (isDevModeEnabledGlobal()) {
      fn(...args);
    }
  };

  return {
    startConnection: () => {
      connectionStartTime = performance.now();
      devLog(console.log, '[Terminal] Connection sequence started', {
        timestamp: new Date().toISOString(),
      });
    },

    elapsed,

    info: (message: string, data?: Record<string, unknown>) => {
      devLog(console.log, `[Terminal] ${message}`, {
        elapsedMs: elapsed(),
        ...data,
      });
    },

    warn: (message: string, data?: Record<string, unknown>) => {
      devLog(console.warn, `[Terminal] ${message}`, {
        elapsedMs: elapsed(),
        ...data,
      });
    },

    error: (message: string, error?: unknown, data?: Record<string, unknown>) => {
      const errorDetails =
        error instanceof Error
          ? { errorName: error.name, errorMessage: error.message, errorStack: error.stack }
          : { rawError: error };
      console.error(`[Terminal] ${message}`, {
        elapsedMs: elapsed(),
        ...errorDetails,
        ...data,
      });
    },

    liveStream: (event: string, data?: Record<string, unknown>) => {
      devLog(console.log, `[Terminal] LiveStream: ${event}`, {
        elapsedMs: elapsed(),
        ...data,
      });
    },
  };
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/** Plugin ID for constructing API paths */
const PLUGIN_ID = 'grafana-pathfinder-app';

interface UseTerminalLiveOptions {
  /** Terminal instance ref - accessed in callbacks, not during render */
  terminalRef: RefObject<Terminal | null>;
}

interface UseTerminalLiveReturn {
  /** Current connection status */
  status: ConnectionStatus;
  /** Connect to terminal (provisions VM if needed) */
  connect: () => void;
  /** Disconnect from terminal */
  disconnect: () => void;
  /** Send resize event to backend */
  resize: (rows: number, cols: number) => void;
  /** Send a command string to the terminal (appends newline to execute) */
  sendCommand: (command: string) => Promise<void>;
  /** Error message if status is 'error' */
  error: string | null;
}

/** Terminal stream output message (sent from backend via SendJSON) */
interface TerminalStreamOutput {
  type: 'output' | 'error' | 'connected' | 'disconnected' | 'status' | 'heartbeat';
  data?: string;
  error?: string;
  state?: string; // VM state for 'status' type: 'pending', 'provisioning', 'active'
  message?: string; // Human-readable status message
  vmId?: string; // Actual VM ID being used (sent by backend with 'connected' and 'status')
}

/**
 * Terminal connection hook using Grafana Live streaming
 *
 * This connects to the plugin backend which:
 * 1. Provisions a VM via Coda (or reuses existing one for this user)
 * 2. Establishes SSH connection to the VM
 * 3. Streams terminal I/O via Grafana Live
 *
 * The backend handles all VM lifecycle decisions:
 * - Tracks active VMs per user and reuses them
 * - Auto-provisions if user has no active VM
 * - Retries SSH with fresh VM on auth failures
 * - Pushes status updates via the stream
 */
export function useTerminalLive({ terminalRef }: UseTerminalLiveOptions): UseTerminalLiveReturn {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [error, setError] = useState<string | null>(null);

  // Per-instance connection logger (each connection gets its own timing state).
  // Always read via connectionLogRef.current to avoid stale closure captures.
  const connectionLogRef = useRef<ConnectionLog>(createConnectionLog());

  // REACT: refs for subscriptions and cleanup (R1)
  const subscriptionRef = useRef<Subscription | null>(null);
  // currentVmIdRef tracks the VM ID for the current session (used in logging)
  const currentVmIdRef = useRef<string | null>(null);
  const inputDisposerRef = useRef<{ dispose: () => void } | null>(null);
  const handshakeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Grafana Live publish refs: populated in connectLiveStream, read by sendInput/sendResize
  const liveSrvRef = useRef<GrafanaLiveSrv | undefined>(undefined);
  const addressRef = useRef<LiveChannelAddress | null>(null);

  // Cleanup function
  const cleanup = useCallback(() => {
    if (subscriptionRef.current) {
      subscriptionRef.current.unsubscribe();
      subscriptionRef.current = null;
    }
    if (inputDisposerRef.current) {
      inputDisposerRef.current.dispose();
      inputDisposerRef.current = null;
    }
    if (handshakeTimeoutRef.current) {
      clearTimeout(handshakeTimeoutRef.current);
      handshakeTimeoutRef.current = null;
    }
    liveSrvRef.current = undefined;
    addressRef.current = null;
  }, []);

  // REACT: cleanup on unmount (R1)
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  /**
   * Publish over the WebSocket rather than HTTP POST.
   *
   * GrafanaLiveService.publish() accepts an undeclared third `options` arg.
   * Passing `{ useSocket: true }` routes the message through the existing
   * Centrifuge WebSocket instead of `POST /api/live/publish`. This is
   * critical in multi-node deployments (e.g. Grafana Cloud) where HTTP
   * requests are load-balanced and may hit a node that isn't running the
   * stream, causing a 404.
   */
  const publishOverSocket = useCallback(
    (address: LiveChannelAddress, data: unknown) =>
      (liveSrvRef.current as any)?.publish(address, data, { useSocket: true }),
    []
  );

  /**
   * Send input to the terminal via Grafana Live publish.
   * Publishes a plain object to the same channel used by RunStream/SubscribeStream.
   */
  const sendInput = useCallback(
    async (inputData: string) => {
      const address = addressRef.current;
      if (!liveSrvRef.current || !address) {
        return;
      }

      try {
        await publishOverSocket(address, { type: 'input', data: inputData });
      } catch (err: unknown) {
        connectionLogRef.current.error('Failed to publish input', err, {
          category: 'input_failure',
        });
      }
    },
    [publishOverSocket]
  );

  /**
   * Send resize event to the terminal via Grafana Live publish.
   */
  const sendResize = useCallback(
    async (rows: number, cols: number) => {
      const address = addressRef.current;
      if (!liveSrvRef.current || !address) {
        return;
      }

      try {
        await publishOverSocket(address, { type: 'resize', rows, cols });
      } catch (err: unknown) {
        connectionLogRef.current.error('Failed to publish resize', err, {
          rows,
          cols,
          category: 'resize_failure',
        });
      }
    },
    [publishOverSocket]
  );

  /**
   * Parse terminal output from a Grafana Live message.
   * With SendJSON, messages arrive as raw JSON objects (not wrapped in DataFrame).
   */
  const parseTerminalOutput = useCallback((message: unknown): TerminalStreamOutput | null => {
    try {
      // Direct JSON object (from SendJSON)
      if (message && typeof message === 'object') {
        const msg = message as Record<string, unknown>;
        if (typeof msg.type === 'string') {
          return message as TerminalStreamOutput;
        }

        // DataFrame format (from SendFrame): extract JSON string from data.values[0][0]
        const df = msg as { data?: { values?: unknown[][] }; schema?: unknown };
        if (df.data?.values?.[0]?.[0]) {
          const raw = df.data.values[0][0];
          if (typeof raw === 'string') {
            return JSON.parse(raw) as TerminalStreamOutput;
          }
        }
      }

      if (typeof message === 'string') {
        return JSON.parse(message) as TerminalStreamOutput;
      }
    } catch {
      // Parse failures are non-fatal; the stream will deliver subsequent messages
    }
    return null;
  }, []);

  /**
   * Connect to Grafana Live stream for terminal I/O
   */
  const connectLiveStream = useCallback(
    (id: string, terminal: Terminal) => {
      const liveSrv = getGrafanaLiveSrv();
      if (!liveSrv) {
        connectionLogRef.current.error('Grafana Live service not available', null, {
          vmId: id,
          category: 'live_service_unavailable',
        });
        setError('Grafana Live service not available');
        setStatus('error');
        return;
      }

      // Append a unique nonce so Grafana Live always starts a fresh RunStream,
      // even when reconnecting to the same VM. Without this, resubscribing to
      // the same channel path while the old RunStream is tearing down can cause
      // the backend to never invoke a new RunStream, leaving us stuck.
      const nonce = Date.now();
      const address: LiveChannelAddress = {
        scope: LiveChannelScope.Plugin,
        stream: PLUGIN_ID,
        path: `terminal/${id}/${nonce}`,
      };

      const channelPath = `${address.scope}/${address.stream}/${address.path}`;
      connectionLogRef.current.info('Subscribing to LiveStream', {
        vmId: id,
        channel: channelPath,
        nonce,
      });

      currentVmIdRef.current = id;

      // Store refs so sendInput/sendResize can publish to this channel
      liveSrvRef.current = liveSrv;
      addressRef.current = address;

      // Safety-net timeout: if the backend never sends "connected" (e.g. SSH
      // dial blocks or RunStream fails silently), surface an error instead of
      // hanging forever. 35 s > the 30 s SSH dial timeout on the backend.
      const SSH_HANDSHAKE_TIMEOUT_MS = 35_000;
      handshakeTimeoutRef.current = setTimeout(() => {
        handshakeTimeoutRef.current = null;
        connectionLogRef.current.error('SSH handshake timeout', null, {
          vmId: id,
          timeoutMs: SSH_HANDSHAKE_TIMEOUT_MS,
          category: 'ssh_handshake_timeout',
        });
        cleanup();
        setError('SSH handshake timed out');
        setStatus('error');
        terminal.writeln('\r\n\x1b[31m✖ SSH handshake timed out — the VM may be unreachable.\x1b[0m');
        terminal.writeln('\x1b[90m  Press "Connect" to try again.\x1b[0m');
      }, SSH_HANDSHAKE_TIMEOUT_MS);

      const stream = liveSrv.getStream<unknown>(address);
      subscriptionRef.current = stream.subscribe({
        next: (event: LiveChannelEvent<unknown>) => {
          if (isLiveChannelMessageEvent(event)) {
            const msg = parseTerminalOutput(event.message);
            if (msg) {
              switch (msg.type) {
                case 'status':
                  // VM provisioning status updates from backend
                  // Update current VM ID ref if backend sends it (needed for input routing)
                  if (msg.vmId && msg.vmId !== currentVmIdRef.current) {
                    connectionLogRef.current.info('Received VM ID from backend', {
                      vmId: msg.vmId,
                      previousId: currentVmIdRef.current,
                    });
                    currentVmIdRef.current = msg.vmId;
                  }

                  connectionLogRef.current.info('VM status update', {
                    vmId: msg.vmId || id,
                    state: msg.state,
                    message: msg.message,
                  });

                  if (msg.state === 'pending') {
                    terminal.writeln(`\x1b[90m   │  ⏳ ${msg.message || 'Waiting in queue...'}\x1b[0m`);
                  } else if (msg.state === 'provisioning') {
                    terminal.writeln(`\x1b[90m   │  ⏳ ${msg.message || 'VM is booting...'}\x1b[0m`);
                  } else if (msg.state === 'active') {
                    terminal.writeln(`\x1b[90m   │  ✓ ${msg.message || 'VM is ready'}\x1b[0m`);
                  } else if (msg.state === 'retrying') {
                    terminal.writeln(`\x1b[33m   │  ⚠ ${msg.message || 'Retrying...'}\x1b[0m`);
                  } else {
                    terminal.writeln(`\x1b[90m   │  ${msg.message || `Status: ${msg.state}`}\x1b[0m`);
                  }
                  break;

                case 'output':
                  if (msg.data) {
                    terminal.write(msg.data);
                  }
                  break;

                case 'error':
                  if (handshakeTimeoutRef.current) {
                    clearTimeout(handshakeTimeoutRef.current);
                    handshakeTimeoutRef.current = null;
                  }
                  connectionLogRef.current.error('Backend error received', null, {
                    vmId: id,
                    backendError: msg.error,
                    category: 'backend_error',
                  });

                  // Backend handles SSH auth retries with fresh VM provisioning
                  // If we receive an error here, it's a final failure after all retries
                  terminal.writeln('\r\n');
                  terminal.writeln(`\x1b[31m✖ Error: ${msg.error}\x1b[0m`);

                  setError(msg.error || 'Unknown error');
                  setStatus('error');
                  break;

                case 'connected':
                  if (handshakeTimeoutRef.current) {
                    clearTimeout(handshakeTimeoutRef.current);
                    handshakeTimeoutRef.current = null;
                  }

                  // Update current VM ID ref from backend
                  if (msg.vmId) {
                    connectionLogRef.current.info('VM ID from backend', { vmId: msg.vmId });
                    currentVmIdRef.current = msg.vmId;
                  }

                  connectionLogRef.current.info('SSH connection SUCCESSFUL', {
                    vmId: msg.vmId || id,
                    category: 'connected',
                  });
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
                    sendInput(inputData);
                  });

                  sendResize(terminal.rows, terminal.cols);
                  break;

                case 'disconnected':
                  if (handshakeTimeoutRef.current) {
                    clearTimeout(handshakeTimeoutRef.current);
                    handshakeTimeoutRef.current = null;
                  }
                  connectionLogRef.current.info('VM disconnected', {
                    vmId: id,
                    category: 'disconnected',
                  });
                  setStatus('disconnected');
                  terminal.writeln('\r\n');
                  terminal.writeln('\x1b[33m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m');
                  terminal.writeln('\x1b[33m  Session ended - VM disconnected\x1b[0m');
                  terminal.writeln('\x1b[33m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m');
                  break;

                case 'heartbeat':
                  // Silently ignore - backend sends these every 3s to keep stream alive
                  break;
              }
            }
          }

          if (isLiveChannelStatusEvent(event)) {
            const stateNames: Record<LiveChannelConnectionState, string> = {
              [LiveChannelConnectionState.Pending]: 'Pending',
              [LiveChannelConnectionState.Connected]: 'Connected',
              [LiveChannelConnectionState.Connecting]: 'Connecting',
              [LiveChannelConnectionState.Disconnected]: 'Disconnected',
              [LiveChannelConnectionState.Shutdown]: 'Shutdown',
              [LiveChannelConnectionState.Invalid]: 'Invalid',
            };
            connectionLogRef.current.liveStream('Status change', {
              vmId: id,
              state: stateNames[event.state] ?? `Unknown(${event.state})`,
              stateCode: event.state,
            });

            if (event.state === LiveChannelConnectionState.Connected) {
              connectionLogRef.current.info('LiveStream connected, awaiting SSH handshake', { vmId: id });
              terminal.writeln('\x1b[90m       Waiting for SSH handshake...\x1b[0m');
            } else if (event.state === LiveChannelConnectionState.Disconnected) {
              connectionLogRef.current.warn('LiveStream disconnected', {
                vmId: id,
                category: 'live_channel_disconnected',
              });
              if (inputDisposerRef.current) {
                inputDisposerRef.current.dispose();
                inputDisposerRef.current = null;
              }
              setStatus((prev) => {
                if (prev === 'connected') {
                  terminal.writeln('\r\n\x1b[33m⚠ Connection lost\x1b[0m');
                  return 'disconnected';
                }
                return prev;
              });
            }
          }
        },
        error: (err) => {
          if (handshakeTimeoutRef.current) {
            clearTimeout(handshakeTimeoutRef.current);
            handshakeTimeoutRef.current = null;
          }
          if (inputDisposerRef.current) {
            inputDisposerRef.current.dispose();
            inputDisposerRef.current = null;
          }
          connectionLogRef.current.error('LiveStream subscription error', err, {
            vmId: id,
            category: 'live_stream_error',
          });
          setError('Stream connection failed');
          setStatus('error');
          terminal.writeln(`\r\n\x1b[31mStream error: ${err?.message || 'Unknown error'}\x1b[0m`);
        },
        complete: () => {
          if (handshakeTimeoutRef.current) {
            clearTimeout(handshakeTimeoutRef.current);
            handshakeTimeoutRef.current = null;
          }
          if (inputDisposerRef.current) {
            inputDisposerRef.current.dispose();
            inputDisposerRef.current = null;
          }
          connectionLogRef.current.info('LiveStream completed', {
            vmId: id,
            category: 'stream_complete',
          });
          setStatus((prev) => {
            if (prev === 'connected') {
              terminal.writeln('\r\n\x1b[33mStream ended\x1b[0m');
              return 'disconnected';
            }
            return prev;
          });
        },
      });
    },
    [cleanup, parseTerminalOutput, sendInput, sendResize]
  );

  /**
   * Connect to the terminal
   *
   * The backend handles all VM lifecycle decisions:
   * - Backend tracks active VMs per user and reuses them automatically
   * - If user has no active VM, backend provisions a fresh one
   * - Backend pushes status updates via the stream
   */
  const connect = useCallback(async () => {
    const terminal = terminalRef.current;
    if (!terminal) {
      connectionLogRef.current.error('Terminal instance not available', null, {
        category: 'terminal_not_ready',
      });
      setError('Terminal instance not available');
      return;
    }

    // Create a fresh logger for each connection attempt (isolated timing state)
    connectionLogRef.current = createConnectionLog();
    connectionLogRef.current.startConnection();
    connectionLogRef.current.info('Starting connection sequence');

    setStatus('connecting');
    setError(null);
    cleanup();

    // Clear vmId during reconnect so stray resize/input events are dropped
    // until the new session sends 'connected' with the real vmId
    currentVmIdRef.current = null;

    // Clear terminal and show connection header
    terminal.clear();
    terminal.writeln('\x1b[1;36m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m');
    terminal.writeln('\x1b[1;36m  Grafana Pathfinder - Sandbox Terminal\x1b[0m');
    terminal.writeln('\x1b[1;36m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m');
    terminal.writeln('');

    // Always connect with 'new' - backend tracks VMs per user and reuses automatically
    terminal.writeln('\x1b[33m⏳ Connecting to sandbox...\x1b[0m');
    terminal.writeln('\x1b[90m   ├─ Backend will assign your VM...\x1b[0m');

    connectionLogRef.current.info('Connecting to Live stream with new');
    terminal.writeln('\x1b[90m   └─ Establishing connection...\x1b[0m');

    // Connect to stream - backend handles VM assignment and reuse
    connectLiveStream('new', terminal);
  }, [terminalRef, cleanup, connectLiveStream]);

  /**
   * Disconnect from the terminal
   * Note: We keep vmId so we can reconnect to the same VM if it's still active
   */
  const disconnect = useCallback(() => {
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

  /**
   * Send resize event to backend via Grafana Live publish
   */
  const resize = useCallback(
    (rows: number, cols: number) => {
      sendResize(rows, cols);
    },
    [sendResize]
  );

  /**
   * Send a command to the terminal (appends newline to execute)
   */
  const sendCommand = useCallback(
    async (command: string) => {
      if (!addressRef.current) {
        connectionLogRef.current.warn('Cannot send command: not connected');
        return;
      }
      await sendInput(command + '\n');
    },
    [sendInput]
  );

  return {
    status,
    connect,
    disconnect,
    resize,
    sendCommand,
    error,
  };
}
