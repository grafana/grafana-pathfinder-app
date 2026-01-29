/**
 * useRecordingState Hook
 *
 * Pure state management for recording sessions.
 * No side effects or dependencies on other hooks.
 *
 * Part of the three-layer recording architecture:
 * 1. useRecordingState - pure state (this hook)
 * 2. useRecordingPersistence - reads state, provides clear callback
 * 3. useRecordingActions - receives state and clear callback
 */

import { useState, useCallback } from 'react';
import type { RecordedStep } from '../../../utils/devtools';

/**
 * State for recording into a conditional branch.
 */
export interface ConditionalRecordingTarget {
  conditionalId: string;
  branch: 'whenTrue' | 'whenFalse';
}

/**
 * Recording state that can be persisted and restored.
 */
export interface RecordingStateSnapshot {
  recordingIntoSection: string | null;
  recordingIntoConditionalBranch: ConditionalRecordingTarget | null;
  recordingStartUrl: string | null;
  recordedSteps: RecordedStep[];
}

/**
 * Return type for useRecordingState hook.
 */
export interface UseRecordingStateReturn {
  // State
  recordingIntoSection: string | null;
  recordingIntoConditionalBranch: ConditionalRecordingTarget | null;
  recordingStartUrl: string | null;
  isRecording: boolean;
  // Setters
  setRecordingIntoSection: (sectionId: string | null) => void;
  setRecordingIntoConditionalBranch: (target: ConditionalRecordingTarget | null) => void;
  setRecordingStartUrl: (url: string | null) => void;
  // Actions
  reset: () => void;
  restore: (snapshot: Omit<RecordingStateSnapshot, 'recordedSteps'>) => void;
}

/**
 * Pure state management for recording sessions.
 * No side effects or dependencies on other hooks.
 */
export function useRecordingState(): UseRecordingStateReturn {
  const [recordingIntoSection, setRecordingIntoSection] = useState<string | null>(null);
  const [recordingIntoConditionalBranch, setRecordingIntoConditionalBranch] =
    useState<ConditionalRecordingTarget | null>(null);
  const [recordingStartUrl, setRecordingStartUrl] = useState<string | null>(null);

  const isRecording = recordingIntoSection !== null || recordingIntoConditionalBranch !== null;

  const reset = useCallback(() => {
    setRecordingIntoSection(null);
    setRecordingIntoConditionalBranch(null);
    setRecordingStartUrl(null);
  }, []);

  const restore = useCallback((snapshot: Omit<RecordingStateSnapshot, 'recordedSteps'>) => {
    setRecordingIntoSection(snapshot.recordingIntoSection);
    setRecordingIntoConditionalBranch(snapshot.recordingIntoConditionalBranch);
    setRecordingStartUrl(snapshot.recordingStartUrl);
  }, []);

  return {
    // State
    recordingIntoSection,
    recordingIntoConditionalBranch,
    recordingStartUrl,
    isRecording,
    // Setters
    setRecordingIntoSection,
    setRecordingIntoConditionalBranch,
    setRecordingStartUrl,
    // Actions
    reset,
    restore,
  };
}

export type RecordingState = ReturnType<typeof useRecordingState>;
