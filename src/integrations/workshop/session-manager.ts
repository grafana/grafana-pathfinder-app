import { log, warn, error } from '../../lib/logger';
/**
 * Session Manager for Collaborative Live Learning
 *
 * Manages P2P connections using PeerJS for simplified signaling
 */

import Peer, { DataConnection } from 'peerjs';
import { ReconnectionManager } from './reconnection-manager';
import type {
  SessionConfig,
  SessionInfo,
  AttendeeInfo,
  SessionRole,
  AnySessionEvent,
  SessionError,
  ConnectionState,
  ConnectionQuality,
  HandRaiseInfo,
} from '../../types/collaboration.types';

export interface PeerJSConfig {
  host: string;
  port: number;
  key: string;
}

/**
 * Session Manager class
 * Handles P2P connections and event broadcasting using PeerJS
 */
export class SessionManager {
  private peer: Peer | null = null;
  private connections: Map<string, DataConnection> = new Map();
  private sessionId: string | null = null;
  private role: SessionRole = null;
  private config: SessionConfig | null = null;

  // Event handlers
  private eventHandlers: Set<(event: AnySessionEvent) => void> = new Set();
  private errorHandlers: Set<(error: SessionError) => void> = new Set();
  private attendeeHandlers: Set<(attendee: AttendeeInfo) => void> = new Set();
  private attendeeUpdateHandlers: Set<(attendees: AttendeeInfo[]) => void> = new Set();

  // Attendee tracking (for presenter)
  private attendees: Map<string, AttendeeInfo> = new Map();

  // Hand raise tracking (for presenter)
  private handRaises: Map<string, HandRaiseInfo> = new Map();
  private handRaiseHandlers: Set<(handRaises: HandRaiseInfo[]) => void> = new Set();

  // Connection tracking and quality monitoring
  private connectionStates: Map<string, ConnectionState> = new Map();
  private lastHeartbeat: Map<string, number> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private heartbeatSentTimes: Map<string, number> = new Map();

  // Reconnection management
  // @ts-expect-error - Will be used in future reconnection implementation
  private reconnectionManager = new ReconnectionManager();
  // @ts-expect-error - Stored for potential reconnection scenarios
  private peerjsConfig: PeerJSConfig | null = null;

  /**
   * Check if session is active
   */
  isActive(): boolean {
    return this.peer !== null && !this.peer.destroyed;
  }

  /**
   * Get current role
   */
  getRole(): SessionRole {
    return this.role;
  }

  // ============================================================================
  // Session Creation (Presenter)
  // ============================================================================

  /**
   * Create a new session as presenter
   *
   * @param config - Session configuration
   * @param peerjsConfig - PeerJS server configuration
   * @returns Session info with join code
   */
  async createSession(config: SessionConfig, peerjsConfig?: PeerJSConfig): Promise<SessionInfo> {
    try {
      this.role = 'presenter';
      this.config = config;

      // Use provided config or defaults
      const peerConfig = peerjsConfig || { host: 'localhost', port: 9000, key: 'pathfinder' };
      this.peerjsConfig = peerConfig;

      // Create a new peer with a simple readable ID
      const peerId = this.generateReadableId();

      log(`[SessionManager] Creating presenter peer: ${peerId}`);
      log(`[SessionManager] Using PeerJS server: ${peerConfig.host}:${peerConfig.port}/pathfinder`);

      // Create peer connection to configured PeerJS server
      this.peer = new Peer(peerId, {
        host: peerConfig.host,
        port: peerConfig.port,
        path: '/pathfinder',
        key: peerConfig.key,
        debug: 2, // Enable debug logging
      });

      // Wait for peer to be ready
      await new Promise<void>((resolve, reject) => {
        if (!this.peer) {
          reject(new Error('Peer not initialized'));
          return;
        }

        this.peer.on('open', (id) => {
          log(`[SessionManager] Peer ready with ID: ${id}`);
          this.sessionId = id;
          resolve();
        });

        this.peer.on('error', (err) => {
          error('[SessionManager] Peer error:', err);
          reject(err);
        });

        // Timeout after 10 seconds
        setTimeout(() => reject(new Error('Peer connection timeout')), 10000);
      });

      // Set up connection handler for incoming attendees
      this.setupPresenterConnectionHandler();

      // Start heartbeat mechanism
      this.startHeartbeat();

      // Generate join URL with session info
      const joinUrl = this.generateJoinUrl(peerId, config.name, config.tutorialUrl);

      // Generate QR code for the join URL
      let qrCode = '';
      try {
        const QRCode = await import('qrcode');
        qrCode = await QRCode.default.toDataURL(joinUrl, {
          width: 300,
          margin: 2,
          errorCorrectionLevel: 'M',
        });
      } catch (err) {
        error('[SessionManager] Failed to generate QR code:', err);
        // Non-fatal - continue without QR code
      }

      log(`[SessionManager] Session created: ${peerId}`);

      // Create a join code that includes session metadata
      const joinCodeData = {
        id: peerId,
        name: config.name,
        url: config.tutorialUrl,
      };
      const joinCode = btoa(JSON.stringify(joinCodeData));

      return {
        sessionId: peerId,
        joinCode, // Base64 encoded session info
        joinUrl,
        qrCode,
        config,
      };
    } catch (err) {
      error('[SessionManager] Failed to create session:', err);
      this.handleError({
        code: 'CONNECTION_FAILED',
        message: 'Failed to create session',
        details: error,
      });
      throw error;
    }
  }

