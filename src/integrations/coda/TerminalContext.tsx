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
import { TERMINAL_STATUS_CHANGED_EVENT } from '../../lib/event-names';
import type { ConnectionStatus, TerminalVMOptions } from './useTerminalLive.hook';
import { invalidateGcxCredentialForSession } from './gcx-credential-store';
import { setLastVmOpts } from './terminal-storage';
import { logger } from '../../lib/logging';

export type { TerminalVMOptions };

// Module-level status for requirement checker access (outside React tree)
let _moduleTerminalStatus: ConnectionStatus = 'disconnected';
let _moduleTerminalSessionId: string | null = null;

/**
 * Read terminal connection status from outside React (for requirement checkers).
 */
export function getTerminalConnectionStatus(): ConnectionStatus {
  return _moduleTerminalStatus;
}

/**
 * Read the active Coda session id from outside React. Exec calls are
 * session-scoped, and the requirement checker runs outside the React tree.
 *
 * Gated on `connected`: exec reuses the stream's SSH client, so an id read out
 * of a terminal that is not attached can only buy a doomed request.
 */
export function getTerminalSessionId(): string | null {
  return _moduleTerminalStatus === 'connected' ? _moduleTerminalSessionId : null;
}

export interface TerminalContextValue {
  status: ConnectionStatus;
  /** Active Coda session id, or null when disconnected */
  sessionId: string | null;
  /** Last connection error reported by the terminal, or null. */
  error: string | null;
  /**
   * Whether a TerminalPanel has registered itself, so `connect` and
   * `openTerminal` actually reach the Live hook.
   *
   * The provider mounts unconditionally but the panel is gated (dev mode,
   * `enableCodaTerminal`, and the Coda plugin being installed), so a present
   * context is not a working terminal. Callers that would otherwise wait on a
   * connection must check this or they wait forever.
   */
  isTerminalRegistered: boolean;
  connect: (vmOpts?: TerminalVMOptions) => void;
  disconnect: () => void;
  /** Send a command string to the terminal (appends newline to execute) */
  sendCommand: (command: string) => Promise<void>;
  /**
   * Expand the terminal panel and connect if not already connected.
   *
   * Resolves with the session id the caller may then use, or `null` if no
   * session was reached. Awaiting matters when the requested VM differs from
   * the live one: this tears the old session down and provisions a new one, so
   * a caller that reads `sessionId` off the render instead gets the session
   * that is being deleted.
   */
  openTerminal: (vmOpts?: TerminalVMOptions) => Promise<string | null>;
  /** Whether the terminal panel is expanded */
  isExpanded: boolean;
  /** Set terminal panel expanded state */
  setIsExpanded: (expanded: boolean) => void;
  /** Register the underlying useTerminalLive hook values */
  _register: (opts: {
    status: ConnectionStatus;
    sessionId: string | null;
    error: string | null;
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
  const [registeredSessionId, setRegisteredSessionId] = useState<string | null>(null);
  const [registeredError, setRegisteredError] = useState<string | null>(null);
  const [isTerminalRegistered, setIsTerminalRegistered] = useState(false);
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

  // Callers awaiting openTerminal. `leftConnected` records whether the session
  // they were told to stop using has actually gone away yet: a reconnect starts
  // from 'connected', so resolving on the first 'connected' seen would hand back
  // the id of the session being torn down.
  const sessionWaitersRef = useRef<Array<{ resolve: (id: string | null) => void; leftConnected: boolean }>>([]);

  const settleWaiters = useCallback((status: ConnectionStatus, sessionId: string | null) => {
    const waiters = sessionWaitersRef.current;
    if (waiters.length === 0) {
      return;
    }
    if (status !== 'connected') {
      waiters.forEach((waiter) => {
        waiter.leftConnected = true;
      });
    }
    const settled = waiters.filter((waiter) => (status === 'connected' && waiter.leftConnected) || status === 'error');
    if (settled.length === 0) {
      return;
    }
    sessionWaitersRef.current = waiters.filter((waiter) => !settled.includes(waiter));
    settled.forEach((waiter) => waiter.resolve(status === 'connected' ? sessionId : null));
  }, []);

  // Sync module-level status whenever it changes, and tell the requirements
  // checker to look again — it runs outside React and cannot observe this.
  useEffect(() => {
    _moduleTerminalStatus = registeredStatus;
    window.dispatchEvent(new CustomEvent(TERMINAL_STATUS_CHANGED_EVENT, { detail: { status: registeredStatus } }));
  }, [registeredStatus]);

  useEffect(() => {
    _moduleTerminalSessionId = registeredSessionId;
    invalidateGcxCredentialForSession(registeredSessionId);
  }, [registeredSessionId]);

  useEffect(() => {
    return () => {
      const abandoned = sessionWaitersRef.current;
      sessionWaitersRef.current = [];
      abandoned.forEach((waiter) => waiter.resolve(null));
      if (pendingConnectTimerRef.current) {
        clearTimeout(pendingConnectTimerRef.current);
        pendingConnectTimerRef.current = null;
      }
    };
  }, []);

  const register = useCallback(
    (opts: {
      status: ConnectionStatus;
      sessionId: string | null;
      error: string | null;
      connect: (vmOpts?: TerminalVMOptions) => void;
      disconnect: () => void;
      sendCommand: (command: string) => Promise<void>;
    }) => {
      setRegisteredStatus(opts.status);
      setRegisteredSessionId(opts.sessionId);
      setRegisteredError(opts.error);
      setIsTerminalRegistered(true);
      registeredConnectRef.current = opts.connect;
      registeredDisconnectRef.current = opts.disconnect;
      registeredSendCommandRef.current = opts.sendCommand;
      settleWaiters(opts.status, opts.sessionId);

      // When a disconnect/error originates outside openTerminal (e.g. panel button,
      // network drop, VM expiry), clear stale VM options so subsequent openTerminal
      // calls correctly detect that a reconnect is needed.
      if ((opts.status === 'disconnected' || opts.status === 'error') && !reconnectingRef.current) {
        activeVmOptsRef.current = undefined;
      }
    },
    [settleWaiters]
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
    // Whoever asked for this session is not getting one. Without this they
    // await a `register` that a cancelled connect will never produce.
    const abandoned = sessionWaitersRef.current;
    sessionWaitersRef.current = [];
    abandoned.forEach((waiter) => waiter.resolve(null));
    // Keep lastVmOpts in storage so the Connect button and auto-reconnect
    // can restore the same VM type. Only openTerminal with different opts
    // (or an explicit storage clear) should overwrite the persisted value.
    registeredDisconnectRef.current?.();
  }, []);

  const sendCommand = useCallback(async (command: string) => {
    if (!registeredSendCommandRef.current) {
      logger.warn('[TerminalContext] Cannot send command: terminal not registered');
      return;
    }
    await registeredSendCommandRef.current(command);
  }, []);

  const openTerminal = useCallback(
    (vmOpts?: TerminalVMOptions): Promise<string | null> => {
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

      if (!needsConnect && !needsReconnect) {
        return Promise.resolve(registeredSessionId);
      }

      if (needsReconnect) {
        reconnectingRef.current = true;
        registeredDisconnectRef.current?.();
      }

      activeVmOptsRef.current = vmOpts;
      setLastVmOpts(vmOpts);
      if (pendingConnectTimerRef.current) {
        clearTimeout(pendingConnectTimerRef.current);
      }
      pendingConnectTimerRef.current = setTimeout(() => {
        pendingConnectTimerRef.current = null;
        reconnectingRef.current = false;
        registeredConnectRef.current?.(vmOpts);
      }, 100);

      return new Promise((resolve) => {
        sessionWaitersRef.current.push({ resolve, leftConnected: registeredStatus !== 'connected' });
      });
    },
    [registeredStatus, registeredSessionId]
  );

  const value: TerminalContextValue = {
    status: registeredStatus,
    sessionId: registeredSessionId,
    error: registeredError,
    isTerminalRegistered,
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
