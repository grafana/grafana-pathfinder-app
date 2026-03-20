/**
 * Session Manager for Collaborative Live Learning
 *
 * Manages P2P connections using PeerJS for simplified signaling
 */

import Peer, { DataConnection } from 'peerjs';
import { ReconnectionManager } from './reconnection-manager';
import { generateSessionKeyPair, generateNonce, signChallenge, verifyChallenge } from './session-crypto';
import { generateJoinCode } from './join-code-utils';
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
  SessionOffer,
} from '../../types/collaboration.types';

export interface PeerJSConfig {
  host: string;
  port: number;
  key: string;
  secure: boolean;
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

  // ECDSA private key for presenter authentication (generated at session creation, never transmitted)
  private sessionPrivateKey: CryptoKey | null = null;

  // Connections awaiting attendee_join handshake (not yet in this.connections)
  private pendingConnections: Map<string, DataConnection> = new Map();
  // Tracks which connections have already received a challenge (prevents DoS oracle)
  private challengedConnections: Set<string> = new Set();

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
      const peerConfig = peerjsConfig || { host: 'localhost', port: 9000, key: 'pathfinder', secure: false };
      this.peerjsConfig = peerConfig;

      // Create a new peer with a simple readable ID
      const peerId = this.generateReadableId();

      console.log(`[SessionManager] Creating presenter peer: ${peerId}`);
      console.log(`[SessionManager] Using PeerJS server: ${peerConfig.host}:${peerConfig.port}/pathfinder`);

      // Create peer connection to configured PeerJS server
      this.peer = new Peer(peerId, {
        host: peerConfig.host,
        port: peerConfig.port,
        path: '/pathfinder',
        key: peerConfig.key,
        secure: peerConfig.secure,
        debug: 2, // Enable debug logging
      });

      // Wait for peer to be ready
      await new Promise<void>((resolve, reject) => {
        if (!this.peer) {
          reject(new Error('Peer not initialized'));
          return;
        }

        this.peer.on('open', (id) => {
          console.log(`[SessionManager] Peer ready with ID: ${id}`);
          this.sessionId = id;
          resolve();
        });

        this.peer.on('error', (err) => {
          console.error('[SessionManager] Peer error:', err);
          reject(err);
        });

        // Timeout after 10 seconds
        setTimeout(() => reject(new Error('Peer connection timeout')), 10000);
      });

      // Generate ECDSA key pair for presenter authentication
      const { publicKeyB64, privateKey } = await generateSessionKeyPair();
      this.sessionPrivateKey = privateKey;

      // Set up connection handler for incoming attendees
      this.setupPresenterConnectionHandler();

      // Start heartbeat mechanism
      this.startHeartbeat();

      // Create a join code that includes session metadata and the presenter's public key
      // Use this.sessionId (PeerJS-confirmed) rather than the requested peerId
      const sessionOffer: SessionOffer = {
        id: this.sessionId!,
        name: config.name,
        tutorialUrl: config.tutorialUrl,
        defaultMode: 'guided',
        offer: {} as RTCSessionDescriptionInit,
        timestamp: Date.now(),
        sessionPublicKey: publicKeyB64,
      };
      const joinCode = generateJoinCode(sessionOffer);

      // Generate join URL with session info (includes pubkey via joinCode)
      const joinUrl = this.generateJoinUrl(joinCode);

      // Generate QR code for the join URL
      let qrCode = '';
      try {
        const QRCode = await import('qrcode');
        qrCode = await QRCode.default.toDataURL(joinUrl, {
          width: 300,
          margin: 2,
          errorCorrectionLevel: 'M',
        });
      } catch (error) {
        console.error('[SessionManager] Failed to generate QR code:', error);
        // Non-fatal - continue without QR code
      }

      console.log(`[SessionManager] Session created: ${this.sessionId}`);

