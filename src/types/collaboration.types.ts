/**
 * Type definitions for Collaborative Live Learning Sessions
 * 
 * This module defines all TypeScript interfaces and types used in the P2P
 * collaborative learning feature where presenters can broadcast their actions
 * to attendees in real-time.
 */

// ============================================================================
// Core Session Types
// ============================================================================

/**
 * Attendee mode determines how they interact with presenter's actions
 */
export type AttendeeMode = 'guided' | 'follow';

/**
 * User's role in the session
 */
export type SessionRole = 'presenter' | 'attendee' | null;

/**
 * WebRTC connection state for monitoring
 */
export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'failed';

// ============================================================================
// Session Configuration
// ============================================================================

/**
 * Configuration for creating a new session
 */
export interface SessionConfig {
  /** Display name of the session */
  name: string;
  /** URL of the tutorial being presented */
  tutorialUrl: string;
  /** Default mode for new attendees */
  defaultMode: AttendeeMode;
}

/**
 * WebRTC offer created by presenter and shared with attendees
 */
export interface SessionOffer {
  /** Unique session identifier */
  id: string;
  /** Display name of the session */
  name: string;
  /** Tutorial URL for the session */
  tutorialUrl: string;
  /** Default attendee mode */
  defaultMode: AttendeeMode;
  /** WebRTC SDP offer */
  offer: RTCSessionDescriptionInit;
  /** Creation timestamp */
  timestamp: number;
}

/**
 * WebRTC answer created by attendee in response to presenter's offer
 */
export interface SessionAnswer {
  /** Unique attendee identifier */
  attendeeId: string;
  /** Attendee's chosen mode */
  mode: AttendeeMode;
  /** WebRTC SDP answer */
  answer: RTCSessionDescriptionInit;
  /** Optional attendee name */
  name?: string;
}

/**
 * Information about a created session returned to presenter
 */
export interface SessionInfo {
  /** Unique session identifier */
  sessionId: string;
  /** Short join code for attendees */
  joinCode: string;
  /** Shareable URL */
  joinUrl: string;
  /** QR code data URL */
  qrCode: string;
  /** Session configuration */
  config: SessionConfig;
}

// ============================================================================
// Event Protocol
// ============================================================================

/**
 * Base interface for all session events
 */
export interface SessionEvent {
  /** Event type identifier */
  type: string;
  /** Session this event belongs to */
  sessionId: string;
  /** Timestamp when event was created */
  timestamp: number;
  /** ID of the sender (presenter or attendee) */
  senderId: string;
}

/**
 * Event for navigation to different tutorial or step
 */
export interface NavigationEvent extends SessionEvent {
  type: 'navigation';
  /** URL of the tutorial */
  tutorialUrl: string;
  /** Optional step number within tutorial */
  stepNumber?: number;
}

/**
 * Details about an interactive action
 */
export interface InteractiveAction {
  /** Type of action (button, highlight, formfill, navigate, multistep) */
  targetAction: 'button' | 'highlight' | 'formfill' | 'navigate' | 'hover' | 'multistep';
  /** CSS selector or button text to target */
  refTarget: string;
  /** Optional value for form fills */
  targetValue?: string;
  /** Optional comment to display in tooltip */
  targetComment?: string;
  /** For multistep: array of internal actions to execute in sequence */
  internalActions?: Array<{
    targetAction: string;
    refTarget?: string;
    targetValue?: string;
    requirements?: string;
  }>;
}

/**
 * Event for interactive step actions (Show Me / Do It)
 */
export interface InteractiveStepEvent extends SessionEvent {
  type: 'show_me' | 'do_it';
  /** Unique step identifier */
  stepId: string;
  /** Action details */
  action: InteractiveAction;
  /** Optional screen coordinates for positioning */
  coordinates?: {
    x: number;
    y: number;
  };
}

/**
 * Event for chat messages
 */
export interface ChatEvent extends SessionEvent {
  type: 'chat_message';
  /** Display name of sender */
  senderName: string;
  /** Message content */
  message: string;
}

/**
 * Event for session control (pause, resume, end)
 */
export interface ControlEvent extends SessionEvent {
  type: 'pause' | 'resume' | 'end';
  /** Optional message explaining the control action */
  message?: string;
}

/**
 * Event for attendee status updates
 */
export interface StatusEvent extends SessionEvent {
  type: 'attendee_status';
  /** Status type */
  status: 'joined' | 'left' | 'mode_changed' | 'error';
  /** Current step number if available */
  currentStep?: number;
  /** New mode if mode changed */
  mode?: AttendeeMode;
  /** Error message if status is error */
  error?: string;
}

/**
 * Event sent when a session starts (presenter → attendee)
 */
