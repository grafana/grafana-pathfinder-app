/**
 * Grafana Live terminal connection hook (stubbed)
 *
 * This hook provides the interface for connecting to a terminal backend
 * via Grafana Live. Currently stubbed for frontend-only development.
 *
 * Future backend integration will use Grafana Live channels for
 * bidirectional terminal I/O.
 */

import { useCallback, useEffect, useRef, useState, RefObject } from 'react';
import type { Terminal } from '@xterm/xterm';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

interface UseTerminalLiveOptions {
  /** Session ID from the provision endpoint (future use) */
  sessionId: string | null;
  /** Terminal instance ref - accessed in callbacks, not during render */
  terminalRef: RefObject<Terminal | null>;
}

// Fake command responses for demo mode
const FAKE_COMMANDS: Record<string, string | ((args: string) => string)> = {
  help: `Available commands:
  help          Show this help message
  whoami        Display current user
  pwd           Print working directory
  ls            List directory contents
  cat           Display file contents
  echo          Print arguments
  date          Show current date/time
  clear         Clear the terminal
  grafana       Show Grafana info
  alloy         Show Alloy config example
  curl          Fake HTTP request
  exit          Disconnect from terminal
`,
  whoami: 'grafana-sandbox-user',
  pwd: '/home/grafana-sandbox',
  ls: `total 24
drwxr-xr-x  2 grafana grafana 4096 Jan 27 10:00 .
drwxr-xr-x  3 root    root    4096 Jan 27 09:55 ..
-rw-r--r--  1 grafana grafana  220 Jan 27 09:55 .bash_logout
-rw-r--r--  1 grafana grafana 3771 Jan 27 09:55 .bashrc
-rw-r--r--  1 grafana grafana  807 Jan 27 09:55 .profile
-rw-r--r--  1 grafana grafana  256 Jan 27 10:00 config.alloy`,
  date: () => new Date().toString(),
  grafana: `Grafana Pathfinder Sandbox
Version: 11.4.0
Environment: Development
Stack: grafana-sandbox

This is a simulated terminal environment for learning Grafana.
Try running: alloy, curl, or ls`,
  alloy: `// Example Alloy configuration
prometheus.scrape "default" {
  targets = [
    {"__address__" = "localhost:9090"},
  ]
  forward_to = [prometheus.remote_write.default.receiver]
}

prometheus.remote_write "default" {
  endpoint {
    url = "https://prometheus.grafana.net/api/prom/push"
  }
}`,
  curl: (args: string) => {
    if (args.includes('prometheus') || args.includes('metrics')) {
      return `# HELP up Target is up
# TYPE up gauge
up{instance="localhost:9090",job="prometheus"} 1
# HELP process_cpu_seconds_total Total user and system CPU time spent in seconds.
# TYPE process_cpu_seconds_total counter
process_cpu_seconds_total 42.31`;
    }
    return `HTTP/1.1 200 OK
Content-Type: application/json

{"status":"ok","message":"Simulated response"}`;
  },
  cat: (args: string) => {
    if (args.includes('config.alloy')) {
      return FAKE_COMMANDS.alloy as string;
    }
    if (args.includes('.bashrc')) {
      return `# ~/.bashrc: executed by bash for non-login shells.
export PS1='\\u@grafana-sandbox:\\w\\$ '
alias ll='ls -la'
alias grafana-logs='tail -f /var/log/grafana/grafana.log'`;
    }
    return `cat: ${args || 'missing operand'}: No such file or directory`;
  },
  echo: (args: string) => args || '',
};

interface UseTerminalLiveReturn {
  /** Current connection status */
  status: ConnectionStatus;
  /** Connect to Grafana Live stream */
  connect: () => void;
  /** Disconnect from stream */
  disconnect: () => void;
  /** Send resize event to backend */
  resize: (rows: number, cols: number) => void;
  /** Error message if status is 'error' */
  error: string | null;
}

