/**
 * Grafana Live terminal connection hook
 *
 * This hook provides the interface for connecting to a terminal backend
 * via Grafana Live streaming. It manages VM provisioning through the
 * plugin backend and bidirectional terminal I/O via Grafana Live channels.
 */

import { useCallback, useEffect, useRef, useState, RefObject } from 'react';
import { config, getBackendSrv, getGrafanaLiveSrv } from '@grafana/runtime';
import {
  LiveChannelScope,
  LiveChannelAddress,
  LiveChannelEvent,
  isLiveChannelMessageEvent,
  isLiveChannelStatusEvent,
  LiveChannelConnectionState,
  DataFrame,
  dataFrameFromJSON,
  DataFrameJSON,
} from '@grafana/data';
import { Subscription } from 'rxjs';
import type { Terminal } from '@xterm/xterm';

/**
 * Connection logging utility for diagnosing frontend-backend connection issues.
 * Logs are prefixed with [Terminal] and include timing information.
 */
const connectionLog = {
  connectionStartTime: 0,

  startConnection: () => {
    connectionLog.connectionStartTime = performance.now();
    console.log('[Terminal] Connection sequence started', {
      timestamp: new Date().toISOString(),
    });
  },

  elapsed: () => Math.round(performance.now() - connectionLog.connectionStartTime),

  info: (message: string, data?: Record<string, unknown>) => {
    console.log(`[Terminal] ${message}`, {
      elapsedMs: connectionLog.elapsed(),
      ...data,
    });
  },

  warn: (message: string, data?: Record<string, unknown>) => {
    console.warn(`[Terminal] ${message}`, {
      elapsedMs: connectionLog.elapsed(),
      ...data,
    });
  },

  error: (message: string, error?: unknown, data?: Record<string, unknown>) => {
    const errorDetails =
      error instanceof Error
        ? { errorName: error.name, errorMessage: error.message, errorStack: error.stack }
        : { rawError: error };
    console.error(`[Terminal] ${message}`, {
      elapsedMs: connectionLog.elapsed(),
      ...errorDetails,
      ...data,
    });
  },

  httpRequest: (method: string, url: string, startTime: number) => ({
    success: (status: number, data?: Record<string, unknown>) => {
      const duration = Math.round(performance.now() - startTime);
      console.log(`[Terminal] HTTP ${method} ${url} - SUCCESS`, {
        status,
        durationMs: duration,
        elapsedMs: connectionLog.elapsed(),
        ...data,
      });
    },
    failure: (error: unknown, status?: number) => {
      const duration = Math.round(performance.now() - startTime);
      const errorDetails =
        error instanceof Error ? { errorName: error.name, errorMessage: error.message } : { rawError: error };
      console.error(`[Terminal] HTTP ${method} ${url} - FAILED`, {
        status,
        durationMs: duration,
        elapsedMs: connectionLog.elapsed(),
        ...errorDetails,
      });
    },
  }),

  liveStream: (event: string, data?: Record<string, unknown>) => {
    console.log(`[Terminal] LiveStream: ${event}`, {
      elapsedMs: connectionLog.elapsed(),
      ...data,
    });
  },
};

// Note on Grafana Live bidirectional limitations:
// The SDK's PublishStream handler supports receiving messages from clients,
// but Grafana blocks frontend publishing to plugin channels (403 Forbidden).
// This restriction applies to BOTH:
//   - HTTP POST to /api/live/publish
//   - WebSocket publish with { useSocket: true }
// We use HTTP POST to a dedicated plugin endpoint as a workaround.

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

/** Terminal stream output message (sent from backend in DataFrame) */
interface TerminalStreamOutput {
  type: 'output' | 'error' | 'connected' | 'disconnected' | 'status';
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