      return {
        sessionId: this.sessionId!,
        joinCode, // Base64 encoded session info
        joinUrl,
        qrCode,
        config,
      };
    } catch (error) {
      console.error('[SessionManager] Failed to create session:', error);
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
      console.log(`[SessionManager] Attendee connecting: ${conn.peer}`);

      conn.on('open', () => {
        console.log(`[SessionManager] Attendee connected (pending handshake): ${conn.peer}`);

        // Store in pending — not yet authenticated (C1)
        this.pendingConnections.set(conn.peer, conn);

        // Enforce a 30-second handshake timeout (C1)
        const handshakeTimeout = setTimeout(() => {
          if (this.pendingConnections.has(conn.peer)) {
            console.warn(`[SessionManager] Handshake timeout for ${conn.peer} — closing`);
            this.pendingConnections.delete(conn.peer);
            this.challengedConnections.delete(conn.peer);
            conn.close();
          }
        }, 30000);

        conn.on('data', async (data: any) => {
          if (data.type === 'presenter_challenge') {
            // One challenge per connection lifetime — prevents DoS oracle (C2)
            if (this.challengedConnections.has(conn.peer)) {
              return;
            }
            // Basic nonce sanity check (C2)
            if (typeof data.nonce !== 'string' || data.nonce.length === 0 || data.nonce.length > 128) {
              return;
            }
            this.challengedConnections.add(conn.peer);
            if (this.sessionPrivateKey) {
              const signature = await signChallenge(this.sessionPrivateKey, data.nonce);
              conn.send({ type: 'presenter_response', nonce: data.nonce, signature });
            }
            return;
          }

          if (data.type === 'attendee_join') {
            // Move from pending to authenticated connections (C1)
            if (!this.pendingConnections.has(conn.peer)) {
              // Already registered or unknown — ignore duplicate
              return;
            }
            clearTimeout(handshakeTimeout);
            this.pendingConnections.delete(conn.peer);
            this.connections.set(conn.peer, conn);

            // Track connection state
            this.connectionStates.set(conn.peer, 'connected');
            this.lastHeartbeat.set(conn.peer, Date.now());

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
            return;
          }

          // Guard: drop all messages from connections that haven't completed handshake (C1, S1)
          if (!this.connections.has(conn.peer)) {
            return;
          }

          if (data.type === 'mode_change') {
            // Handle mode change from attendee
            const attendee = this.attendees.get(conn.peer);
            if (attendee) {
              console.log(`[SessionManager] Attendee ${conn.peer} changed mode to ${data.mode}`);
              const updatedAttendee: AttendeeInfo = {
                ...attendee,
                mode: data.mode,
              };
              this.attendees.set(conn.peer, updatedAttendee);
              this.notifyAttendeeListUpdate();
            } else {
              console.warn(`[SessionManager] Received mode_change for unknown attendee: ${conn.peer}`);
            }
            this.eventHandlers.forEach((handler) => handler(data));
          } else if (data.type === 'hand_raise') {
            if (data.isRaised) {
              console.log(`[SessionManager] Attendee ${data.attendeeName} raised their hand`);
              this.handRaises.set(conn.peer, {
                attendeeId: conn.peer,
                attendeeName: data.attendeeName,
                raisedAt: data.timestamp,
              });
            } else {
              console.log(`[SessionManager] Attendee ${data.attendeeName} lowered their hand`);
              this.handRaises.delete(conn.peer);
            }
            this.notifyHandRaiseUpdate();
            this.eventHandlers.forEach((handler) => handler(data));
          } else if (data.type === 'attendee_leave') {
            // Handle intentional attendee leave - remove immediately (no grace period)
            console.log(`[SessionManager] Attendee ${conn.peer} leaving intentionally`);
            this.attendees.delete(conn.peer);
            this.connectionStates.delete(conn.peer);
            this.lastHeartbeat.delete(conn.peer);
            this.heartbeatSentTimes.delete(conn.peer);
            this.connections.delete(conn.peer);

            if (this.handRaises.has(conn.peer)) {
              this.handRaises.delete(conn.peer);
              this.notifyHandRaiseUpdate();
            }

            this.notifyAttendeeListUpdate();
            this.eventHandlers.forEach((handler) => handler(data));
          } else if (data.type === 'heartbeat') {
            this.lastHeartbeat.set(conn.peer, Date.now());

            const sentTime = this.heartbeatSentTimes.get(conn.peer);
            if (sentTime && data.sentAt === sentTime) {
              const latency = Date.now() - sentTime;

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
                this.notifyAttendeeListUpdate();
              }
            }
          } else {
            this.eventHandlers.forEach((handler) => handler(data));
          }
        });

        conn.on('close', () => {
          // Clean up pending state if handshake never completed (C1)
          if (this.pendingConnections.has(conn.peer)) {
            clearTimeout(handshakeTimeout);
            this.pendingConnections.delete(conn.peer);
            this.challengedConnections.delete(conn.peer);
            return;
          }

          console.log(`[SessionManager] Attendee disconnected: ${conn.peer}`);
          this.connectionStates.set(conn.peer, 'disconnected');
          this.challengedConnections.delete(conn.peer);

          const attendee = this.attendees.get(conn.peer);
          if (attendee) {
            const updatedAttendee: AttendeeInfo = {
              ...attendee,
              connectionState: 'disconnected',
            };
            this.attendees.set(conn.peer, updatedAttendee);
            this.notifyAttendeeListUpdate();
          }

          this.connections.delete(conn.peer);
          // Don't immediately delete attendee - allow for reconnection
          setTimeout(() => {
            if (this.connectionStates.get(conn.peer) === 'disconnected') {
              console.log(`[SessionManager] Removing attendee after grace period: ${conn.peer}`);
              this.attendees.delete(conn.peer);
              this.connectionStates.delete(conn.peer);
              this.lastHeartbeat.delete(conn.peer);
              this.heartbeatSentTimes.delete(conn.peer);

              if (this.handRaises.has(conn.peer)) {
                this.handRaises.delete(conn.peer);
                this.notifyHandRaiseUpdate();
              }

              this.notifyAttendeeListUpdate();
            }
          }, 30000);
        });

        conn.on('error', (err) => {
          console.error(`[SessionManager] Connection error with ${conn.peer}:`, err);

          // Clean up pending state (C1)
          if (this.pendingConnections.has(conn.peer)) {
            clearTimeout(handshakeTimeout);
            this.pendingConnections.delete(conn.peer);
            this.challengedConnections.delete(conn.peer);
            return;
          }

          this.connectionStates.set(conn.peer, 'failed');
          this.challengedConnections.delete(conn.peer);

          const attendee = this.attendees.get(conn.peer);
          if (attendee) {
            const updatedAttendee: AttendeeInfo = {
              ...attendee,
              connectionState: 'failed',
            };
            this.attendees.set(conn.peer, updatedAttendee);
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
   * @param sessionPublicKey - Presenter's ECDSA public key from the join code (required)
   * @param peerjsConfig - PeerJS server configuration
   */
  async joinSession(
    sessionId: string,
    mode: 'guided' | 'follow',
    name: string | undefined,
    sessionPublicKey: string,
    peerjsConfig?: PeerJSConfig
  ): Promise<void> {
    try {
      this.role = 'attendee';
      this.sessionId = sessionId;

      // Use provided config or defaults
      const peerConfig = peerjsConfig || { host: 'localhost', port: 9000, key: 'pathfinder', secure: false };
      this.peerjsConfig = peerConfig;

      console.log(`[SessionManager] Joining session: ${sessionId}`);
      console.log(`[SessionManager] Using PeerJS server: ${peerConfig.host}:${peerConfig.port}/pathfinder`);

      // Create a peer for this attendee
      this.peer = new Peer({
        host: peerConfig.host,
        port: peerConfig.port,
        path: '/pathfinder',
        key: peerConfig.key,
        secure: peerConfig.secure,
        debug: 2,
      });

      // Wait for peer to be ready
      await new Promise<void>((resolve, reject) => {
        if (!this.peer) {
          reject(new Error('Peer not initialized'));
          return;
        }

        this.peer.on('open', (id) => {
          console.log(`[SessionManager] Attendee peer ready: ${id}`);
          resolve();
        });

        this.peer.on('error', (err) => {
          console.error('[SessionManager] Peer error:', err);
          reject(err);
        });

        setTimeout(() => reject(new Error('Peer connection timeout')), 10000);
      });

      // Connect to presenter
      const conn = this.peer!.connect(sessionId, {
        reliable: true,
      });

      // Phase 1: wait for the WebRTC data channel to open
      await new Promise<void>((resolve, reject) => {
        conn.on('open', resolve);
        conn.on('error', (err) => {
          console.error('[SessionManager] Failed to connect:', err);
          reject(err);
        });
        setTimeout(() => reject(new Error('Connection timeout')), 10000);
      });

      console.log(`[SessionManager] Connected to presenter: ${sessionId}`);

      // Phase 2: challenge-response — verifies the presenter holds the private key matching the join code
      await new Promise<void>((resolve, reject) => {
        let challengeTimeout: ReturnType<typeof setTimeout> | null = null;
        let verified = false;
        let verifying = false; // synchronous guard — prevents concurrent verify calls (C3)

        const challengeNonce = generateNonce();
        conn.send({ type: 'presenter_challenge', nonce: challengeNonce });

        challengeTimeout = setTimeout(() => {
          conn.close();
          reject(new Error('Presenter identity verification timed out'));
        }, 10000);

        conn.on('data', async (data: any) => {
          if (!verified && !verifying && data.type === 'presenter_response') {
            verifying = true; // synchronous guard set before any await (C3)
            if (challengeTimeout !== null) {
              clearTimeout(challengeTimeout);
              challengeTimeout = null;
            }

            const valid = await verifyChallenge(sessionPublicKey, challengeNonce, data.signature);
            if (!valid) {
              conn.close();
              reject(new Error('Presenter identity verification failed'));
              return;
            }

            verified = true;

            // Send join message now that the presenter's identity is confirmed
            conn.send({
              type: 'attendee_join',
              name: name || 'Anonymous',
              mode,
              timestamp: Date.now(),
            });

            resolve();
            return;
          }

          // S1: drop all events until handshake is complete
          if (!verified) {
            return;
          }

          // Regular event handling (post-verification)
          console.log('[SessionManager] Received event from presenter:', data);

          if (data.type === 'heartbeat') {
            conn.send({
              type: 'heartbeat',
              sessionId: this.sessionId || '',
              timestamp: Date.now(),
              senderId: 'attendee',
              sentAt: data.sentAt,
            });
            this.lastHeartbeat.set(sessionId, Date.now());
          }

          this.eventHandlers.forEach((handler) => handler(data));
        });

        conn.on('close', () => {
          // S4: reject immediately if connection drops before handshake completes
          if (!verified) {
            if (challengeTimeout !== null) {
              clearTimeout(challengeTimeout);
              challengeTimeout = null;
            }
            reject(new Error('Connection closed before presenter identity verification completed'));
            return;
          }
          console.log('[SessionManager] Disconnected from presenter');
          this.handleError({
            code: 'CONNECTION_FAILED',
            message: 'Connection to presenter lost',
            details: null,
          });
        });

        conn.on('error', (err) => {
          console.error('[SessionManager] Connection error:', err);
          this.handleError({
            code: 'CONNECTION_FAILED',
            message: 'Connection error',
            details: err,
          });
        });
      });

      // Store connection after handshake completes
      this.connections.set(sessionId, conn);

      console.log(`[SessionManager] Successfully joined session`);
    } catch (error) {
      console.error('[SessionManager] Failed to join session:', error);
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
      console.warn('[SessionManager] Only presenter can broadcast to attendees');
      return;
    }

    console.log(`[SessionManager] Broadcasting event to ${this.connections.size} attendees:`, event);

    this.connections.forEach((conn, peerId) => {
      try {
        if (conn.open) {
          conn.send(event);
        } else {
          console.warn(`[SessionManager] Connection to ${peerId} is not open`);
        }
      } catch (error) {
        console.error(`[SessionManager] Failed to send to ${peerId}:`, error);
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
      console.warn('[SessionManager] Can only send to presenter as attendee');
      return;
    }

    const conn = this.connections.get(this.sessionId);
    if (conn && conn.open) {
      conn.send(event);
    } else {
      console.error('[SessionManager] No connection to presenter');
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
    console.log(`[SessionManager] Notifying attendee list update (${attendeeList.length} attendees)`);

    this.attendeeUpdateHandlers.forEach((handler) => {
      try {
        handler(attendeeList);
      } catch (error) {
        console.error('[SessionManager] Error in attendee update handler:', error);
      }
    });
  }

  /**
   * Get list of attendees (presenter only)
   */
  getAttendees(): AttendeeInfo[] {
    const attendeeList = Array.from(this.attendees.values());
    console.log('[SessionManager] getAttendees() called, returning:', attendeeList);
    console.log('[SessionManager] Internal attendees Map size:', this.attendees.size);
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
      } catch (error) {
        console.error('[SessionManager] Error in hand raise update handler:', error);
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
    console.log(`[SessionManager] Ending session (role: ${this.role})`);

    // If attendee, send leave event to presenter before disconnecting
    if (this.role === 'attendee' && this.sessionId) {
      const presenterConn = this.connections.get(this.sessionId);
      if (presenterConn && presenterConn.open) {
        try {
          console.log('[SessionManager] Attendee sending leave event to presenter');
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
        } catch (error) {
          console.error('[SessionManager] Error sending leave event:', error);
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
        } catch (error) {
          console.error(`[SessionManager] Error closing connection to ${peerId}:`, error);
        }
      });
    }

    this.connections.clear();
    this.pendingConnections.clear();
    this.challengedConnections.clear();
    this.attendees.clear();

    // Destroy peer
    if (this.peer && !this.peer.destroyed) {
      this.peer.destroy();
    }

    this.peer = null;
    this.sessionId = null;
    this.role = null;
    this.config = null;
    this.sessionPrivateKey = null;

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

    console.log('[SessionManager] Starting heartbeat mechanism');

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
              console.warn(`[SessionManager] No heartbeat from ${peerId} for ${timeSinceLastHeartbeat}ms`);

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
          } catch (error) {
            console.error(`[SessionManager] Failed to send heartbeat to ${peerId}:`, error);
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
      console.log('[SessionManager] Stopping heartbeat mechanism');
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
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    // Minor modular bias (256 % 36 = 4) is acceptable for a peer ID
    return Array.from(bytes, (b) => chars[b % chars.length]).join('');
  }

  /**
   * Generate join URL with session information
   */
  private generateJoinUrl(joinCode: string): string {
    const base = window.location.origin;
    const params = new URLSearchParams({
      session: joinCode,
    });

    return `${base}/a/grafana-grafanadocsplugin-app?${params.toString()}`;
  }

  /**
   * Handle errors
   */
  private handleError(error: SessionError): void {
    console.error('[SessionManager] Error:', error);
    this.errorHandlers.forEach((handler) => handler(error));
  }
}
