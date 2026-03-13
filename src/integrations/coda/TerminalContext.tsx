/**
 * Terminal Context
 *
 * Shared React context for terminal connection state and actions.
 * Allows both TerminalPanel and TerminalStep components to share
 * the same connection without duplicating useTerminalLive calls.
 *
 * Also exposes a module-level getter (getTerminalConnectionStatus) for
 * the requirement checker system, which runs outside React context.
 */

import React, { createContext, useContext, useCallback, useRef, useState, useEffect } from 'react';
import type { ConnectionStatus } from './useTerminalLive.hook';

// Module-level status for requirement checker access (outside React tree)
let _moduleTerminalStatus: ConnectionStatus = 'disconnected';

/**
 * Read terminal connection status from outside React (for requirement checkers).
 */
export function getTerminalConnectionStatus(): ConnectionStatus {
  return _moduleTerminalStatus;
}

/** Options for connecting to a specific VM template */
export interface TerminalVMOptions {
  /** VM template (defaults to "vm-aws") */
  template?: string;
  /** App name for sample-app templates */
  app?: string;
}

export interface TerminalContextValue {
  status: ConnectionStatus;
  connect: (vmOpts?: TerminalVMOptions) => void;
  disconnect: () => void;
  /** Send a command string to the terminal (appends newline to execute) */
  sendCommand: (command: string) => Promise<void>;
  /** Expand the terminal panel and connect if not already connected */
  openTerminal: (vmOpts?: TerminalVMOptions) => void;
  /** Whether the terminal panel is expanded */
  isExpanded: boolean;
  /** Set terminal panel expanded state */
  setIsExpanded: (expanded: boolean) => void;
  /** Register the underlying useTerminalLive hook values */
  _register: (opts: {
    status: ConnectionStatus;
    connect: (vmOpts?: TerminalVMOptions) => void;
    disconnect: () => void;
    sendCommand: (command: string) => Promise<void>;
  }) => void;
}

const TerminalContext = createContext<TerminalContextValue | null>(null);

/**
 * Hook to access terminal context. Returns null if not within a TerminalProvider
 * (e.g., when terminal feature is disabled).
 */
export function useTerminalContext(): TerminalContextValue | null {
  return useContext(TerminalContext);
}

interface TerminalProviderProps {
  children: React.ReactNode;
}

export function TerminalProvider({ children }: TerminalProviderProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const activeVMOptsRef = useRef<TerminalVMOptions>({});

  // Store registered hook values from TerminalPanel
  const [registeredStatus, setRegisteredStatus] = useState<ConnectionStatus>('disconnected');
  const registeredConnectRef = useRef<((vmOpts?: TerminalVMOptions) => void) | null>(null);
  const registeredDisconnectRef = useRef<(() => void) | null>(null);
  const registeredSendCommandRef = useRef<((command: string) => Promise<void>) | null>(null);

  // Sync module-level status whenever it changes
  useEffect(() => {
    _moduleTerminalStatus = registeredStatus;
  }, [registeredStatus]);

  const register = useCallback(
    (opts: {
      status: ConnectionStatus;
      connect: (vmOpts?: TerminalVMOptions) => void;
      disconnect: () => void;
      sendCommand: (command: string) => Promise<void>;
    }) => {
      setRegisteredStatus(opts.status);
      registeredConnectRef.current = opts.connect;
      registeredDisconnectRef.current = opts.disconnect;
      registeredSendCommandRef.current = opts.sendCommand;
    },
    []
  );

  const connect = useCallback((vmOpts?: TerminalVMOptions) => {
    activeVMOptsRef.current = vmOpts ?? {};
    registeredConnectRef.current?.(vmOpts);
  }, []);

  const disconnect = useCallback(() => {
    activeVMOptsRef.current = {};
    registeredDisconnectRef.current?.();
  }, []);

  const sendCommand = useCallback(async (command: string) => {
    if (!registeredSendCommandRef.current) {
      console.warn('[TerminalContext] Cannot send command: terminal not registered');
      return;
    }
    await registeredSendCommandRef.current(command);
  }, []);

  const openTerminal = useCallback(
    (vmOpts?: TerminalVMOptions) => {
      setIsExpanded(true);

      const needsConnect = registeredStatus === 'disconnected' || registeredStatus === 'error';
      const hasRequestedVMOpts = Boolean(vmOpts?.template || vmOpts?.app);
      const requestedTemplate = vmOpts?.template ?? 'vm-aws';
      const requestedApp = vmOpts?.app ?? '';
      const activeTemplate = activeVMOptsRef.current.template ?? 'vm-aws';
      const activeApp = activeVMOptsRef.current.app ?? '';
      const templateChanged = requestedTemplate !== activeTemplate;
      const appChanged = requestedApp !== '' && requestedApp !== activeApp;
      const needsReconnect = !needsConnect && hasRequestedVMOpts && (templateChanged || appChanged);

      if (needsReconnect) {
        activeVMOptsRef.current = {};
        registeredDisconnectRef.current?.();
      }

      if (needsConnect || needsReconnect) {
        setTimeout(() => {
          activeVMOptsRef.current = vmOpts ?? {};
          registeredConnectRef.current?.(vmOpts);
        }, 100);
      }
    },
    [registeredStatus]
  );

  const value: TerminalContextValue = {
    status: registeredStatus,
    connect,
    disconnect,
    sendCommand,
    openTerminal,
    isExpanded,
    setIsExpanded,
    _register: register,
  };

  return <TerminalContext.Provider value={value}>{children}</TerminalContext.Provider>;
}
