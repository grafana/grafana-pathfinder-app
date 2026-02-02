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

// Note on Grafana Live bidirectional limitations:
// While the SDK's PublishStream handler supports receiving messages from clients,
// Grafana's /api/live/publish HTTP endpoint restricts frontend publishing to
// plugin channels (returns 403 Forbidden). This appears to be a security restriction.
// We use HTTP POST for terminal input as a workaround.

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

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
export function useTerminalLive({ vmId: initialVmId, terminalRef }: UseTerminalLiveOptions): UseTerminalLiveReturn {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const [vmId, setVmId] = useState<string | null>(initialVmId ?? null);

  // REACT: refs for subscriptions and cleanup (R1)
  const subscriptionRef = useRef<Subscription | null>(null);
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentVmIdRef = useRef<string | null>(null);
  const inputDisposerRef = useRef<{ dispose: () => void } | null>(null);

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
  }, []);

  // REACT: cleanup on unmount (R1)
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  /**
   * Create a new VM via the plugin backend
   */
  const createVM = useCallback(async (): Promise<VMResponse> => {
    const response = await lastValueFrom(
      getBackendSrv().fetch<VMResponse>({
        url: `/api/plugins/${PLUGIN_ID}/resources/vms`,
        method: 'POST',
        data: { template: 'vm-gcp' },
      })
    );
    return response.data;
  }, []);

  /**
   * Get VM status from the plugin backend
   */
  const getVM = useCallback(async (id: string): Promise<VMResponse> => {
    const response = await lastValueFrom(
      getBackendSrv().fetch<VMResponse>({
        url: `/api/plugins/${PLUGIN_ID}/resources/vms/${id}`,
        method: 'GET',
      })
    );
    return response.data;
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
    try {
      await getBackendSrv().post(`/api/plugins/${PLUGIN_ID}/resources/terminal/${id}`, {
        type: 'input',
        data: inputData,
      });
    } catch (err) {
      // Log but don't interrupt - input errors are usually transient
      console.error('[Terminal] Failed to send input:', err);
    }
  }, []);

  /**
   * Send resize event to the terminal via HTTP POST
   */
  const sendResize = useCallback(async (id: string, rows: number, cols: number) => {
    try {
      await getBackendSrv().post(`/api/plugins/${PLUGIN_ID}/resources/terminal/${id}`, {
        type: 'resize',
        rows,
        cols,
      });
    } catch (err) {
      console.error('[Terminal] Failed to send resize:', err);
    }
  }, []);

  /**
   * Parse terminal output from a DataFrame message
   */
  /**
   * Parse terminal output from a Grafana Live message.
   * Handles both wire format (DataFrameJSON: {schema, data}) and in-memory format (DataFrame: {fields}).
   */
  const parseTerminalOutput = useCallback((message: DataFrame | DataFrameJSON): TerminalStreamOutput | null => {
    try {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/0beec42b-59e6-44c2-822f-27c155a5c0e5',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useTerminalLive.hook.ts:parseTerminalOutput',message:'Parsing message',data:{messageKeys:Object.keys(message)},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'C'})}).catch(()=>{});
      // #endregion

      // Convert wire format (DataFrameJSON) to in-memory DataFrame if needed
      let frame: DataFrame;
      if ('schema' in message && 'data' in message) {
        // Wire format - use Grafana's built-in converter
        frame = dataFrameFromJSON(message as DataFrameJSON);
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/0beec42b-59e6-44c2-822f-27c155a5c0e5',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useTerminalLive.hook.ts:parseTerminalOutput',message:'Converted from wire format',data:{fieldCount:frame.fields?.length},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'C-fix'})}).catch(()=>{});
        // #endregion
      } else {
        frame = message as DataFrame;
      }

      // Extract data from the DataFrame
      if (frame.fields && frame.fields.length > 0) {
        const dataField = frame.fields[0];
        if (dataField.values && dataField.values.length > 0) {
          const jsonStr = dataField.values[0];
          if (typeof jsonStr === 'string') {
            const parsed = JSON.parse(jsonStr) as TerminalStreamOutput;
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/0beec42b-59e6-44c2-822f-27c155a5c0e5',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useTerminalLive.hook.ts:parseTerminalOutput',message:'Parsed successfully',data:{type:parsed.type,hasData:!!parsed.data},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'C-fix'})}).catch(()=>{});
            // #endregion
            return parsed;
          }
        }
      }
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/0beec42b-59e6-44c2-822f-27c155a5c0e5',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useTerminalLive.hook.ts:parseTerminalOutput',message:'Parse returned null - no data in frame',data:{fieldCount:frame.fields?.length},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'C'})}).catch(()=>{});
      // #endregion
    } catch (err) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/0beec42b-59e6-44c2-822f-27c155a5c0e5',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useTerminalLive.hook.ts:parseTerminalOutput',message:'Parse error',data:{error:String(err)},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'C'})}).catch(()=>{});
      // #endregion
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
        setError('Grafana Live service not available');
        setStatus('error');
        return;
      }

      // Channel address for terminal streaming
      // Format: plugin/{pluginId}/{path}
      const address: LiveChannelAddress = {
        scope: LiveChannelScope.Plugin,
        namespace: PLUGIN_ID,
        path: `terminal/${id}`,
      };

      currentVmIdRef.current = id;

      // Subscribe to the stream
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/0beec42b-59e6-44c2-822f-27c155a5c0e5',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useTerminalLive.hook.ts:connectLiveStream',message:'Subscribing to stream',data:{scope:address.scope,namespace:address.namespace,path:address.path},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'D'})}).catch(()=>{});
      // #endregion
      const stream = liveSrv.getStream<DataFrame>(address);
      subscriptionRef.current = stream.subscribe({
        next: (event: LiveChannelEvent<DataFrame>) => {
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/0beec42b-59e6-44c2-822f-27c155a5c0e5',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useTerminalLive.hook.ts:stream.next',message:'Event received',data:{eventType:event.type,isMessageEvent:isLiveChannelMessageEvent(event),isStatusEvent:isLiveChannelStatusEvent(event)},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'B'})}).catch(()=>{});
          // #endregion
          // Handle message events (data from backend)
          if (isLiveChannelMessageEvent(event)) {
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/0beec42b-59e6-44c2-822f-27c155a5c0e5',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useTerminalLive.hook.ts:stream.next',message:'Message event confirmed',data:{messageType:typeof event.message,messageKeys:event.message ? Object.keys(event.message) : []},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'E'})}).catch(()=>{});
            // #endregion
            const msg = parseTerminalOutput(event.message);
            if (msg) {
              switch (msg.type) {
                case 'output':
                  if (msg.data) {
                    terminal.write(msg.data);
                  }
                  break;

                case 'error':
                  terminal.writeln('\r\n');
                  terminal.writeln(`\x1b[31m✖ Error: ${msg.error}\x1b[0m`);
                  setError(msg.error || 'Unknown error');
                  break;

                case 'connected':
                  setStatus('connected');
                  // Clear provisioning messages and show SSH-style welcome
                  terminal.writeln('');
                  terminal.writeln('\x1b[32m✓ SSH connection established\x1b[0m');
                  terminal.writeln('');
                  terminal.writeln('\x1b[36m┌──────────────────────────────────────────────────────────────┐\x1b[0m');
                  terminal.writeln('\x1b[36m│\x1b[0m  \x1b[1;33mGrafana Pathfinder Sandbox\x1b[0m                                 \x1b[36m│\x1b[0m');
                  terminal.writeln('\x1b[36m│\x1b[0m                                                              \x1b[36m│\x1b[0m');
                  terminal.writeln('\x1b[36m│\x1b[0m  \x1b[90mThis is a temporary sandbox VM for learning Grafana.\x1b[0m       \x1b[36m│\x1b[0m');
                  terminal.writeln('\x1b[36m│\x1b[0m  \x1b[90mVM will auto-terminate after inactivity.\x1b[0m                   \x1b[36m│\x1b[0m');
                  terminal.writeln('\x1b[36m└──────────────────────────────────────────────────────────────┘\x1b[0m');
                  terminal.writeln('');

                  // NOW set up the terminal input handler - only after SSH is connected
                  // This prevents "No active session" errors from race conditions
                  if (inputDisposerRef.current) {
                    inputDisposerRef.current.dispose();
                  }
                  inputDisposerRef.current = terminal.onData((inputData) => {
                    if (currentVmIdRef.current) {
                      sendInput(currentVmIdRef.current, inputData);
                    }
                  });

                  // Send initial resize so the shell prompt appears correctly
                  sendResize(id, terminal.rows, terminal.cols);
                  break;

                case 'disconnected':
                  setStatus('disconnected');
                  terminal.writeln('\r\n');
                  terminal.writeln('\x1b[33m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m');
                  terminal.writeln('\x1b[33m  Session ended - VM disconnected\x1b[0m');
                  terminal.writeln('\x1b[33m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m');
                  break;
              }
            }
          }

          // Handle status events (connection state changes)
          if (isLiveChannelStatusEvent(event)) {
            if (event.state === LiveChannelConnectionState.Connected) {
              terminal.writeln('\x1b[90m       Waiting for SSH handshake...\x1b[0m');
            } else if (event.state === LiveChannelConnectionState.Disconnected) {
              if (status === 'connected') {
                setStatus('disconnected');
                terminal.writeln('\r\n\x1b[33m⚠ Connection lost\x1b[0m');
              }
            }
          }
        },
        error: (err) => {
          console.error('Live stream error:', err);
          setError('Stream connection failed');
          setStatus('error');
          terminal.writeln(`\r\n\x1b[31mStream error: ${err?.message || 'Unknown error'}\x1b[0m`);
        },
        complete: () => {
          if (status === 'connected') {
            setStatus('disconnected');
            terminal.writeln('\r\n\x1b[33mStream ended\x1b[0m');
          }
        },
      });

      // Note: Input handler is set up when 'connected' message is received
      // This avoids race conditions where input is sent before SSH session is ready
    },
    [status, parseTerminalOutput, sendInput, sendResize]
  );

  /**
   * Connect to the terminal
   */
  const connect = useCallback(async () => {
    const terminal = terminalRef.current;
    if (!terminal) {
      setError('Terminal instance not available');
      return;
    }

    setStatus('connecting');
    setError(null);
    cleanup();

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
        terminal.writeln('\x1b[33m⏳ Reconnecting to existing VM...\x1b[0m');
        terminal.writeln(`\x1b[90m   ├─ Checking VM status: \x1b[37m${currentVmId}\x1b[0m`);
        try {
          const existingVm = await getVM(currentVmId);
          if (existingVm.state === 'active') {
            terminal.writeln('\x1b[90m   ├─ VM still active\x1b[0m');
          } else if (existingVm.state === 'error') {
            terminal.writeln(`\x1b[90m   ├─ VM in error state, provisioning new one...\x1b[0m`);
            currentVmId = null;
            setVmId(null);
          } else {
            // VM exists but not active yet - wait for it
            terminal.writeln(`\x1b[90m   ├─ VM state: ${existingVm.state}, waiting...\x1b[0m`);
          }
        } catch {
          // VM doesn't exist anymore, provision a new one
          terminal.writeln('\x1b[90m   ├─ VM no longer exists, provisioning new one...\x1b[0m');
          currentVmId = null;
          setVmId(null);
        }
      }

      // Create VM if we don't have one
      if (!currentVmId) {
        terminal.writeln('\x1b[33m⏳ Provisioning sandbox VM...\x1b[0m');
        terminal.writeln('\x1b[90m   ├─ Requesting VM from pool...\x1b[0m');
        const vm = await createVM();
        currentVmId = vm.id;
        setVmId(currentVmId);
        terminal.writeln(`\x1b[90m   ├─ VM allocated: \x1b[37m${vm.id}\x1b[0m`);

        // Wait for VM to be active (only for new VMs)
        terminal.writeln('\x1b[90m   ├─ Waiting for VM to boot...\x1b[0m');
        await waitForVM(currentVmId, terminal);
      }

      terminal.writeln('\x1b[90m   ├─ VM ready\x1b[0m');

      // Connect to Grafana Live stream
      terminal.writeln('\x1b[90m   └─ Establishing SSH connection...\x1b[0m');
      connectLiveStream(currentVmId, terminal);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Connection failed';
      terminal.writeln('');
      terminal.writeln('\x1b[31m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m');
      terminal.writeln(`\x1b[31m  ✖ Connection failed: ${errorMessage}\x1b[0m`);
      terminal.writeln('\x1b[31m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m');
      terminal.writeln('');
      terminal.writeln('\x1b[90m  Press "Connect" to try again.\x1b[0m');
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
