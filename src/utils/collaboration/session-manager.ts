/**
 * Session Manager for Collaborative Live Learning
 * 
 * Manages P2P connections using PeerJS for simplified signaling
 */

import Peer, { DataConnection } from 'peerjs';
import type {
  SessionConfig,
  SessionInfo,
  AttendeeInfo,
  SessionRole,
  AnySessionEvent,
  SessionError
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
  
  // Attendee tracking (for presenter)
  private attendees: Map<string, AttendeeInfo> = new Map();
  
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
      
      // Set up connection handler for incoming attendees
      this.setupPresenterConnectionHandler();
      
      // Generate join URL with session info
      const joinUrl = this.generateJoinUrl(peerId, config.name, config.tutorialUrl);
      
      // Generate QR code for the join URL
      let qrCode = '';
      try {
        const QRCode = await import('qrcode');
        qrCode = await QRCode.default.toDataURL(joinUrl, {
          width: 300,
          margin: 2,
          errorCorrectionLevel: 'M'
        });
      } catch (error) {
        console.error('[SessionManager] Failed to generate QR code:', error);
        // Non-fatal - continue without QR code
      }
      
      console.log(`[SessionManager] Session created: ${peerId}`);
      
      // Create a join code that includes session metadata
      const joinCodeData = {
        id: peerId,
        name: config.name,
        url: config.tutorialUrl
      };
      const joinCode = btoa(JSON.stringify(joinCodeData));
      
      return {
        sessionId: peerId,
        joinCode, // Base64 encoded session info
        joinUrl,
        qrCode,
        config
      };
    } catch (error) {
      console.error('[SessionManager] Failed to create session:', error);
      this.handleError({
        code: 'CONNECTION_FAILED',
        message: 'Failed to create session',
        details: error
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
      
      // Wait for connection to open
      conn.on('open', () => {
        console.log(`[SessionManager] Attendee connected: ${conn.peer}`);
        
        // Store connection
        this.connections.set(conn.peer, conn);
        
        // Get attendee metadata from first message
        conn.on('data', (data: any) => {
          if (data.type === 'attendee_join') {
            const attendee: AttendeeInfo = {
              id: conn.peer,
              name: data.name || 'Anonymous',
              mode: data.mode || 'guided',
              connectionState: 'connected',
              joinedAt: Date.now()
            };
            
            this.attendees.set(conn.peer, attendee);
            
            // Notify handlers
            this.attendeeHandlers.forEach(handler => handler(attendee));
            
            // Send welcome message
            conn.send({
              type: 'session_start',
              sessionId: this.sessionId,
              config: this.config,
              timestamp: Date.now()
            });
          } else if (data.type === 'mode_change') {
            // Handle mode change from attendee
            const attendee = this.attendees.get(conn.peer);
            if (attendee) {
              console.log(`[SessionManager] Attendee ${conn.peer} changed mode to ${data.mode}`);
              // Create new object to trigger React re-render
              const updatedAttendee: AttendeeInfo = {
                ...attendee,
                mode: data.mode
              };
              this.attendees.set(conn.peer, updatedAttendee);
            }
            // Forward event to handlers
            this.eventHandlers.forEach(handler => handler(data));
          } else {
            // Forward other events to handlers
            this.eventHandlers.forEach(handler => handler(data));
          }
        });
        
        // Handle disconnection
        conn.on('close', () => {
          console.log(`[SessionManager] Attendee disconnected: ${conn.peer}`);
          this.connections.delete(conn.peer);
          this.attendees.delete(conn.peer);
        });
        
        conn.on('error', (err) => {
          console.error(`[SessionManager] Connection error with ${conn.peer}:`, err);
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
      
      console.log(`[SessionManager] Joining session: ${sessionId}`);
      console.log(`[SessionManager] Using PeerJS server: ${peerConfig.host}:${peerConfig.port}/pathfinder`);
      
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
        reliable: true
      });
      
      // Wait for connection to open
      await new Promise<void>((resolve, reject) => {
        conn.on('open', () => {
          console.log(`[SessionManager] Connected to presenter: ${sessionId}`);
          
          // Send join message
          conn.send({
            type: 'attendee_join',
            name: name || 'Anonymous',
            mode,
            timestamp: Date.now()
          });
          
          // Store connection
          this.connections.set(sessionId, conn);
          
          // Set up event handler
          conn.on('data', (data: any) => {
            console.log('[SessionManager] Received event from presenter:', data);
            this.eventHandlers.forEach(handler => handler(data));
          });
          
          conn.on('close', () => {
            console.log('[SessionManager] Disconnected from presenter');
            this.handleError({
              code: 'CONNECTION_FAILED',
              message: 'Connection to presenter lost',
              details: null
            });
          });
          
          conn.on('error', (err) => {
            console.error('[SessionManager] Connection error:', err);
            this.handleError({
              code: 'CONNECTION_FAILED',
              message: 'Connection error',
              details: err
            });
          });
          
          resolve();
        });
        
        conn.on('error', (err) => {
          console.error('[SessionManager] Failed to connect:', err);
          reject(err);
        });
        
        setTimeout(() => reject(new Error('Connection timeout')), 10000);
      });
      
      console.log(`[SessionManager] Successfully joined session`);
    } catch (error) {
      console.error('[SessionManager] Failed to join session:', error);
      this.handleError({
        code: 'CONNECTION_FAILED',
        message: 'Failed to join session',
        details: error
      });
      throw error;
    }
  }
  
  // ============================================================================
  // Event Broadcasting
  // ============================================================================
  
  /**
   * Broadcast an event to all connected peers
   * 
   * @param event - Event to broadcast
   */
  broadcastEvent(event: AnySessionEvent): void {
    if (this.role !== 'presenter') {
      console.warn('[SessionManager] Only presenter can broadcast events');
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
   * Get list of attendees (presenter only)
   */
  getAttendees(): AttendeeInfo[] {
    const attendeeList = Array.from(this.attendees.values());
    console.log('[SessionManager] getAttendees() called, returning:', attendeeList);
    console.log('[SessionManager] Internal attendees Map size:', this.attendees.size);
    return attendeeList;
  }
  
  // ============================================================================
  // Session Management
  // ============================================================================
  
  /**
   * End the session and close all connections
   */
  endSession(): void {
    console.log('[SessionManager] Ending session');
    
    // Close all connections
    this.connections.forEach((conn, peerId) => {
      try {
        if (conn.open) {
          conn.send({
            type: 'session_end',
            sessionId: this.sessionId,
            timestamp: Date.now()
          });
        }
        conn.close();
      } catch (error) {
        console.error(`[SessionManager] Error closing connection to ${peerId}:`, error);
      }
    });
    
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
      session: peerId
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
  private handleError(error: SessionError): void {
    console.error('[SessionManager] Error:', error);
    this.errorHandlers.forEach(handler => handler(error));
  }
}
