/**
 * Coda Terminal Panel
 *
 * A collapsible, vertically-resizable terminal panel for the sidebar.
 * Provides an interactive sandbox environment for running commands
 * while following tutorials.
 *
 * This is an experimental feature gated behind dev mode.
 */

import React, { useEffect, useRef, useCallback, useState } from 'react';
import { useStyles2, Spinner, Icon, IconButton, Button } from '@grafana/ui';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

import { useTerminalLive, ConnectionStatus } from './useTerminalLive.hook';
import { getTerminalPanelStyles } from './terminal-panel.styles';
import { setTerminalOpen, getTerminalHeight, setTerminalHeight, MIN_HEIGHT, MAX_HEIGHT } from './terminal-storage';

interface TerminalPanelProps {
  /** Callback when panel is closed via X button */
  onClose?: () => void;
}

export function TerminalPanel({ onClose }: TerminalPanelProps) {
  const styles = useStyles2(getTerminalPanelStyles);
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalInstanceRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // UI state - default to expanded so terminal initializes on first render
  // User preference is saved when they collapse/expand
  const [isExpanded, setIsExpanded] = useState(true);
  const [height, setHeight] = useState(() => getTerminalHeight());
  const [isResizing, setIsResizing] = useState(false);

  // Session state (stubbed - no backend yet)
  const [sessionId] = useState<string | null>(null);

  // Grafana Live connection - pass ref, not current value (React hooks/refs rule)
  const { status, connect, disconnect, resize, error } = useTerminalLive({
    sessionId,
    terminalRef: terminalInstanceRef,
  });

  // Initialize terminal when expanded (terminal div must be mounted first)
  useEffect(() => {
    // Only initialize when expanded and DOM element exists
    if (!isExpanded || !terminalRef.current || terminalInstanceRef.current) {
      return;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace',
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
        cursorAccent: '#1e1e1e',
        selectionBackground: '#264f78',
        black: '#1e1e1e',
        red: '#f44747',
        green: '#6a9955',
        yellow: '#dcdcaa',
        blue: '#569cd6',
        magenta: '#c586c0',
        cyan: '#4ec9b0',
        white: '#d4d4d4',
        brightBlack: '#808080',
        brightRed: '#f44747',
        brightGreen: '#6a9955',
        brightYellow: '#dcdcaa',
        brightBlue: '#569cd6',
        brightMagenta: '#c586c0',
        brightCyan: '#4ec9b0',
        brightWhite: '#ffffff',
      },
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);
    terminal.open(terminalRef.current);

    // Initial fit
    setTimeout(() => {
      fitAddon.fit();
    }, 0);

    terminalInstanceRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Welcome message
    terminal.writeln('\x1b[36m╔════════════════════════════════════════╗\x1b[0m');
    terminal.writeln('\x1b[36m║\x1b[0m        \x1b[1;33mCoda Terminal\x1b[0m                 \x1b[36m║\x1b[0m');
    terminal.writeln('\x1b[36m╚════════════════════════════════════════╝\x1b[0m');
    terminal.writeln('');
    terminal.writeln('\x1b[90mClick "Connect" to start your session...\x1b[0m');
    terminal.writeln('');

    // REACT: cleanup terminal on unmount (R1)
    return () => {
      // Disconnect to reset connection state when terminal is disposed
      disconnect();
      terminal.dispose();
      terminalInstanceRef.current = null;
      fitAddonRef.current = null;
    };
  }, [isExpanded, disconnect]);

  // Handle resize when expanded/height changes
  const handleFit = useCallback(() => {
    if (fitAddonRef.current && isExpanded) {
      fitAddonRef.current.fit();
      // Send resize to backend
      if (terminalInstanceRef.current && status === 'connected') {
        const dims = fitAddonRef.current.proposeDimensions();
        if (dims) {
          resize(dims.rows, dims.cols);
        }
      }
    }
  }, [isExpanded, resize, status]);

  // Fit terminal when expanded or height changes
  useEffect(() => {
    if (isExpanded) {
      // Small delay to ensure DOM has updated
      const timer = setTimeout(handleFit, 50);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [isExpanded, height, handleFit]);

  // Handle window resize
  useEffect(() => {
    // REACT: cleanup event listener (R1)
    window.addEventListener('resize', handleFit);
    return () => window.removeEventListener('resize', handleFit);
  }, [handleFit]);

  // Resize drag handling
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizing(true);

      const startY = e.clientY;
      const startHeight = height;
      // Track the current height during resize to avoid stale closure in handleMouseUp
      let currentHeight = height;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        // Dragging up increases height, dragging down decreases
        const deltaY = startY - moveEvent.clientY;
        const newHeight = Math.min(Math.max(startHeight + deltaY, MIN_HEIGHT), MAX_HEIGHT);
        currentHeight = newHeight;
        setHeight(newHeight);
      };

      const handleMouseUp = () => {
        setIsResizing(false);
        setTerminalHeight(currentHeight);
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [height]
  );

  // Toggle expand/collapse
  const handleToggleExpand = useCallback(() => {
    const newExpanded = !isExpanded;
    setIsExpanded(newExpanded);
    setTerminalOpen(newExpanded);
  }, [isExpanded]);

  // Connect handler
  const handleConnect = useCallback(() => {
    if (!terminalInstanceRef.current) {
      console.warn('[CodaTerminal] Terminal not initialized yet');
      return;
    }
    connect();
  }, [connect]);

  // Disconnect handler
  const handleDisconnect = useCallback(() => {
    if (terminalInstanceRef.current) {
      terminalInstanceRef.current.writeln('\r\n\x1b[31mDisconnected.\x1b[0m');
    }
    disconnect();
  }, [disconnect]);

  // Status helpers
  const getStatusDotClass = (s: ConnectionStatus) => {
    switch (s) {
      case 'connected':
        return styles.statusConnected;
      case 'connecting':
        return styles.statusConnecting;
      case 'error':
        return styles.statusError;
      default:
        return styles.statusDisconnected;
    }
  };

  const getStatusText = (s: ConnectionStatus) => {
    switch (s) {
      case 'connected':
        return 'Connected';
      case 'connecting':
        return 'Connecting...';
      case 'error':
        return error || 'Error';
      default:
        return 'Disconnected';
    }
  };

  const isConnecting = status === 'connecting';
  const canConnect = !isConnecting && status !== 'connected';
  const canDisconnect = status === 'connected';

  // Collapsed view
  if (!isExpanded) {
    return (
      <div className={`${styles.container} ${styles.collapsed}`} ref={containerRef}>
        <div
          className={styles.collapsedBar}
          onClick={handleToggleExpand}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              handleToggleExpand();
            }
          }}
          aria-expanded={false}
          aria-label="Expand terminal panel"
        >
          <div className={styles.headerLeft}>
            <Icon name="code-branch" size="sm" />
            <span className={styles.title}>Terminal</span>
          </div>
          <div className={styles.headerRight}>
            <div className={styles.statusIndicator}>
              {isConnecting ? (
                <Spinner size="xs" />
              ) : (
                <div className={`${styles.statusDot} ${getStatusDotClass(status)}`} />
              )}
              <span>{getStatusText(status)}</span>
            </div>
            <IconButton name="angle-up" size="sm" aria-label="Expand" tooltip="Expand terminal" />
          </div>
        </div>
      </div>
    );
  }

  // Expanded view
  return (
    <div
      className={`${styles.container} ${styles.expanded}`}
      ref={containerRef}
      style={{ height: `${height}px` }}
      data-testid="coda-terminal-panel"
    >
      {/* Resize handle */}
      <div
        className={styles.resizeHandle}
        onMouseDown={handleResizeStart}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize terminal panel"
        style={{ cursor: isResizing ? 'ns-resize' : undefined }}
      />

      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <Icon name="code-branch" size="sm" />
          <span className={styles.title}>Terminal</span>
        </div>
        <div className={styles.headerRight}>
          <div className={styles.statusIndicator}>
            {isConnecting ? (
              <Spinner size="xs" />
            ) : (
              <div className={`${styles.statusDot} ${getStatusDotClass(status)}`} />
            )}
            <span>{getStatusText(status)}</span>
          </div>

          {canConnect && (
            <Button size="sm" variant="primary" onClick={handleConnect} className={styles.headerButton}>
              Connect
            </Button>
          )}

          {canDisconnect && (
            <Button size="sm" variant="destructive" onClick={handleDisconnect} className={styles.headerButton}>
              Disconnect
            </Button>
          )}

          <IconButton
            name="angle-down"
            size="sm"
            aria-label="Collapse"
            tooltip="Collapse terminal"
            onClick={handleToggleExpand}
          />

          {onClose && (
            <IconButton name="times" size="sm" aria-label="Close terminal" tooltip="Close terminal" onClick={onClose} />
          )}
        </div>
      </div>

      {/* Terminal */}
      <div className={styles.terminalWrapper} ref={terminalRef} />
    </div>
  );
}

export default TerminalPanel;