  /**
   * Set up handler for incoming attendee connections
   */
  private setupPresenterConnectionHandler(): void {
    if (!this.peer) {
      return;
    }

    this.peer.on('connection', (conn: DataConnection) => {
      log(`[SessionManager] Attendee connecting: ${conn.peer}`);

      // Wait for connection to open
      conn.on('open', () => {
        log(`[SessionManager] Attendee connected: ${conn.peer}`);

        // Store connection
        this.connections.set(conn.peer, conn);

        // Track connection state
        this.connectionStates.set(conn.peer, 'connected');
        this.lastHeartbeat.set(conn.peer, Date.now());

        // Get attendee metadata from first message
        conn.on('data', (data: any) => {
          if (data.type === 'attendee_join') {
            const attendee: AttendeeInfo = {
              id: conn.peer,
              name: data.name || 'Anonymous',
              mode: data.mode || 'guided',
              connectionState: 'connected',
              joinedAt: Date.now(),
            };

            this.attendees.set(conn.peer, attendee);

            // Notify handlers
            this.attendeeHandlers.forEach((handler) => handler(attendee));

            // Notify attendee list update
            this.notifyAttendeeListUpdate();

            // Send welcome message
            conn.send({
              type: 'session_start',
              sessionId: this.sessionId,
              config: this.config,
              timestamp: Date.now(),
            });
          } else if (data.type === 'mode_change') {
            // Handle mode change from attendee
            const attendee = this.attendees.get(conn.peer);
            if (attendee) {
              log(`[SessionManager] Attendee ${conn.peer} changed mode to ${data.mode}`);
              // Create new object to trigger React re-render
              const updatedAttendee: AttendeeInfo = {
                ...attendee,
                mode: data.mode,
              };
              this.attendees.set(conn.peer, updatedAttendee);

              // Notify attendee list update
              this.notifyAttendeeListUpdate();
            } else {
              warn(`[SessionManager] Received mode_change for unknown attendee: ${conn.peer}`);
            }
            // Forward event to handlers
            this.eventHandlers.forEach((handler) => handler(data));
          } else if (data.type === 'hand_raise') {
            // Handle hand raise from attendee
            if (data.isRaised) {
              // Add to hand raises
              log(`[SessionManager] Attendee ${data.attendeeName} raised their hand`);
              this.handRaises.set(conn.peer, {
                attendeeId: conn.peer,
                attendeeName: data.attendeeName,
                raisedAt: data.timestamp,
              });
            } else {
              // Remove from hand raises
              log(`[SessionManager] Attendee ${data.attendeeName} lowered their hand`);
              this.handRaises.delete(conn.peer);
            }
            // Notify hand raise update
            this.notifyHandRaiseUpdate();
            // Forward event to handlers
            this.eventHandlers.forEach((handler) => handler(data));
          } else if (data.type === 'attendee_leave') {
            // Handle intentional attendee leave - remove immediately (no grace period)
            log(`[SessionManager] Attendee ${conn.peer} leaving intentionally`);
            this.attendees.delete(conn.peer);
            this.connectionStates.delete(conn.peer);
            this.lastHeartbeat.delete(conn.peer);
            this.heartbeatSentTimes.delete(conn.peer);
            this.connections.delete(conn.peer);

            // Clean up hand raise if present
            if (this.handRaises.has(conn.peer)) {
              this.handRaises.delete(conn.peer);
              this.notifyHandRaiseUpdate();
            }

            // Notify UI of immediate attendee removal
            this.notifyAttendeeListUpdate();

            // Forward event to handlers
            this.eventHandlers.forEach((handler) => handler(data));
          } else if (data.type === 'heartbeat') {
            // Update last heartbeat time
            this.lastHeartbeat.set(conn.peer, Date.now());

            // Calculate latency if we have the sent time
            const sentTime = this.heartbeatSentTimes.get(conn.peer);
            if (sentTime && data.sentAt === sentTime) {
              const latency = Date.now() - sentTime;

              // Update attendee with connection quality
              const attendee = this.attendees.get(conn.peer);
              if (attendee) {
                const quality: ConnectionQuality = {
                  latency,
                  packetsLost: 0, // TODO: Track actual packet loss
                  lastHeartbeat: Date.now(),
                  quality: latency < 100 ? 'excellent' : latency < 300 ? 'good' : 'poor',
                };

                const updatedAttendee: AttendeeInfo = {
                  ...attendee,
                  connectionQuality: quality,
                };
                this.attendees.set(conn.peer, updatedAttendee);

                // Notify attendee list update
                this.notifyAttendeeListUpdate();
              }
            }
          } else {
            // Forward other events to handlers
            this.eventHandlers.forEach((handler) => handler(data));
          }
        });

        // Handle disconnection
        conn.on('close', () => {
          log(`[SessionManager] Attendee disconnected: ${conn.peer}`);
          this.connectionStates.set(conn.peer, 'disconnected');

          // Update attendee state
          const attendee = this.attendees.get(conn.peer);
          if (attendee) {
            const updatedAttendee: AttendeeInfo = {
              ...attendee,
              connectionState: 'disconnected',
            };
            this.attendees.set(conn.peer, updatedAttendee);

            // Notify attendee list update
            this.notifyAttendeeListUpdate();
          }

          this.connections.delete(conn.peer);
          // Don't immediately delete attendee - allow for reconnection
          setTimeout(() => {
            // Only delete if still disconnected after 30 seconds
            if (this.connectionStates.get(conn.peer) === 'disconnected') {
              log(`[SessionManager] Removing attendee after grace period: ${conn.peer}`);
              this.attendees.delete(conn.peer);
              this.connectionStates.delete(conn.peer);
              this.lastHeartbeat.delete(conn.peer);
              this.heartbeatSentTimes.delete(conn.peer);

              // Clean up hand raise if present
              if (this.handRaises.has(conn.peer)) {
                this.handRaises.delete(conn.peer);
                this.notifyHandRaiseUpdate();
              }

              // Notify UI of attendee removal
              this.notifyAttendeeListUpdate();
            }
          }, 30000);
        });

        conn.on('error', (err) => {
          error(`[SessionManager] Connection error with ${conn.peer}:`, err);
          this.connectionStates.set(conn.peer, 'failed');

          // Update attendee state
          const attendee = this.attendees.get(conn.peer);
          if (attendee) {
            const updatedAttendee: AttendeeInfo = {
              ...attendee,
              connectionState: 'failed',
            };
            this.attendees.set(conn.peer, updatedAttendee);

            // Notify attendee list update
            this.notifyAttendeeListUpdate();
          }
        });
      });
    });
  }

