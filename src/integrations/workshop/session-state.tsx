/**
 * Session State Management for Collaborative Learning
 *
 * React Context and hooks for managing active session state across components
 */

import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { SessionManager } from './session-manager';
import { PluginPropsContext } from '../../utils/utils.plugin';
import { getConfigWithDefaults } from '../../constants';
import type {
  SessionConfig,
  SessionInfo,
  SessionRole,
  AttendeeInfo,
  AnySessionEvent,
  SessionStartEvent,
  HandRaiseInfo,
} from '../../types/collaboration.types';

/**
 * Session context value
 */
interface SessionContextValue {
  // Session state
  sessionManager: SessionManager | null;
  sessionInfo: SessionInfo | null;
  sessionRole: SessionRole;
  isActive: boolean;

  // Attendees (presenter only)
  attendees: AttendeeInfo[];

  // Hand raises (presenter only)
  handRaises: HandRaiseInfo[];

  // Attendee mode and name (attendee only)
  attendeeMode: 'guided' | 'follow' | null;
  attendeeName: string;
  setAttendeeMode: (mode: 'guided' | 'follow') => void;

  // Actions
  createSession: (config: SessionConfig) => Promise<SessionInfo>;
  joinSession: (sessionId: string, mode: 'guided' | 'follow', name?: string) => Promise<void>;
  endSession: () => void;

  // Event handling
  onEvent: (callback: (event: AnySessionEvent) => void) => () => void;
}

/**
 * Session context
 */
const SessionContext = createContext<SessionContextValue | null>(null);

/**
 * Props for SessionProvider
 */
interface SessionProviderProps {
  children: ReactNode;
}

/**
 * Session Provider component
 *
 * Wrap your app with this to enable session management
 */