export interface SessionStartEvent extends SessionEvent {
  type: 'session_start';
  /** Session configuration */
  config: SessionConfig;
}

/**
 * Event sent when a session ends (presenter → attendees)
 */
export interface SessionEndEvent extends SessionEvent {
  type: 'session_end';
  /** Optional reason for ending */
  reason?: string;
}

/**
 * Event sent when an attendee joins (attendee → presenter)
 */
export interface AttendeeJoinEvent extends SessionEvent {
  type: 'attendee_join';
  /** Attendee name */
  name: string;
  /** Attendee mode */
  mode: AttendeeMode;
}

/**
 * Event sent when an attendee leaves (attendee → presenter)
 */
export interface AttendeeLeaveEvent extends SessionEvent {
  type: 'attendee_leave';
}

/**
 * Event sent when mode changes (attendee → presenter)
 */
export interface ModeChangeEvent extends SessionEvent {
  type: 'mode_change';
  /** New mode */
  mode: AttendeeMode;
}

/**
 * Event for syncing state (presenter → attendees)
 */
export interface SyncStateEvent extends SessionEvent {
  type: 'sync_state';
  /** Current tutorial URL */
  tutorialUrl: string;
  /** Current step number */
  stepNumber: number;
}

/**
 * Heartbeat event for connection health monitoring
 */
export interface HeartbeatEvent extends SessionEvent {
  type: 'heartbeat';
  /** Timestamp when heartbeat was sent */
  sentAt: number;
}

/**
 * Union type of all possible session events
 */
export type AnySessionEvent =
  | NavigationEvent
  | InteractiveStepEvent
  | ChatEvent
  | ControlEvent
  | StatusEvent
  | SessionStartEvent
  | SessionEndEvent
  | AttendeeJoinEvent
  | AttendeeLeaveEvent
  | ModeChangeEvent
  | SyncStateEvent
  | HeartbeatEvent;

// ============================================================================
// Attendee & Connection Management
// ============================================================================

/**
 * Connection quality metrics for monitoring
 */
export interface ConnectionQuality {
  /** Round-trip latency in milliseconds */
  latency: number;
  /** Number of packets lost */
  packetsLost: number;
  /** Timestamp of last successful heartbeat */
  lastHeartbeat: number;
  /** Overall connection quality rating */
  quality: 'excellent' | 'good' | 'poor' | 'disconnected';
}

/**
 * Information about a connected attendee
 */
export interface AttendeeInfo {
  /** Unique attendee identifier */
  id: string;
  /** Optional display name */
  name?: string;
  /** Current mode */
  mode: AttendeeMode;
  /** Connection state */
  connectionState: ConnectionState;
  /** Connection quality metrics */
  connectionQuality?: ConnectionQuality;
  /** When they joined */
  joinedAt: number;
  /** Current step number if available */
  currentStep?: number;
}

/**
 * Statistics about a peer connection
 */
export interface ConnectionStats {
  /** Round trip time in milliseconds */
  rtt?: number;
  /** Bytes sent */
  bytesSent: number;
  /** Bytes received */
  bytesReceived: number;
  /** Current connection state */
  state: ConnectionState;
}

// ============================================================================
// Session Recording
// ============================================================================

/**
 * Recorded session that can be played back or converted to tutorial
 */
export interface SessionRecording {
  /** Unique recording identifier */
  id: string;
  /** Session name */
  name: string;
  /** Presenter information */
  presenter: {
    id: string;
    name?: string;
  };
  /** Tutorial URL */
  tutorialUrl: string;
  /** Total duration in milliseconds */
  duration: number;
  /** When recorded */
  recordedAt: string;
  /** All events that occurred */
  events: AnySessionEvent[];
  /** Chat messages */
  chat: ChatEvent[];
  /** Attendee information */
  attendees: Array<{
    id: string;
    name?: string;
    joinedAt: number;
    leftAt?: number;
  }>;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Errors that can occur during session operations
 */
export interface SessionError {
  /** Error code */
  code: 
    | 'CONNECTION_FAILED' 
    | 'INVALID_CODE' 
    | 'EXPIRED_SESSION' 
    | 'STATE_DIVERGENCE'
    | 'RECONNECTING'
    | 'PRESENTER_DISCONNECTED'
    | 'UNKNOWN';
  /** Human-readable error message */
  message: string;
  /** Optional details for debugging */
  details?: any;
  /** Indicates if reconnection is possible */
  canRetry?: boolean;
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Callback function type for event handlers
 */
export type EventCallback = (event: AnySessionEvent) => void;

/**
 * Callback function type for connection state changes
 */
export type ConnectionStateCallback = (attendeeId: string, state: ConnectionState) => void;

/**
 * Callback function type for error handling
 */
export type ErrorCallback = (error: SessionError) => void;