  // ============================================================================
  // Session Joining (Attendee)
  // ============================================================================

  /**
   * Join an existing session as attendee
   *
   * @param sessionId - Presenter's peer ID
   * @param mode - Attendee mode (guided or follow)
   * @param name - Optional attendee name
   * @param peerjsConfig - PeerJS server configuration
   */
  async joinSession(
    sessionId: string,
    mode: 'guided' | 'follow',
    name?: string,
    peerjsConfig?: PeerJSConfig
  ): Promise<void> {
    try {
      this.role = 'attendee';
      this.sessionId = sessionId;

      // Use provided config or defaults
      const peerConfig = peerjsConfig || { host: 'localhost', port: 9000, key: 'pathfinder' };
      this.peerjsConfig = peerConfig;

      log(`[SessionManager] Joining session: ${sessionId}`);
      log(`[SessionManager] Using PeerJS server: ${peerConfig.host}:${peerConfig.port}/pathfinder`);

      // Create a peer for this attendee
      this.peer = new Peer({
        host: peerConfig.host,
        port: peerConfig.port,
        path: '/pathfinder',
        key: peerConfig.key,
        debug: 2,
      });

      // Wait for peer to be ready
      await new Promise<void>((resolve, reject) => {
        if (!this.peer) {
          reject(new Error('Peer not initialized'));
          return;
        }

        this.peer.on('open', (id) => {
          log(`[SessionManager] Attendee peer ready: ${id}`);
          resolve();
        });

        this.peer.on('error', (err) => {
          error('[SessionManager] Peer error:', err);
          reject(err);
        });

        setTimeout(() => reject(new Error('Peer connection timeout')), 10000);
      });

      // Connect to presenter
      const conn = this.peer!.connect(sessionId, {
        reliable: true,
      });

      // Wait for connection to open
      await new Promise<void>((resolve, reject) => {
        conn.on('open', () => {
          log(`[SessionManager] Connected to presenter: ${sessionId}`);

          // Send join message
          conn.send({
            type: 'attendee_join',
            name: name || 'Anonymous',
            mode,
            timestamp: Date.now(),
          });

          // Store connection
          this.connections.set(sessionId, conn);

          // Set up event handler
          conn.on('data', (data: any) => {
            log('[SessionManager] Received event from presenter:', data);

            // Respond to heartbeats
            if (data.type === 'heartbeat') {
              // Echo back the heartbeat with the same timestamp
              conn.send({
                type: 'heartbeat',
                sessionId: this.sessionId || '',
                timestamp: Date.now(),
                senderId: 'attendee',
                sentAt: data.sentAt, // Echo back the sent time for latency calculation
              });

              // Update last heartbeat time
              this.lastHeartbeat.set(sessionId, Date.now());
            }

            // Forward all events to handlers
            this.eventHandlers.forEach((handler) => handler(data));
          });

          conn.on('close', () => {
            log('[SessionManager] Disconnected from presenter');
            this.handleError({
              code: 'CONNECTION_FAILED',
              message: 'Connection to presenter lost',
              details: null,
            });
          });

          conn.on('error', (err) => {
            error('[SessionManager] Connection error:', err);
            this.handleError({
              code: 'CONNECTION_FAILED',
              message: 'Connection error',
              details: err,
            });
          });

          resolve();
        });

        conn.on('error', (err) => {
          error('[SessionManager] Failed to connect:', err);
          reject(err);
        });

        setTimeout(() => reject(new Error('Connection timeout')), 10000);
      });

      log(`[SessionManager] Successfully joined session`);
    } catch (err) {
      error('[SessionManager] Failed to join session:', err);
      this.handleError({
        code: 'CONNECTION_FAILED',
        message: 'Failed to join session',
        details: error,
      });
      throw error;
    }
  }

