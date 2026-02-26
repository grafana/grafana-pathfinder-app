/**
 * Grafana Live terminal connection hook
 *
 * This hook provides the interface for connecting to a terminal backend
 * via Grafana Live streaming. It manages VM provisioning through the
 * plugin backend and bidirectional terminal I/O via Grafana Live channels.
 */

import { useCallback, useEffect, useRef, useState, RefObject } from 'react';
import { getBackendSrv, getGrafanaLiveSrv } from '@grafana/runtime';
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
import { lastValueFrom, Subscription } from 'rxjs';
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
    const errorDetails = error instanceof Error
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
      const errorDetails = error instanceof Error
        ? { errorName: error.name, errorMessage: error.message }
        : { rawError: error };
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
// While the SDK's PublishStream handler supports receiving messages from clients,
// Grafana's /api/live/publish HTTP endpoint restricts frontend publishing to
// plugin channels (returns 403 Forbidden). This appears to be a security restriction.
// We use HTTP POST for terminal input as a workaround.

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/** Error indicating authentication failure - requires re-registration */
export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

/** Plugin ID for constructing API paths */
const PLUGIN_ID = 'grafana-pathfinder-app';

interface UseTerminalLiveOptions {
  /** VM ID to connect to (if already provisioned) */
  vmId?: string | null;
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
  /** Error message if status is 'error' */
  error: string | null;
  /** Current VM ID */
  vmId: string | null;
}

/** Terminal stream output message (sent from backend in DataFrame) */
interface TerminalStreamOutput {
  type: 'output' | 'error' | 'connected' | 'disconnected';
  data?: string;
  error?: string;
}

/** VM response from backend */
interface VMResponse {
  id: string;
  state: string;
  credentials?: {
    publicIp: string;
    sshPort: number;
    sshUser: string;
  };
  errorMessage?: string;
}

/**
 * Terminal connection hook using Grafana Live streaming
 *
 * This connects to the plugin backend which:
 * 1. Provisions a VM via Brokkr
 * 2. Establishes SSH connection to the VM
 * 3. Streams terminal I/O via Grafana Live
 */
/** Maximum number of consecutive SSH auth failures before giving up */
const MAX_SSH_AUTH_RETRIES = 3;

