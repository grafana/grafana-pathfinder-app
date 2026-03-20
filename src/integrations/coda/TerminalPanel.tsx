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
import { useStyles2, Spinner, Icon, IconButton, Button, Input } from '@grafana/ui';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SerializeAddon } from '@xterm/addon-serialize';
import { SearchAddon } from '@xterm/addon-search';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';

import { useTerminalLive, ConnectionStatus } from './useTerminalLive.hook';
import { useTerminalContext } from './TerminalContext';
import { getTerminalPanelStyles } from './terminal-panel.styles';
import {
  setTerminalOpen,
  getTerminalHeight,
  setTerminalHeight,
  MIN_HEIGHT,
  MAX_HEIGHT,
  getWasConnected,
  setWasConnected,
  getScrollback,
  setScrollback,
  clearScrollback,
  getLastVmOpts,
} from './terminal-storage';

interface TerminalPanelProps {
  /** Callback when panel is closed via X button */
  onClose?: () => void;
}

export function TerminalPanel({ onClose }: TerminalPanelProps) {
  const styles = useStyles2(getTerminalPanelStyles);
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalInstanceRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const serializeAddonRef = useRef<SerializeAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const webglAddonRef = useRef<WebglAddon | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const autoReconnectAttemptedRef = useRef(false);

  // UI state - default to collapsed to save vertical space
  // User preference is saved when they collapse/expand
  const [isExpanded, setIsExpanded] = useState(false);
  const [height, setHeight] = useState(() => getTerminalHeight());
  const [isResizing, setIsResizing] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Grafana Live connection - pass ref, not current value (React hooks/refs rule)
  const { status, connect, disconnect, resize, sendCommand, error } = useTerminalLive({
    terminalRef: terminalInstanceRef,
  });

  // Register with shared context so TerminalStep components can send commands
  const terminalCtx = useTerminalContext();
  useEffect(() => {
    terminalCtx?._register({ status, connect, disconnect, sendCommand });
  }, [terminalCtx, status, connect, disconnect, sendCommand]);

  // Sync: when something calls context.openTerminal, the context sets its
  // isExpanded flag. Mirror that into the panel's local state so we actually
  // show the expanded terminal.
  useEffect(() => {
    if (terminalCtx?.isExpanded && !isExpanded) {
      setIsExpanded(true);
      setTerminalOpen(true);
    }
  }, [terminalCtx?.isExpanded, isExpanded]);

  // Track connection state for auto-reconnect.
  // Only set wasConnected(true) on successful connection. Clear it on error
  // only during the initial connect attempt (autoReconnectAttemptedRef gates
  // this) — NOT when an established session hits a transient error — so that
  // page refresh still triggers auto-reconnect for a VM that was working.
  const everConnectedRef = useRef(false);
  useEffect(() => {
    if (status === 'connected') {
      everConnectedRef.current = true;
      setWasConnected(true);
    } else if (status === 'error' && !everConnectedRef.current) {
      setWasConnected(false);
    }
  }, [status]);

  // Auto-reconnect on mount if user was previously connected (page refresh).
  // Restores the previous VM template/app/scenario so the correct VM type is used.
  // Routes through context so activeVmOptsRef stays in sync.
  useEffect(() => {
    const wasConn = getWasConnected();
    const hasTerminal = !!terminalInstanceRef.current;
    const alreadyAttempted = autoReconnectAttemptedRef.current;
    const savedOpts = getLastVmOpts();
    if (!alreadyAttempted && wasConn && hasTerminal && status === 'disconnected') {
      autoReconnectAttemptedRef.current = true;
      const timer = setTimeout(() => {
        if (terminalCtx) {
          terminalCtx.connect(savedOpts);
        } else {
          connect(savedOpts);
        }
      }, 100);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [connect, status, terminalCtx]);

  // Initialize terminal once on mount - keep alive across collapse/expand
  useEffect(() => {
    // Only initialize once when DOM element exists
    if (!terminalRef.current || terminalInstanceRef.current) {
      return;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace',
      allowProposedApi: true,
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

    // Core addons
    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    const serializeAddon = new SerializeAddon();
    const searchAddon = new SearchAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);
    terminal.loadAddon(serializeAddon);
    terminal.loadAddon(searchAddon);
    terminal.open(terminalRef.current);

    // WebGL addon for GPU-accelerated rendering (with fallback)
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        webglAddon.dispose();
        webglAddonRef.current = null;
      });
      terminal.loadAddon(webglAddon);
      webglAddonRef.current = webglAddon;
    } catch {
      // WebGL not available, falls back to canvas renderer
    }

    // Initial fit
    setTimeout(() => {
      fitAddon.fit();
    }, 0);

    terminalInstanceRef.current = terminal;
    fitAddonRef.current = fitAddon;
    serializeAddonRef.current = serializeAddon;
    searchAddonRef.current = searchAddon;

    // Check for saved scrollback and restore if present (after page refresh)
    const savedScrollback = getScrollback();
    if (savedScrollback) {
      terminal.write(savedScrollback);
      terminal.writeln('\r\n\x1b[90m--- Session restored ---\x1b[0m\r\n');
      clearScrollback();
    } else {
      // Welcome message (only shown on fresh start)
      terminal.writeln('\x1b[36m╔════════════════════════════════════════╗\x1b[0m');
      terminal.writeln('\x1b[36m║\x1b[0m        \x1b[1;33mCoda Terminal\x1b[0m                 \x1b[36m║\x1b[0m');
      terminal.writeln('\x1b[36m╚════════════════════════════════════════╝\x1b[0m');
      terminal.writeln('');
      terminal.writeln('\x1b[90mClick "Connect" to start your session...\x1b[0m');
      terminal.writeln('');
    }

    // REACT: cleanup terminal on unmount only (R1)
    return () => {
      // Save scrollback before unmounting if connected
      if (serializeAddonRef.current) {
        try {
          const serialized = serializeAddonRef.current.serialize();
          setScrollback(serialized);
        } catch {
          // Ignore serialization errors
        }
      }
      terminal.dispose();
      terminalInstanceRef.current = null;
      fitAddonRef.current = null;
      serializeAddonRef.current = null;
      searchAddonRef.current = null;
      if (webglAddonRef.current) {
        webglAddonRef.current.dispose();
        webglAddonRef.current = null;
      }
    };
  }, []);

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

  // Fit terminal when expanded or height changes (but not on status changes,
  // since the connected handler already sends an initial resize)
  useEffect(() => {
    if (isExpanded) {
      // Small delay to ensure DOM has updated
      const timer = setTimeout(handleFit, 50);
      return () => clearTimeout(timer);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately excluding handleFit to avoid re-triggering on status changes
  }, [isExpanded, height]);

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
      // REACT: track current height to avoid stale closure in handleMouseUp (R2)
      let currentHeight = startHeight;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        // Dragging up increases height, dragging down decreases
        const deltaY = startY - moveEvent.clientY;
        const newHeight = Math.min(Math.max(startHeight + deltaY, MIN_HEIGHT), MAX_HEIGHT);
        currentHeight = newHeight;
        setHeight(newHeight);
      };

      const handleMouseUp = () => {
        setIsResizing(false);
        // REACT: use tracked value instead of stale closure (R2)
        setTerminalHeight(currentHeight);
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [height]
  );

  // Toggle expand/collapse - keep connection alive when collapsed
  const handleToggleExpand = useCallback(() => {
    const newExpanded = !isExpanded;
    setIsExpanded(newExpanded);
    setTerminalOpen(newExpanded);
    terminalCtx?.setIsExpanded(newExpanded);
  }, [isExpanded, terminalCtx]);

  // Connect handler — restores the last VM template/app/scenario so the
  // panel's Connect button reconnects to the same VM type the user had.
  // Routes through the context so activeVmOptsRef and storage stay in sync.
  const handleConnect = useCallback(() => {
    if (!terminalInstanceRef.current) {
      console.warn('[CodaTerminal] Terminal not initialized yet');
      return;
    }
    const savedOpts = getLastVmOpts();
    if (terminalCtx) {
      terminalCtx.connect(savedOpts);
    } else {
      connect(savedOpts);
    }
  }, [connect, terminalCtx]);

  // Disconnect handler — routes through context so pending reconnect timers
  // are cancelled, matching how handleConnect routes through context.
  const handleDisconnect = useCallback(() => {
    setWasConnected(false);
    everConnectedRef.current = false;
    clearScrollback();
    if (terminalInstanceRef.current) {
      terminalInstanceRef.current.writeln('\r\n\x1b[31mDisconnected.\x1b[0m');
    }
    if (terminalCtx) {
      terminalCtx.disconnect();
    } else {
      disconnect();
    }
  }, [disconnect, terminalCtx]);

  // Search handlers
  const handleSearchToggle = useCallback(() => {
    setShowSearch((prev) => !prev);
    if (showSearch) {
      setSearchQuery('');
    }
  }, [showSearch]);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  }, []);

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!searchAddonRef.current) {
        return;
      }
      if (e.key === 'Enter') {
        if (e.shiftKey) {
          searchAddonRef.current.findPrevious(searchQuery);
        } else {
          searchAddonRef.current.findNext(searchQuery);
        }
      } else if (e.key === 'Escape') {
        setShowSearch(false);
        setSearchQuery('');
      }
    },
    [searchQuery]
  );

  const handleSearchNext = useCallback(() => {
    searchAddonRef.current?.findNext(searchQuery);
  }, [searchQuery]);

  const handleSearchPrev = useCallback(() => {
    searchAddonRef.current?.findPrevious(searchQuery);
  }, [searchQuery]);

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
  const canCancel = isConnecting;

  // Always render terminal div to keep it alive across collapse/expand
  // Use display:none to hide when collapsed instead of unmounting
  return (
    <>
      {/* Collapsed view - clickable bar to expand */}
      {!isExpanded && (
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
      )}

      {/* Expanded view - full terminal panel */}
      <div
        className={`${styles.container} ${styles.expanded}`}
        ref={containerRef}
        style={{
          height: `${height}px`,
          // Hide when collapsed but keep in DOM to preserve terminal instance
          display: isExpanded ? 'flex' : 'none',
        }}
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

            {canCancel && (
              <Button size="sm" variant="secondary" onClick={handleDisconnect} className={styles.headerButton}>
                Cancel
              </Button>
            )}

            {canDisconnect && (
              <Button size="sm" variant="destructive" onClick={handleDisconnect} className={styles.headerButton}>
                Disconnect
              </Button>
            )}

            <IconButton
              name="search"
              size="sm"
              aria-label="Search"
              tooltip="Search in terminal (Ctrl+F)"
              onClick={handleSearchToggle}
            />

            <IconButton
              name="angle-down"
              size="sm"
              aria-label="Collapse"
              tooltip="Collapse terminal"
              onClick={handleToggleExpand}
            />

            {onClose && (
              <IconButton
                name="times"
                size="sm"
                aria-label="Close terminal"
                tooltip="Close terminal"
                onClick={onClose}
              />
            )}
          </div>
        </div>

        {/* Search bar */}
        {showSearch && (
          <div className={styles.searchBar}>
            <Input
              value={searchQuery}
              onChange={handleSearchChange}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search... (Enter=next, Shift+Enter=prev, Esc=close)"
              autoFocus
              width={30}
            />
            <IconButton
              name="arrow-up"
              size="sm"
              aria-label="Previous"
              tooltip="Previous match"
              onClick={handleSearchPrev}
            />
            <IconButton name="arrow-down" size="sm" aria-label="Next" tooltip="Next match" onClick={handleSearchNext} />
            <IconButton name="times" size="sm" aria-label="Close search" tooltip="Close" onClick={handleSearchToggle} />
          </div>
        )}

        {/* Terminal - always mounted to preserve connection */}
        <div className={styles.terminalWrapper} ref={terminalRef} />
      </div>
    </>
  );
}

export default TerminalPanel;