  // ============================================================================
  // Event Broadcasting
  // ============================================================================

  /**
   * Broadcast an event to all attendees (presenter only)
   *
   * @param event - Event to broadcast
   */
  broadcastToAttendees(event: AnySessionEvent): void {
    if (this.role !== 'presenter') {
      warn('[SessionManager] Only presenter can broadcast to attendees');
      return;
    }

    log(`[SessionManager] Broadcasting event to ${this.connections.size} attendees:`, event);

    this.connections.forEach((conn, peerId) => {
      try {
        if (conn.open) {
          conn.send(event);
        } else {
          warn(`[SessionManager] Connection to ${peerId} is not open`);
        }
      } catch (err) {
        error(`[SessionManager] Failed to send to ${peerId}:`, err);
      }
    });
  }

  /**
   * Send an event to the presenter (attendee only)
   *
   * @param event - Event to send
   */
  sendToPresenter(event: AnySessionEvent): void {
    if (this.role !== 'attendee' || !this.sessionId) {
      warn('[SessionManager] Can only send to presenter as attendee');
      return;
    }

    const conn = this.connections.get(this.sessionId);
    if (conn && conn.open) {
      conn.send(event);
    } else {
      error('[SessionManager] No connection to presenter');
    }
  }

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * Register event handler
   */
  onEvent(handler: (event: AnySessionEvent) => void): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  /**
   * Register error handler
   */
  onError(handler: (error: SessionError) => void): () => void {
    this.errorHandlers.add(handler);
    return () => this.errorHandlers.delete(handler);
  }