export function useTerminalLive({ vmId: initialVmId, terminalRef }: UseTerminalLiveOptions): UseTerminalLiveReturn {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const [vmId, setVmId] = useState<string | null>(initialVmId ?? null);

  // REACT: refs for subscriptions and cleanup (R1)
  const subscriptionRef = useRef<Subscription | null>(null);
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentVmIdRef = useRef<string | null>(null);
  const inputDisposerRef = useRef<{ dispose: () => void } | null>(null);
  const handshakeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Track consecutive SSH auth failures to prevent infinite retry loops
  const sshAuthFailureCountRef = useRef<number>(0);

  // Cleanup function
  const cleanup = useCallback(() => {
    if (subscriptionRef.current) {
      subscriptionRef.current.unsubscribe();
      subscriptionRef.current = null;
    }
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
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
   * Create a new VM via the plugin backend
   */
  const createVM = useCallback(async (): Promise<VMResponse> => {
    const url = `/api/plugins/${PLUGIN_ID}/resources/vms`;
    const startTime = performance.now();
    const httpLog = connectionLog.httpRequest('POST', url, startTime);

    connectionLog.info('Creating VM', { template: 'vm-aws' });

    try {
      const response = await lastValueFrom(
        getBackendSrv().fetch<VMResponse>({
          url,
          method: 'POST',
          data: { template: 'vm-aws' },
        })
      );
      httpLog.success(response.status, { vmId: response.data.id, vmState: response.data.state });
      return response.data;
    } catch (err: unknown) {
      // Check for 401/authentication errors - require re-registration
      const error = err as { status?: number; data?: { error?: string } };
      httpLog.failure(err, error.status);

      if (error.status === 401 || error.status === 503) {
        const message = error.data?.error || 'Authentication failed';
        connectionLog.error('Authentication error during VM creation', err, {
          status: error.status,
          serverMessage: message,
          category: 'auth_failure',
        });
        if (message.includes('not registered') || message.includes('authentication failed')) {
          throw new AuthenticationError(
            'Coda registration expired or invalid. Please re-register in Plugin Configuration.'
          );
        }
      }
      throw err;
    }
  }, []);

  /**
   * Get VM status from the plugin backend
   */
  const getVM = useCallback(async (id: string): Promise<VMResponse> => {
    const url = `/api/plugins/${PLUGIN_ID}/resources/vms/${id}`;
    const startTime = performance.now();
    const httpLog = connectionLog.httpRequest('GET', url, startTime);

    try {
      const response = await lastValueFrom(
        getBackendSrv().fetch<VMResponse>({
          url,
          method: 'GET',
        })
      );
      httpLog.success(response.status, { vmId: id, vmState: response.data.state });
      return response.data;
    } catch (err: unknown) {
      // Check for 401/authentication errors - require re-registration
      const error = err as { status?: number; data?: { error?: string } };
      httpLog.failure(err, error.status);

      if (error.status === 401 || error.status === 503) {
        const message = error.data?.error || 'Authentication failed';
        connectionLog.error('Authentication error fetching VM', err, {
          vmId: id,
          status: error.status,
          serverMessage: message,
          category: 'auth_failure',
        });
        if (message.includes('not registered') || message.includes('authentication failed')) {
          throw new AuthenticationError(
            'Coda registration expired or invalid. Please re-register in Plugin Configuration.'
          );
        }
      }
      throw err;
    }
  }, []);

  /**
   * Wait for VM to become active
   */
  const waitForVM = useCallback(
    async (id: string, terminal: Terminal): Promise<VMResponse> => {
      return new Promise((resolve, reject) => {
        let attempts = 0;
        const maxAttempts = 60; // 2 minutes at 2s intervals

        pollingIntervalRef.current = setInterval(async () => {
          attempts++;

          try {
            const vm = await getVM(id);

            switch (vm.state) {
              case 'active':
                if (pollingIntervalRef.current) {
                  clearInterval(pollingIntervalRef.current);
                  pollingIntervalRef.current = null;
                }
                resolve(vm);
                break;

              case 'error':
                if (pollingIntervalRef.current) {
                  clearInterval(pollingIntervalRef.current);
                  pollingIntervalRef.current = null;
                }
                reject(new Error(vm.errorMessage || 'VM provisioning failed'));
                break;

              case 'destroying':
              case 'destroyed':
                if (pollingIntervalRef.current) {
                  clearInterval(pollingIntervalRef.current);
                  pollingIntervalRef.current = null;
                }
                reject(new Error('VM has been destroyed'));
                break;

              case 'provisioning':
                terminal.writeln(`\x1b[90m   │  ⏳ Booting... (${attempts * 2}s)\x1b[0m`);
                break;

              case 'pending':
                terminal.writeln(`\x1b[90m   │  ⏳ Queued... (${attempts * 2}s)\x1b[0m`);
                break;
            }

            if (attempts >= maxAttempts) {
              if (pollingIntervalRef.current) {
                clearInterval(pollingIntervalRef.current);
                pollingIntervalRef.current = null;
              }
              reject(new Error('Timeout waiting for VM to become active'));
            }
          } catch (err) {
            if (pollingIntervalRef.current) {
              clearInterval(pollingIntervalRef.current);
              pollingIntervalRef.current = null;
            }
            reject(err);
          }
        }, 2000);
      });
    },
    [getVM]
  );

  /**
   * Send input to the terminal via HTTP POST
   *
   * Note: Grafana Live's /api/live/publish endpoint restricts frontend publishing
   * to plugin channels (returns 403 Forbidden). We use a dedicated HTTP endpoint
   * for terminal input instead.
   *
   * Architecture:
   * - Output: Grafana Live streaming (RunStream → frontend)
   * - Input: HTTP POST /api/plugins/{id}/resources/terminal/{vmId} (frontend → backend)
   */
  const sendInput = useCallback(async (id: string, inputData: string) => {
    const url = `/api/plugins/${PLUGIN_ID}/resources/terminal/${id}`;
    const startTime = performance.now();

    try {
      await getBackendSrv().post(url, {
        type: 'input',
        data: inputData,
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
    const url = `/api/plugins/${PLUGIN_ID}/resources/terminal/${id}`;
    const startTime = performance.now();
    const httpLog = connectionLog.httpRequest('POST', `${url} (resize)`, startTime);

    try {
      await getBackendSrv().post(url, {
        type: 'resize',
        rows,
        cols,
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
        namespace: PLUGIN_ID,
        path: `terminal/${id}/${nonce}`,
      };

      const channelPath = `${address.scope}/${address.namespace}/${address.path}`;
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

                  // If SSH authentication failed, the VM is likely stale or being recycled.
                  // Track failures to prevent infinite retry loops.
                  const isSSHAuthError =
                    msg.error?.includes('SSH authentication failed') ||
                    msg.error?.includes('auth_failed') ||
                    msg.error?.includes('Could not authenticate');
                  
                  if (isSSHAuthError) {
                    sshAuthFailureCountRef.current += 1;
                    const failureCount = sshAuthFailureCountRef.current;
                    
                    connectionLog.warn('SSH auth failed - clearing stale VM ID to provision fresh VM on retry', {
                      vmId: id,
                      category: 'stale_vm_cleared',
                      failureCount,
                      maxRetries: MAX_SSH_AUTH_RETRIES,
                    });
                    
                    // Clear the cached vmId so next connection provisions a fresh VM
                    setVmId(null);
                    
                    // If we've exceeded max retries, stop the stream and show permanent error
                    if (failureCount >= MAX_SSH_AUTH_RETRIES) {
                      connectionLog.error('Max SSH auth retries exceeded - stopping reconnection attempts', null, {
                        vmId: id,
                        failureCount,
                        category: 'max_retries_exceeded',
                      });
                      
                      // Unsubscribe to stop Grafana Live from retrying
                      cleanup();
                      
                      terminal.writeln('\r\n');
                      terminal.writeln('\x1b[31m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m');
                      terminal.writeln(`\x1b[31m  ✖ SSH authentication failed after ${failureCount} attempts\x1b[0m`);
                      terminal.writeln('\x1b[31m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m');
                      terminal.writeln('');
                      terminal.writeln('\x1b[33m  The VM pool may be temporarily unavailable.\x1b[0m');
                      terminal.writeln('\x1b[90m  Please wait a moment and press "Connect" to try again.\x1b[0m');
                      
                      setError('SSH authentication failed after multiple attempts');
                      setStatus('error');
                      return;
                    }
                    
                    terminal.writeln('\r\n');
                    terminal.writeln(`\x1b[31m✖ Error: ${msg.error}\x1b[0m`);
                    terminal.writeln(`\x1b[90m  The VM may have been recycled. Retrying... (${failureCount}/${MAX_SSH_AUTH_RETRIES})\x1b[0m`);
                  } else {
                    terminal.writeln('\r\n');
                    terminal.writeln(`\x1b[31m✖ Error: ${msg.error}\x1b[0m`);
                  }
                  
                  setError(msg.error || 'Unknown error');
                  break;

                case 'connected':
                  if (handshakeTimeoutRef.current) {
                    clearTimeout(handshakeTimeoutRef.current);
                    handshakeTimeoutRef.current = null;
                  }
                  // Reset failure counter on successful connection
                  sshAuthFailureCountRef.current = 0;
                  
                  connectionLog.info('SSH connection SUCCESSFUL', {
                    vmId: id,
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

                  sendResize(id, terminal.rows, terminal.cols);
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
                  setVmId(null);
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
    connectionLog.info('Starting connection sequence', { existingVmId: vmId });

    setStatus('connecting');
    setError(null);
    cleanup();
    
    // Reset SSH auth failure counter for fresh connection attempt
    sshAuthFailureCountRef.current = 0;

    // Clear terminal and show connection header
    terminal.clear();
    terminal.writeln('\x1b[1;36m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m');
    terminal.writeln('\x1b[1;36m  Grafana Pathfinder - Sandbox Terminal\x1b[0m');
    terminal.writeln('\x1b[1;36m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m');
    terminal.writeln('');

    try {
      let currentVmId = vmId;

      // If we have an existing VM, check if it's still active
      if (currentVmId) {
        connectionLog.info('Checking existing VM', { vmId: currentVmId });
        terminal.writeln('\x1b[33m⏳ Reconnecting to existing VM...\x1b[0m');
        terminal.writeln(`\x1b[90m   ├─ Checking VM status: \x1b[37m${currentVmId}\x1b[0m`);
        try {
          const existingVm = await getVM(currentVmId);
          const hasCredentials = !!existingVm.credentials;

          connectionLog.info('Existing VM status', {
            vmId: currentVmId,
            state: existingVm.state,
            hasCredentials,
            publicIp: existingVm.credentials?.publicIp,
          });

          if (existingVm.state === 'active' && hasCredentials) {
            connectionLog.info('VM still active with valid credentials', { vmId: currentVmId });
            terminal.writeln('\x1b[90m   ├─ VM still active\x1b[0m');
          } else if (existingVm.state === 'active' && !hasCredentials) {
            // VM is active but credentials are missing - this is a stale/invalid VM
            connectionLog.warn('VM active but credentials missing, provisioning new one', {
              vmId: currentVmId,
              state: existingVm.state,
              category: 'stale_vm_no_credentials',
            });
            terminal.writeln('\x1b[90m   ├─ VM credentials expired, provisioning new one...\x1b[0m');
            currentVmId = null;
            setVmId(null);
          } else if (existingVm.state === 'destroying' || existingVm.state === 'destroyed') {
            connectionLog.info('VM expired, will provision new one', {
              vmId: currentVmId,
              state: existingVm.state,
            });
            terminal.writeln('\x1b[90m   ├─ VM expired, provisioning new one...\x1b[0m');
            currentVmId = null;
            setVmId(null);
          } else if (existingVm.state === 'error') {
            connectionLog.warn('VM in error state, will provision new one', {
              vmId: currentVmId,
              state: existingVm.state,
              errorMessage: existingVm.errorMessage,
            });
            terminal.writeln('\x1b[90m   ├─ VM in error state, provisioning new one...\x1b[0m');
            currentVmId = null;
            setVmId(null);
          } else {
            connectionLog.info('VM not ready, waiting', { vmId: currentVmId, state: existingVm.state });
            terminal.writeln(`\x1b[90m   ├─ VM state: ${existingVm.state}, waiting...\x1b[0m`);
            await waitForVM(currentVmId, terminal);
          }
        } catch (vmErr) {
          // VM doesn't exist anymore, provision a new one
          connectionLog.warn('Failed to fetch existing VM, will provision new one', {
            vmId: currentVmId,
            error: vmErr instanceof Error ? vmErr.message : String(vmErr),
          });
          terminal.writeln('\x1b[90m   ├─ VM no longer exists, provisioning new one...\x1b[0m');
          currentVmId = null;
          setVmId(null);
        }
      }

      // Create VM if we don't have one
      if (!currentVmId) {
        connectionLog.info('Provisioning new VM');
        terminal.writeln('\x1b[33m⏳ Provisioning sandbox VM...\x1b[0m');
        terminal.writeln('\x1b[90m   ├─ Requesting VM from pool...\x1b[0m');
        const vm = await createVM();
        currentVmId = vm.id;
        setVmId(currentVmId);
        connectionLog.info('VM allocated', { vmId: currentVmId, state: vm.state });
        terminal.writeln(`\x1b[90m   ├─ VM allocated: \x1b[37m${vm.id}\x1b[0m`);

        // Wait for VM to be active (only for new VMs)
        connectionLog.info('Waiting for VM to boot', { vmId: currentVmId });
        terminal.writeln('\x1b[90m   ├─ Waiting for VM to boot...\x1b[0m');
        await waitForVM(currentVmId, terminal);
      }

      connectionLog.info('VM ready, establishing SSH connection', { vmId: currentVmId });
      terminal.writeln('\x1b[90m   ├─ VM ready\x1b[0m');

      // Connect to Grafana Live stream
      terminal.writeln('\x1b[90m   └─ Establishing SSH connection...\x1b[0m');
      connectLiveStream(currentVmId, terminal);
    } catch (err) {
      const isAuthError = err instanceof AuthenticationError;
      const errorMessage = err instanceof Error ? err.message : 'Connection failed';

      connectionLog.error('Connection sequence failed', err, {
        isAuthError,
        category: isAuthError ? 'auth_failure' : 'connection_failure',
      });

      terminal.writeln('');
      terminal.writeln('\x1b[31m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m');
      terminal.writeln(`\x1b[31m  ✖ Connection failed: ${errorMessage}\x1b[0m`);
      terminal.writeln('\x1b[31m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m');
      terminal.writeln('');
      if (isAuthError) {
        terminal.writeln('\x1b[33m  To fix this:\x1b[0m');
        terminal.writeln('\x1b[90m  1. Go to Administration > Plugins > Interactive learning\x1b[0m');
        terminal.writeln('\x1b[90m  2. Enable dev mode and Coda terminal\x1b[0m');
        terminal.writeln('\x1b[90m  3. Enter your enrollment key and click "Register with Coda"\x1b[0m');
      } else {
        terminal.writeln('\x1b[90m  Press "Connect" to try again.\x1b[0m');
      }
      setError(errorMessage);
      setStatus('error');
    }
  }, [vmId, terminalRef, cleanup, getVM, createVM, waitForVM, connectLiveStream]);

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

  return {
    status,
    connect,
    disconnect,
    resize,
    error,
    vmId,
  };
}
