/**
 * Workshop Integration Module
 * Centralized exports for collaborative learning session system
 */

// Session management core
export { SessionManager } from './session-manager';
export type { PeerJSConfig } from './session-manager';

// Session state and React hooks
export { SessionProvider, useSession, useIsSessionActive, useSessionRole, useSessionManager } from './session-state';

// Action capture and replay systems
export { ActionCaptureSystem } from './action-capture';
export { ActionReplaySystem } from './action-replay';

// Reconnection management
export { ReconnectionManager } from './reconnection-manager';
export type { ReconnectionConfig } from './reconnection-manager';

// Join code utilities
export {
  generateJoinCode,
  parseJoinCode,
  generateJoinUrl,
  parseSessionFromUrl,
  generateAnswerCode,
  parseAnswerCode,
  generateSessionId,
  generateAttendeeId,
  isValidJoinCode,
} from './join-code-utils';