/**
 * Stubbed terminal connection hook
 *
 * This provides a mock implementation for frontend development.
 * The real implementation will connect to Grafana Live when
 * the backend is available.
 */
export function useTerminalLive({ sessionId, terminalRef }: UseTerminalLiveOptions): UseTerminalLiveReturn {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const terminalDataDisposer = useRef<{ dispose: () => void } | null>(null);
  const commandBufferRef = useRef<string>('');
  // REACT: store timer IDs to cancel pending connection timeouts (R1)
  const connectionTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  // Helper to clear all pending connection timers
  const clearConnectionTimers = useCallback(() => {
    connectionTimersRef.current.forEach((timerId) => clearTimeout(timerId));
    connectionTimersRef.current = [];
  }, []);

  // REACT: cleanup on unmount (R1)
  useEffect(() => {
    return () => {
      clearConnectionTimers();
      if (terminalDataDisposer.current) {
        terminalDataDisposer.current.dispose();
        terminalDataDisposer.current = null;
      }
    };
  }, [clearConnectionTimers]);

  // Execute a fake command - defined before connect to satisfy React hooks rules
  // Returns true if we should show prompt after, false if command handles it (like exit)
  const executeCommand = useCallback(
    (terminal: Terminal, input: string): boolean => {
      const parts = input.split(/\s+/);
      const cmd = parts[0].toLowerCase();
      const args = parts.slice(1).join(' ');

      // Handle special commands
      if (cmd === 'clear') {
        terminal.clear();
        return true;
      }

      if (cmd === 'exit') {
        terminal.writeln('\x1b[33mDisconnecting from sandbox...\x1b[0m');
        setTimeout(() => {
          const term = terminalRef.current;
          if (term) {
            term.writeln('\x1b[31mConnection closed.\x1b[0m');
          }
          if (terminalDataDisposer.current) {
            terminalDataDisposer.current.dispose();
            terminalDataDisposer.current = null;
          }
          setStatus('disconnected');
        }, 500);
        return false; // Don't show prompt - we're disconnecting
      }

      // Look up command
      const handler = FAKE_COMMANDS[cmd];
      if (handler) {
        const output = typeof handler === 'function' ? handler(args) : handler;
        output.split('\n').forEach((line) => terminal.writeln(line));
      } else if (cmd) {
        terminal.writeln(`\x1b[31mbash: ${cmd}: command not found\x1b[0m`);
        terminal.writeln('\x1b[90mTry "help" to see available commands.\x1b[0m');
      }
      return true;
    },
    [terminalRef]
  );

  const connect = useCallback(() => {
    const terminal = terminalRef.current;
    if (!terminal) {
      setError('Terminal instance not available');
      return;
    }

    setStatus('connecting');
    setError(null);
    commandBufferRef.current = '';

    // Clear any pending timers from previous connection attempts
    clearConnectionTimers();

    // Simulate connection delay with progress
    // REACT: store timer IDs to allow cancellation on disconnect (R1)
    terminal.writeln('\x1b[33mProvisioning sandbox VM...\x1b[0m');

    connectionTimersRef.current.push(
      setTimeout(() => {
        const term = terminalRef.current;
        if (!term) {
          return;
        }
        term.writeln('\x1b[90m  → Allocating resources...\x1b[0m');
      }, 300)
    );

    connectionTimersRef.current.push(
      setTimeout(() => {
        const term = terminalRef.current;
        if (!term) {
          return;
        }
        term.writeln('\x1b[90m  → Starting container...\x1b[0m');
      }, 700)
    );

    connectionTimersRef.current.push(
      setTimeout(() => {
        const term = terminalRef.current;
        if (!term) {
          return;
        }
        term.writeln('\x1b[90m  → Configuring environment...\x1b[0m');
      }, 1100)
    );

    connectionTimersRef.current.push(
      setTimeout(() => {
        const currentTerminal = terminalRef.current;
        if (!currentTerminal) {
          setError('Terminal instance no longer available');
          setStatus('error');
          return;
        }

        setStatus('connected');

        // Write welcome banner
        currentTerminal.writeln('');
        currentTerminal.writeln('\x1b[32m✓ Connected to Grafana Sandbox\x1b[0m');
        currentTerminal.writeln('');
        currentTerminal.writeln('\x1b[36m╔══════════════════════════════════════════════════════════╗\x1b[0m');
        currentTerminal.writeln(
          '\x1b[36m║\x1b[0m  \x1b[1;33mWelcome to Grafana Pathfinder Sandbox\x1b[0m                    \x1b[36m║\x1b[0m'
        );
        currentTerminal.writeln(
          '\x1b[36m║\x1b[0m                                                          \x1b[36m║\x1b[0m'
        );
        currentTerminal.writeln(
          '\x1b[36m║\x1b[0m  \x1b[90mThis is a simulated environment for learning.\x1b[0m           \x1b[36m║\x1b[0m'
        );
        currentTerminal.writeln(
          '\x1b[36m║\x1b[0m  \x1b[90mType \x1b[37mhelp\x1b[90m to see available commands.\x1b[0m                    \x1b[36m║\x1b[0m'
        );
        currentTerminal.writeln('\x1b[36m╚══════════════════════════════════════════════════════════╝\x1b[0m');
        currentTerminal.writeln('');
        currentTerminal.write('\x1b[32mgrafana-sandbox\x1b[0m:\x1b[34m~\x1b[0m$ ');

        // Set up command handler
        // REACT: cleanup subscription (R1)
        if (terminalDataDisposer.current) {
          terminalDataDisposer.current.dispose();
        }

        terminalDataDisposer.current = currentTerminal.onData((data) => {
          const term = terminalRef.current;
          if (!term) {
            return;
          }

          // Handle special keys
          if (data === '\r') {
            // Enter key - execute command
            term.writeln('');
            const command = commandBufferRef.current.trim();
            commandBufferRef.current = '';

            let showPrompt = true;
            if (command) {
              showPrompt = executeCommand(term, command);
            }

            if (showPrompt) {
              term.write('\x1b[32mgrafana-sandbox\x1b[0m:\x1b[34m~\x1b[0m$ ');
            }
          } else if (data === '\x7f') {
            // Backspace
            if (commandBufferRef.current.length > 0) {
              commandBufferRef.current = commandBufferRef.current.slice(0, -1);
              term.write('\b \b');
            }
          } else if (data === '\x03') {
            // Ctrl+C
            commandBufferRef.current = '';
            term.writeln('^C');
            term.write('\x1b[32mgrafana-sandbox\x1b[0m:\x1b[34m~\x1b[0m$ ');
          } else if (data === '\x1b[A' || data === '\x1b[B') {
            // Arrow up/down - ignore for now (history not implemented)
          } else if (data >= ' ' || data === '\t') {
            // Printable characters
            commandBufferRef.current += data;
            term.write(data);
          }
        });
      }, 1500)
    );
  }, [terminalRef, executeCommand, clearConnectionTimers]);

  const disconnect = useCallback(() => {
    // REACT: cancel pending connection timers to prevent stale state updates (R1)
    clearConnectionTimers();
    if (terminalDataDisposer.current) {
      terminalDataDisposer.current.dispose();
      terminalDataDisposer.current = null;
    }
    setStatus('disconnected');
    setError(null);
  }, [clearConnectionTimers]);

  const resize = useCallback(
    (rows: number, cols: number) => {
      // Stub: would send resize event to backend
      if (status === 'connected') {
        console.log('[CodaTerminal] Resize event (stubbed):', { rows, cols });
      }
    },
    [status]
  );

  return {
    status,
    connect,
    disconnect,
    resize,
    error,
  };
}
