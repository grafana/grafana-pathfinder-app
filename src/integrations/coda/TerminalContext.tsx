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
import { getBackendSrv } from '@grafana/runtime';
import type { ConnectionStatus } from './useTerminalLive.hook';

const PLUGIN_ID = 'grafana-pathfinder-app';

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
  vmId: string | null;
  connect: () => void;
  disconnect: () => void;
  /** Send a command string to the terminal (appends newline to execute) */
  sendCommand: (command: string) => Promise<void>;
  /** Expand the terminal panel and connect if not already connected */
  openTerminal: () => void;
  /** Whether the terminal panel is expanded */
  isExpanded: boolean;
  /** Set terminal panel expanded state */
  setIsExpanded: (expanded: boolean) => void;
  /** Register the underlying useTerminalLive hook values */
  _register: (opts: {
    status: ConnectionStatus;
    connect: () => void;
    disconnect: () => void;
    vmId: string | null;
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
  const [registeredVmId, setRegisteredVmId] = useState<string | null>(null);
  const registeredConnectRef = useRef<(() => void) | null>(null);
  const registeredDisconnectRef = useRef<(() => void) | null>(null);

  // Sync module-level status whenever it changes
  useEffect(() => {
    _moduleTerminalStatus = registeredStatus;
  }, [registeredStatus]);

  const register = useCallback(
    (opts: { status: ConnectionStatus; connect: () => void; disconnect: () => void; vmId: string | null }) => {
      setRegisteredStatus(opts.status);
      setRegisteredVmId(opts.vmId);
      registeredConnectRef.current = opts.connect;
      registeredDisconnectRef.current = opts.disconnect;
    },
    []
  );

  const connect = useCallback(() => {
    registeredConnectRef.current?.();
  }, []);

  const disconnect = useCallback(() => {
    registeredDisconnectRef.current?.();
  }, []);

  // REACT: ref tracks latest vmId so async sendCommand avoids stale closures (R2)
  const vmIdRef = useRef(registeredVmId);
  useEffect(() => {
    vmIdRef.current = registeredVmId;
  }, [registeredVmId]);

  const sendCommand = useCallback(async (command: string) => {
    const vmId = vmIdRef.current;
    if (!vmId) {
      console.warn('[TerminalContext] Cannot send command: no active VM');
      return;
    }
    try {
      await getBackendSrv().post(`/api/plugins/${PLUGIN_ID}/resources/terminal/${vmId}`, {
        type: 'input',
        data: command + '\n',
      });
    } catch (err) {
      console.error('[TerminalContext] Failed to send command:', err);
    }
  }, []);

  const openTerminal = useCallback(() => {
    setIsExpanded(true);
    if (registeredStatus === 'disconnected' || registeredStatus === 'error') {
      // Small delay to ensure panel mounts before connect
      setTimeout(() => {
        registeredConnectRef.current?.();
      }, 100);
    }
  }, [registeredStatus]);

  const value: TerminalContextValue = {
    status: registeredStatus,
    vmId: registeredVmId,
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
