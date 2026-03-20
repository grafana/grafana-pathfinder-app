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
import type { ConnectionStatus, TerminalVMOptions } from './useTerminalLive.hook';
import { setLastVmOpts } from './terminal-storage';

export type { TerminalVMOptions };

// Module-level status for requirement checker access (outside React tree)
let _moduleTerminalStatus: ConnectionStatus = 'disconnected';

/**
 * Read terminal connection status from outside React (for requirement checkers).
 */
export function getTerminalConnectionStatus(): ConnectionStatus {
  return _moduleTerminalStatus;
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

  // Store registered hook values from TerminalPanel
  const [registeredStatus, setRegisteredStatus] = useState<ConnectionStatus>('disconnected');
  const registeredConnectRef = useRef<((vmOpts?: TerminalVMOptions) => void) | null>(null);
  const registeredDisconnectRef = useRef<(() => void) | null>(null);
  const registeredSendCommandRef = useRef<((command: string) => Promise<void>) | null>(null);

  // Track VM options for the active session so openTerminal can skip redundant reconnects
  const activeVmOptsRef = useRef<TerminalVMOptions | undefined>(undefined);

  // Guard flag: true while openTerminal is executing a disconnect→reconnect cycle.
  // Prevents the register callback from clearing activeVmOptsRef during the brief
  // 'disconnected' status that occurs between the old session teardown and the new connect.
  const reconnectingRef = useRef(false);

  // Pending reconnect timer — stored so disconnect() can cancel it
  const pendingConnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

      // When a disconnect/error originates outside openTerminal (e.g. panel button,
      // network drop, VM expiry), clear stale VM options so subsequent openTerminal
      // calls correctly detect that a reconnect is needed.
      if ((opts.status === 'disconnected' || opts.status === 'error') && !reconnectingRef.current) {
        activeVmOptsRef.current = undefined;
      }
    },
    []
  );

  const connect = useCallback((vmOpts?: TerminalVMOptions) => {
    activeVmOptsRef.current = vmOpts;
    setLastVmOpts(vmOpts);
    registeredConnectRef.current?.(vmOpts);
  }, []);

  const disconnect = useCallback(() => {
    if (pendingConnectTimerRef.current) {
      clearTimeout(pendingConnectTimerRef.current);
      pendingConnectTimerRef.current = null;
    }
    reconnectingRef.current = false;
    activeVmOptsRef.current = undefined;
    // Keep lastVmOpts in storage so the Connect button and auto-reconnect
    // can restore the same VM type. Only openTerminal with different opts
    // (or an explicit storage clear) should overwrite the persisted value.
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

      const requestedTemplate = vmOpts?.template || '';
      const requestedApp = vmOpts?.app || '';
      const requestedScenario = vmOpts?.scenario || '';
      const activeTemplate = activeVmOptsRef.current?.template || '';
      const activeApp = activeVmOptsRef.current?.app || '';
      const activeScenario = activeVmOptsRef.current?.scenario || '';
      const needsReconnect =
        !needsConnect &&
        (requestedTemplate !== activeTemplate || requestedApp !== activeApp || requestedScenario !== activeScenario);

      if (needsReconnect) {
        reconnectingRef.current = true;
        registeredDisconnectRef.current?.();
      }

      if (needsConnect || needsReconnect) {
        activeVmOptsRef.current = vmOpts;
        setLastVmOpts(vmOpts);
        pendingConnectTimerRef.current = setTimeout(() => {
          pendingConnectTimerRef.current = null;
          reconnectingRef.current = false;
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
