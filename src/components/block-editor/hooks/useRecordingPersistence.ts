/**
 * useRecordingPersistence Hook
 *
 * Persists recording mode state to localStorage so recording survives page refreshes.
 * This is essential when actions like saving a dashboard cause Grafana to reload.
 */

import { useEffect, useCallback, useRef } from 'react';
import { RECORDING_STATE_STORAGE_KEY } from '../constants';
import type { RecordedStep } from '../../../utils/devtools/tutorial-exporter';

/**
 * State that needs to be persisted for recording mode
 */
export interface PersistedRecordingState {
  /** ID of section being recorded into (null if not recording) */
  recordingIntoSection: string | null;
  /** Conditional branch being recorded into */
  recordingIntoConditionalBranch: {
    conditionalId: string;
    branch: 'whenTrue' | 'whenFalse';
  } | null;
  /** URL where recording started */
  recordingStartUrl: string | null;
  /** Steps recorded so far */
  recordedSteps: RecordedStep[];
  /** Timestamp when state was persisted */
  savedAt: string;
}

/**
 * Hook options
 */
export interface UseRecordingPersistenceOptions {
  /** Current recording section ID */
  recordingIntoSection: string | null;
  /** Current conditional branch being recorded */
  recordingIntoConditionalBranch: {
    conditionalId: string;
    branch: 'whenTrue' | 'whenFalse';
  } | null;
  /** URL where recording started */
  recordingStartUrl: string | null;
  /** Current recorded steps from action recorder */
  recordedSteps: RecordedStep[];
  /** Called when recording state should be restored */
  onRestore?: (state: PersistedRecordingState) => void;
}

/**
 * Hook return type
 */
export interface UseRecordingPersistenceReturn {
  /** Check if there's persisted recording state */
  hasPersistedState: () => boolean;
  /** Load persisted state (returns null if none exists) */
  load: () => PersistedRecordingState | null;
  /** Clear persisted state */
  clear: () => void;
  /** Force save current state */
  save: () => void;
}

/**
 * Hook for persisting recording mode state across page refreshes
 */
export function useRecordingPersistence({
  recordingIntoSection,
  recordingIntoConditionalBranch,
  recordingStartUrl,
  recordedSteps,
  onRestore,
}: UseRecordingPersistenceOptions): UseRecordingPersistenceReturn {
  const hasRestoredRef = useRef(false);
  const isRecording = recordingIntoSection !== null || recordingIntoConditionalBranch !== null;

  // Save recording state to localStorage
  const save = useCallback(() => {
    // Only save if actively recording
    if (!isRecording) {
      return;
    }

    try {
      const state: PersistedRecordingState = {
        recordingIntoSection,
        recordingIntoConditionalBranch,
        recordingStartUrl,
        recordedSteps,
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem(RECORDING_STATE_STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.error('Failed to save recording state to localStorage:', e);
    }
  }, [isRecording, recordingIntoSection, recordingIntoConditionalBranch, recordingStartUrl, recordedSteps]);

  // Load recording state from localStorage
  const load = useCallback((): PersistedRecordingState | null => {
    try {
      const stored = localStorage.getItem(RECORDING_STATE_STORAGE_KEY);
      if (!stored) {
        return null;
      }
      return JSON.parse(stored) as PersistedRecordingState;
    } catch (e) {
      console.error('Failed to load recording state from localStorage:', e);
      return null;
    }
  }, []);

  // Clear persisted state
  const clear = useCallback(() => {
    try {
      localStorage.removeItem(RECORDING_STATE_STORAGE_KEY);
    } catch (e) {
      console.error('Failed to clear recording state from localStorage:', e);
    }
  }, []);

  // Check if there's persisted state
  const hasPersistedState = useCallback((): boolean => {
    try {
      return localStorage.getItem(RECORDING_STATE_STORAGE_KEY) !== null;
    } catch {
      return false;
    }
  }, []);

  // Restore state on mount (only once)
  useEffect(() => {
    if (hasRestoredRef.current) {
      return;
    }

    const persisted = load();
    if (persisted && onRestore) {
      hasRestoredRef.current = true;
      onRestore(persisted);
    }
  }, [load, onRestore]);

  // Auto-save when recording state changes
  useEffect(() => {
    if (isRecording) {
      save();
    }
  }, [isRecording, recordingIntoSection, recordingIntoConditionalBranch, recordingStartUrl, recordedSteps, save]);

  // Clear persisted state when recording stops
  useEffect(() => {
    if (!isRecording && hasRestoredRef.current) {
      // Only clear if we're not in the middle of restoring
      // Check if there's still persisted state - if so, we haven't finished restoring
      const persisted = load();
      if (!persisted) {
        // Recording truly stopped, nothing to clear
        return;
      }
      // If we were recording and stopped, clear the persisted state
      // But only after restoration is complete
    }
  }, [isRecording, load]);

  return {
    hasPersistedState,
    load,
    clear,
    save,
  };
}