  /**
   * Register attendee handler (presenter only)
   */
  onAttendeeJoin(handler: (attendee: AttendeeInfo) => void): () => void {
    this.attendeeHandlers.add(handler);
    return () => this.attendeeHandlers.delete(handler);
  }

  /**
   * Register attendee list update handler (presenter only)
   * Called whenever the attendee list changes (join, leave, mode change, connection state change)
   */
  onAttendeeListUpdate(callback: (attendees: AttendeeInfo[]) => void): () => void {
    this.attendeeUpdateHandlers.add(callback);

    // Return cleanup function
    return () => {
      this.attendeeUpdateHandlers.delete(callback);
    };
  }

  /**
   * Notify all attendee list update handlers
   * @private
   */
  private notifyAttendeeListUpdate(): void {
    const attendeeList = Array.from(this.attendees.values());
    log(`[SessionManager] Notifying attendee list update (${attendeeList.length} attendees)`);

    this.attendeeUpdateHandlers.forEach((handler) => {
      try {
        handler(attendeeList);
      } catch (err) {
        error('[SessionManager] Error in attendee update handler:', err);
      }
    });
  }

  /**
   * Get list of attendees (presenter only)
   */
  getAttendees(): AttendeeInfo[] {
    const attendeeList = Array.from(this.attendees.values());
    log('[SessionManager] getAttendees() called, returning:', attendeeList);
    log('[SessionManager] Internal attendees Map size:', this.attendees.size);
    return attendeeList;
  }

  /**
   * Subscribe to hand raise updates (presenter only)
   */
  onHandRaiseUpdate(handler: (handRaises: HandRaiseInfo[]) => void): () => void {
    this.handRaiseHandlers.add(handler);
    return () => {
      this.handRaiseHandlers.delete(handler);
    };
  }

  /**
   * Get list of raised hands sorted by timestamp (presenter only)
   */
  getHandRaises(): HandRaiseInfo[] {
    return Array.from(this.handRaises.values()).sort((a, b) => a.raisedAt - b.raisedAt);
  }

  /**
   * Notify all handlers of hand raise changes
   */
  private notifyHandRaiseUpdate(): void {
    const handRaiseList = this.getHandRaises();
    this.handRaiseHandlers.forEach((handler) => {
      try {
        handler(handRaiseList);
      } catch (err) {
        error('[SessionManager] Error in hand raise update handler:', err);
      }
    });
  }

  // ============================================================================
  // Session Management
  // ============================================================================