export function SessionProvider({ children }: SessionProviderProps) {
  const pluginProps = useContext(PluginPropsContext);
  const [sessionManager] = useState(() => new SessionManager());
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const [sessionRole, setSessionRole] = useState<SessionRole>(null);
  const [attendees, setAttendees] = useState<AttendeeInfo[]>([]);
  const [handRaises, setHandRaises] = useState<HandRaiseInfo[]>([]);
  const [attendeeMode, setAttendeeMode] = useState<'guided' | 'follow' | null>(null);
  const [attendeeName, setAttendeeName] = useState<string>('');
  const [eventCallbacks, setEventCallbacks] = useState<Set<(event: AnySessionEvent) => void>>(new Set());

  // Get PeerJS config from plugin settings
  const getPeerjsConfig = useCallback(() => {
    if (!pluginProps) {
      return { host: 'localhost', port: 9000, key: 'pathfinder' };
    }
    const config = getConfigWithDefaults(pluginProps.meta.jsonData || {});
    return {
      host: config.peerjsHost,
      port: config.peerjsPort,
      key: config.peerjsKey,
    };
  }, [pluginProps]);

  // Subscribe to real-time attendee list updates (presenter only)
  useEffect(() => {
    if (sessionRole !== 'presenter' || !sessionManager.isActive()) {
      return;
    }

    // Subscribe to real-time attendee list updates
    const cleanup = sessionManager.onAttendeeListUpdate((updatedAttendees) => {
      console.log('[SessionState] Attendee list updated:', updatedAttendees.length);
      setAttendees(updatedAttendees);
    });

    // Set initial list asynchronously to avoid lint error
    const initial = sessionManager.getAttendees();
    const timer = setTimeout(() => {
      setAttendees(initial);
    }, 0);

    return () => {
      clearTimeout(timer);
      cleanup();
    };
  }, [sessionRole, sessionManager]);

  // Subscribe to real-time hand raise updates (presenter only)
  useEffect(() => {
    if (sessionRole !== 'presenter' || !sessionManager.isActive()) {
      return;
    }

    // Subscribe to real-time hand raise updates
    const cleanup = sessionManager.onHandRaiseUpdate((updatedHandRaises) => {
      console.log('[SessionState] Hand raises updated:', updatedHandRaises.length);
      setHandRaises(updatedHandRaises);
    });

    // Set initial list asynchronously to avoid lint error
    const initial = sessionManager.getHandRaises();
    const timer = setTimeout(() => {
      setHandRaises(initial);
    }, 0);

    return () => {
      clearTimeout(timer);
      cleanup();
    };
  }, [sessionRole, sessionManager]);

  // Set up event listener on session manager
  useEffect(() => {
    if (!sessionManager) {
      return;
    }

    const cleanup = sessionManager.onEvent((event) => {
      // Notify all registered callbacks
      eventCallbacks.forEach((callback) => {
        try {
          callback(event);
        } catch (error) {
          console.error('[SessionState] Error in event callback:', error);
        }
      });
    });

    return cleanup;
  }, [sessionManager, eventCallbacks]);

  // Listen for attendee joins (presenter only)
  useEffect(() => {
    if (!sessionManager || sessionRole !== 'presenter') {
      return;
    }

    const cleanup = sessionManager.onAttendeeJoin((attendee) => {
      console.log('[SessionState] Attendee joined:', attendee);
      setAttendees((prev) => [...prev, attendee]);
    });

    return cleanup;
  }, [sessionManager, sessionRole]);

  /**
   * Create a new session as presenter
   */
  const createSession = useCallback(
    async (config: SessionConfig): Promise<SessionInfo> => {
      try {
        const peerjsConfig = getPeerjsConfig();
        const info = await sessionManager.createSession(config, peerjsConfig);
        setSessionInfo(info);
        setSessionRole('presenter');
        return info;
      } catch (error) {
        console.error('[SessionState] Failed to create session:', error);
        throw error;
      }
    },
    [sessionManager, getPeerjsConfig]
  );

  /**
   * Join an existing session as attendee
   */
  const joinSession = useCallback(
    async (sessionId: string, mode: 'guided' | 'follow', name?: string): Promise<void> => {
      try {
        // Store the attendee's selected mode and name
        setAttendeeMode(mode);
        const attendeeName = name || 'Anonymous';
        setAttendeeName(attendeeName);

        const peerjsConfig = getPeerjsConfig();
        await sessionManager.joinSession(sessionId, mode, attendeeName, peerjsConfig);

        // Wait for session_start event to get full session info
        const sessionStartPromise = new Promise<SessionInfo>((resolve) => {
          const cleanup = sessionManager.onEvent((event) => {
            if (event.type === 'session_start') {
              cleanup();

              const startEvent = event as SessionStartEvent;

              // Construct session info from the event
              const info: SessionInfo = {
                sessionId: startEvent.sessionId,
                joinCode: sessionId,
                joinUrl: '',
                qrCode: '',
                config: startEvent.config,
              };

              resolve(info);
            }
          });

          // Timeout after 5 seconds
          setTimeout(() => {
            cleanup();
            resolve({
              sessionId,
              joinCode: sessionId,
              joinUrl: '',
              qrCode: '',
              config: {
                name: 'Unknown session',
                tutorialUrl: '',
                defaultMode: mode,
              },
            });
          }, 5000);
        });

        const info = await sessionStartPromise;
        setSessionInfo(info);
        setSessionRole('attendee');

        console.log('[SessionState] Successfully joined session:', info);
      } catch (error) {
        console.error('[SessionState] Failed to join session:', error);
        throw error;
      }
    },
    [sessionManager, getPeerjsConfig]
  );

  /**
   * End the current session
   */
  const endSession = useCallback(() => {
    sessionManager.endSession();
    setSessionInfo(null);
    setSessionRole(null);
    setAttendees([]);
    setAttendeeMode(null);
  }, [sessionManager]);

  /**
   * Register event callback
   */
  const onEvent = useCallback((callback: (event: AnySessionEvent) => void) => {
    setEventCallbacks((prev) => new Set(prev).add(callback));

    return () => {
      setEventCallbacks((prev) => {
        const next = new Set(prev);
        next.delete(callback);
        return next;
      });
    };
  }, []);

  /**
   * Update attendee mode
   */
  const updateAttendeeMode = useCallback((mode: 'guided' | 'follow') => {
    console.log(`[SessionState] Updating attendee mode to: ${mode}`);
    setAttendeeMode(mode);
  }, []);

  const value: SessionContextValue = {
    sessionManager,
    sessionInfo,
    sessionRole,
    isActive: sessionManager.isActive(),
    attendees,
    handRaises,
    attendeeMode,
    attendeeName,
    setAttendeeMode: updateAttendeeMode,
    createSession,
    joinSession,
    endSession,
    onEvent,
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/**
 * Hook to access session context
 *
 * @throws Error if used outside SessionProvider
 */
export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used within SessionProvider');
  }
  return context;
}

/**
 * Hook to check if session is active
 */
export function useIsSessionActive(): boolean {
  const { isActive } = useSession();
  return isActive;
}

/**
 * Hook to get session role
 */
export function useSessionRole(): SessionRole {
  const { sessionRole } = useSession();
  return sessionRole;
}

/**
 * Hook to get session manager
 */
export function useSessionManager(): SessionManager | null {
  const { sessionManager } = useSession();
  return sessionManager;
}