  // REACT: refs for subscriptions and cleanup (R1)
  const subscriptionRef = useRef<Subscription | null>(null);
  // currentVmIdRef tracks the VM ID for the current session (needed for input routing)
  const currentVmIdRef = useRef<string | null>(null);
  const inputDisposerRef = useRef<{ dispose: () => void } | null>(null);
  const handshakeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  }, []);

  // REACT: cleanup on unmount (R1)
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  /**
   * Send input to the terminal via HTTP POST
   *
   * Note: Grafana Live's publish is blocked for plugin channels (403 Forbidden),
   * even when using the experimental { useSocket: true } option.
   * We use a dedicated HTTP endpoint for terminal input instead.
   *
   * Architecture:
   * - Output: Grafana Live streaming (RunStream → frontend)
   * - Input: HTTP POST /api/plugins/{id}/resources/terminal/{vmId} (frontend → backend)
   */
  const sendInput = useCallback(async (id: string, inputData: string) => {
    // Don't send input for placeholder IDs - wait for real VM ID
    if (!id || id === 'new') {
      return;
    }

    const url = `/api/plugins/${PLUGIN_ID}/resources/terminal/${id}`;
    const startTime = performance.now();
    const userLogin = config.bootData?.user?.login || 'anonymous';

    try {
      await getBackendSrv().post(url, {
        type: 'input',
        data: inputData,
        user: userLogin,
      });
      // Only log slow input requests (> 500ms) to avoid noise
      const duration = performance.now() - startTime;
      if (duration > 500) {
        connectionLog.warn('Slow input request', { vmId: id, durationMs: Math.round(duration) });
      }
    } catch (err) {
      connectionLog.error('Failed to send input', err, {
        vmId: id,
        inputLength: inputData.length,
        category: 'input_failure',
      });
    }
  }, []);

  /**
   * Send resize event to the terminal via HTTP POST
   */
  const sendResize = useCallback(async (id: string, rows: number, cols: number) => {
    // Don't send resize for placeholder IDs - wait for real VM ID
    if (!id || id === 'new') {
      return;
    }

    const url = `/api/plugins/${PLUGIN_ID}/resources/terminal/${id}`;
    const startTime = performance.now();
    const httpLog = connectionLog.httpRequest('POST', `${url} (resize)`, startTime);
    const userLogin = config.bootData?.user?.login || 'anonymous';

    try {
      await getBackendSrv().post(url, {
        type: 'resize',
        rows,
        cols,
        user: userLogin,
      });
      httpLog.success(200, { vmId: id, rows, cols });
    } catch (err) {
      httpLog.failure(err);
      connectionLog.error('Failed to send resize', err, {
        vmId: id,
        rows,
        cols,
        category: 'resize_failure',
      });
    }
  }, []);

  /**
   * Parse terminal output from a Grafana Live message.
   * Handles both wire format (DataFrameJSON: {schema, data}) and in-memory format (DataFrame: {fields}).
   */
  const parseTerminalOutput = useCallback((message: DataFrame | DataFrameJSON): TerminalStreamOutput | null => {
    try {
      // Convert wire format (DataFrameJSON) to in-memory DataFrame if needed
      let frame: DataFrame;
      if ('schema' in message && 'data' in message) {
        frame = dataFrameFromJSON(message as DataFrameJSON);
      } else {
        frame = message as DataFrame;
      }

      const dataField = frame.fields?.[0];
      if (dataField?.values && dataField.values.length > 0) {
        const jsonStr = dataField.values[0];
        if (typeof jsonStr === 'string') {
          return JSON.parse(jsonStr) as TerminalStreamOutput;
        }
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
        connectionLog.error('Grafana Live service not available', null, {
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
      connectionLog.info('Subscribing to LiveStream', {
        vmId: id,
        channel: channelPath,
        nonce,
      });

      currentVmIdRef.current = id;

      // Safety-net timeout: if the backend never sends "connected" (e.g. SSH
      // dial blocks or RunStream fails silently), surface an error instead of
      // hanging forever. 35 s > the 30 s SSH dial timeout on the backend.
      const SSH_HANDSHAKE_TIMEOUT_MS = 35_000;
      handshakeTimeoutRef.current = setTimeout(() => {
        handshakeTimeoutRef.current = null;
        connectionLog.error('SSH handshake timeout', null, {
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

      const stream = liveSrv.getStream<DataFrame>(address);
      subscriptionRef.current = stream.subscribe({
        next: (event: LiveChannelEvent<DataFrame>) => {
          if (isLiveChannelMessageEvent(event)) {
            const msg = parseTerminalOutput(event.message);
            if (msg) {
              switch (msg.type) {
                case 'status':
                  // VM provisioning status updates from backend
                  // Update current VM ID ref if backend sends it (needed for input routing)
                  if (msg.vmId && msg.vmId !== currentVmIdRef.current) {
                    connectionLog.info('Received VM ID from backend', {
                      vmId: msg.vmId,
                      previousId: currentVmIdRef.current,
                    });
                    currentVmIdRef.current = msg.vmId;
                  }

                  connectionLog.info('VM status update', {
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
                  connectionLog.error('Backend error received', null, {
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

                  // Update current VM ID ref from backend (needed for input routing)
                  if (msg.vmId) {
                    connectionLog.info('VM ID from backend', { vmId: msg.vmId });
                    currentVmIdRef.current = msg.vmId;
                  }

                  connectionLog.info('SSH connection SUCCESSFUL', {
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
                    if (currentVmIdRef.current) {
                      sendInput(currentVmIdRef.current, inputData);
                    }
                  });

                  // Use the actual VM ID from backend (not the placeholder 'new')
                  const actualVmId = msg.vmId || currentVmIdRef.current || id;
                  if (actualVmId && actualVmId !== 'new') {
                    sendResize(actualVmId, terminal.rows, terminal.cols);
                  }
                  break;

                case 'disconnected':
                  if (handshakeTimeoutRef.current) {
                    clearTimeout(handshakeTimeoutRef.current);
                    handshakeTimeoutRef.current = null;
                  }
                  connectionLog.info('VM disconnected', {
                    vmId: id,
                    category: 'disconnected',
                  });
                  setStatus('disconnected');
                  terminal.writeln('\r\n');
                  terminal.writeln('\x1b[33m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m');
                  terminal.writeln('\x1b[33m  Session ended - VM disconnected\x1b[0m');
                  terminal.writeln('\x1b[33m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m');
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
            connectionLog.liveStream('Status change', {
              vmId: id,
              state: stateNames[event.state] ?? `Unknown(${event.state})`,
              stateCode: event.state,
            });

            if (event.state === LiveChannelConnectionState.Connected) {
              connectionLog.info('LiveStream connected, awaiting SSH handshake', { vmId: id });
              terminal.writeln('\x1b[90m       Waiting for SSH handshake...\x1b[0m');
            } else if (event.state === LiveChannelConnectionState.Disconnected) {
              connectionLog.warn('LiveStream disconnected', {
                vmId: id,
                category: 'live_channel_disconnected',
              });
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
          connectionLog.error('LiveStream subscription error', err, {
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
          connectionLog.info('LiveStream completed', {
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
      connectionLog.error('Terminal instance not available', null, {
        category: 'terminal_not_ready',
      });
      setError('Terminal instance not available');
      return;
    }

    connectionLog.startConnection();
    connectionLog.info('Starting connection sequence');

    setStatus('connecting');
    setError(null);
    cleanup();

    // Clear terminal and show connection header
    terminal.clear();
    terminal.writeln('\x1b[1;36m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m');
    terminal.writeln('\x1b[1;36m  Grafana Pathfinder - Sandbox Terminal\x1b[0m');
    terminal.writeln('\x1b[1;36m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m');
    terminal.writeln('');

    // Always connect with 'new' - backend tracks VMs per user and reuses automatically
    terminal.writeln('\x1b[33m⏳ Connecting to sandbox...\x1b[0m');
    terminal.writeln('\x1b[90m   ├─ Backend will assign your VM...\x1b[0m');

    connectionLog.info('Connecting to Live stream with new');
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
   * Send resize event to backend
   */
  const resize = useCallback(
    (rows: number, cols: number) => {
      if (currentVmIdRef.current) {
        sendResize(currentVmIdRef.current, rows, cols);
      }
    },
    [sendResize]
  );

  /**
   * Send a command to the terminal (appends newline to execute)
   */
  const sendCommand = useCallback(
    async (command: string) => {
      const vmId = currentVmIdRef.current;
      if (!vmId) {
        connectionLog.warn('Cannot send command: no active VM');
        return;
      }
      await sendInput(vmId, command + '\n');
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