  /**
   * End the session and close all connections
   */
  endSession(): void {
    log(`[SessionManager] Ending session (role: ${this.role})`);

    // If attendee, send leave event to presenter before disconnecting
    if (this.role === 'attendee' && this.sessionId) {
      const presenterConn = this.connections.get(this.sessionId);
      if (presenterConn && presenterConn.open) {
        try {
          log('[SessionManager] Attendee sending leave event to presenter');
          presenterConn.send({
            type: 'attendee_leave',
            sessionId: this.sessionId,
            timestamp: Date.now(),
            senderId: this.peer?.id || 'unknown',
          });
          // Give time for the message to be sent
          setTimeout(() => {
            presenterConn.close();
          }, 100);
        } catch (err) {
          error('[SessionManager] Error sending leave event:', err);
          presenterConn.close();
        }
      }
    }

    // If presenter, close all connections
    if (this.role === 'presenter') {
      this.connections.forEach((conn, peerId) => {
        try {
          if (conn.open) {
            conn.send({
              type: 'session_end',
              sessionId: this.sessionId,
              timestamp: Date.now(),
            });
          }
          conn.close();
        } catch (err) {
          error(`[SessionManager] Error closing connection to ${peerId}:`, err);
        }
      });
    }

    this.connections.clear();
    this.attendees.clear();

    // Destroy peer
    if (this.peer && !this.peer.destroyed) {
      this.peer.destroy();
    }

    this.peer = null;
    this.sessionId = null;
    this.role = null;
    this.config = null;

    // Clear handlers
    this.eventHandlers.clear();
    this.errorHandlers.clear();
    this.attendeeHandlers.clear();

    // Stop heartbeat
    this.stopHeartbeat();

    // Clear connection tracking
    this.connectionStates.clear();
    this.lastHeartbeat.clear();
    this.heartbeatSentTimes.clear();
  }

  // ============================================================================
  // Connection Monitoring & Heartbeat
  // ============================================================================

  /**
   * Start heartbeat mechanism to monitor connection health
   */
  private startHeartbeat(): void {
    // Don't start if already running
    if (this.heartbeatInterval) {
      return;
    }

    log('[SessionManager] Starting heartbeat mechanism');

    // Send heartbeat every 5 seconds
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();

      this.connections.forEach((conn, peerId) => {
        if (conn.open) {
          try {
            // Store when we sent this heartbeat
            this.heartbeatSentTimes.set(peerId, now);

            // Send heartbeat
            conn.send({
              type: 'heartbeat',
              sessionId: this.sessionId || '',
              timestamp: now,
              senderId: this.sessionId || 'presenter',
              sentAt: now,
            });

            // Check if connection is stale (no response in 15 seconds)
            const lastHeartbeat = this.lastHeartbeat.get(peerId) || 0;
            const timeSinceLastHeartbeat = now - lastHeartbeat;

            if (timeSinceLastHeartbeat > 15000) {
              warn(`[SessionManager] No heartbeat from ${peerId} for ${timeSinceLastHeartbeat}ms`);

              // Update connection state to disconnected if no response
              const currentState = this.connectionStates.get(peerId);
              if (currentState !== 'disconnected') {
                this.connectionStates.set(peerId, 'disconnected');

                // Update attendee state
                const attendee = this.attendees.get(peerId);
                if (attendee) {
                  const updatedAttendee: AttendeeInfo = {
                    ...attendee,
                    connectionState: 'disconnected',
                  };
                  this.attendees.set(peerId, updatedAttendee);
                }
              }
            }
          } catch (err) {
            error(`[SessionManager] Failed to send heartbeat to ${peerId}:`, err);
          }
        }
      });
    }, 5000);
  }

  /**
   * Stop heartbeat mechanism
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      log('[SessionManager] Stopping heartbeat mechanism');
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Get connection state for a specific peer
   */
  getConnectionState(peerId: string): ConnectionState {
    return this.connectionStates.get(peerId) || 'disconnected';
  }

  /**
   * Get connection quality for a specific peer
   */
  getConnectionQuality(peerId: string): ConnectionQuality | null {
    const attendee = this.attendees.get(peerId);
    return attendee?.connectionQuality || null;
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Generate a readable peer ID (6 characters)
   */
  private generateReadableId(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id = '';
    for (let i = 0; i < 6; i++) {
      id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return id;
  }

  /**
   * Generate join URL with session information
   */
  private generateJoinUrl(peerId: string, sessionName?: string, tutorialUrl?: string): string {
    const base = window.location.origin;
    const params = new URLSearchParams({
      session: peerId,
    });

    if (sessionName) {
      params.set('sessionName', sessionName);
    }

    if (tutorialUrl) {
      params.set('tutorialUrl', tutorialUrl);
    }

    return `${base}/a/grafana-grafanadocsplugin-app?${params.toString()}`;
  }

  /**
   * Handle errors
   */
  private handleError(sessionError: SessionError): void {
    error('[SessionManager] Error:', sessionError);
    this.errorHandlers.forEach((handler) => handler(sessionError));
  }
}
