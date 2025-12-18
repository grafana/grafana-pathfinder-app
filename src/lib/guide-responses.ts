/**
 * Guide Response Storage
 *
 * Manages storage and retrieval of user responses from input blocks.
 * Responses are persisted to localStorage and can be used:
 * - As requirements (e.g., "var-policyAccepted:true")
 * - As variable substitution in content (e.g., "{{datasourceName}}")
 * - As targetvalue in interactive blocks
 */

/** Supported response value types */
export type ResponseValue = string | boolean | number;

/** Storage key prefix for guide responses */
const STORAGE_PREFIX = 'pathfinder-response';

/**
 * Build a localStorage key for a guide response
 */
function buildStorageKey(guideId: string, variableName: string): string {
  return `${STORAGE_PREFIX}:${guideId}:${variableName}`;
}

/**
 * Parse a stored value from JSON, handling type preservation
 */
function parseStoredValue(value: string | null): ResponseValue | undefined {
  if (value === null) {
    return undefined;
  }
  try {
    return JSON.parse(value) as ResponseValue;
  } catch {
    // If JSON parse fails, return as string
    return value;
  }
}

/**
 * Serialize a value for storage
 */
function serializeValue(value: ResponseValue): string {
  return JSON.stringify(value);
}

/**
 * Guide Response Store
 *
 * Provides methods for storing and retrieving user responses.
 * All operations are synchronous since localStorage is synchronous.
 */
export const guideResponseStore = {
  /**
   * Store a response value for a guide variable
   */
  setResponse(guideId: string, variableName: string, value: ResponseValue): void {
    const key = buildStorageKey(guideId, variableName);
    try {
      localStorage.setItem(key, serializeValue(value));
    } catch (error) {
      console.warn('[GuideResponses] Failed to store response:', error);
    }
  },

  /**
   * Get a response value for a guide variable
   */
  getResponse(guideId: string, variableName: string): ResponseValue | undefined {
    const key = buildStorageKey(guideId, variableName);
    try {
      return parseStoredValue(localStorage.getItem(key));
    } catch (error) {
      console.warn('[GuideResponses] Failed to get response:', error);
      return undefined;
    }
  },

  /**
   * Check if a response exists for a guide variable
   */
  hasResponse(guideId: string, variableName: string): boolean {
    const key = buildStorageKey(guideId, variableName);
    try {
      return localStorage.getItem(key) !== null;
    } catch {
      return false;
    }
  },

  /**
   * Delete a response for a guide variable
   */
  deleteResponse(guideId: string, variableName: string): void {
    const key = buildStorageKey(guideId, variableName);
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.warn('[GuideResponses] Failed to delete response:', error);
    }
  },

  /**
   * Get all responses for a guide as a key-value object
   */
  getAllResponses(guideId: string): Record<string, ResponseValue> {
    const responses: Record<string, ResponseValue> = {};
    const prefix = `${STORAGE_PREFIX}:${guideId}:`;

    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(prefix)) {
          const variableName = key.slice(prefix.length);
          const value = parseStoredValue(localStorage.getItem(key));
          if (value !== undefined) {
            responses[variableName] = value;
          }
        }
      }
    } catch (error) {
      console.warn('[GuideResponses] Failed to get all responses:', error);
    }

    return responses;
  },

  /**
   * Clear all responses for a guide
   */
  clearResponses(guideId: string): void {
    const prefix = `${STORAGE_PREFIX}:${guideId}:`;
    const keysToRemove: string[] = [];

    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(prefix)) {
          keysToRemove.push(key);
        }
      }

      keysToRemove.forEach((key) => localStorage.removeItem(key));
    } catch (error) {
      console.warn('[GuideResponses] Failed to clear responses:', error);
    }
  },

  /**
   * Clear all guide responses (across all guides)
   */
  clearAllResponses(): void {
    const keysToRemove: string[] = [];

    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(STORAGE_PREFIX)) {
          keysToRemove.push(key);
        }
      }

      keysToRemove.forEach((key) => localStorage.removeItem(key));
    } catch (error) {
      console.warn('[GuideResponses] Failed to clear all responses:', error);
    }
  },
};

/**
 * Get the storage key prefix (useful for debugging)
 */
export function getStoragePrefix(): string {
  return STORAGE_PREFIX;
}

