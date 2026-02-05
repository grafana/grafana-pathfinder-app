/**
 * Auth Module Index
 *
 * Re-exports all auth-related types and functions for convenient importing.
 *
 * @example
 * ```typescript
 * import {
 *   createAuthContext,
 *   pluginE2EAuthStrategy,
 *   isSessionValid,
 *   type AuthStrategy,
 * } from '../auth';
 * ```
 */

export {
  // Types
  type AuthResult,
  type AuthStrategy,
  type AuthContext,
  type SessionValidationResult,

  // Default strategy
  pluginE2EAuthStrategy,

  // Factory functions
  createAuthContext,
  getDefaultAuthStrategy,

  // Utility functions
  isSessionValid,
  validateSessionDetailed,
} from './grafana-auth';
