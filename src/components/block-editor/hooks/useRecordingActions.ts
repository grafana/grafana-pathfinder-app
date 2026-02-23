/**
 * useRecordingActions Hook
 *
 * Actions for controlling recording sessions.
 * Receives state from useRecordingState and clear callback from persistence.
 *
 * Part of the three-layer recording architecture:
 * 1. useRecordingState - pure state
 * 2. useRecordingPersistence - reads state, provides clear callback
 * 3. useRecordingActions - receives state and clear callback (this hook)
 */

import { useCallback, useEffect, useRef } from 'react';
import type { JsonBlock } from '../types';
import type { RecordedStep } from '../../../utils/devtools';
import type { RecordingState } from './useRecordingState';
import {
  groupRecordedStepsByGroupId,
  convertStepToInteractiveBlock,
  convertStepsToMultistepBlock,
} from '../utils/recorded-steps-processor';

/**
 * Minimal interface for action recorder functionality needed by this hook.
 */
export interface ActionRecorderInterface {
  recordedSteps: RecordedStep[];
  startRecording: () => void;
  stopRecording: () => void;
  clearRecording: () => void;
  setRecordedSteps: (steps: RecordedStep[]) => void;
}

/**
 * Minimal interface for editor functionality needed by this hook.
 */
export interface EditorBlockInterface {
  addBlock: (block: JsonBlock, index?: number) => string;
  addBlockToSection: (block: JsonBlock, sectionId: string, index?: number) => void;
  addBlockToConditionalBranch: (
    conditionalId: string,
    branch: 'whenTrue' | 'whenFalse',
    block: JsonBlock,
    index?: number
  ) => void;
}

/**
 * Dependencies required by useRecordingActions.
 */
export interface RecordingActionsDependencies {
  /** Recording state from useRecordingState */
  state: RecordingState;
  /** Action recorder from useActionRecorder */
  actionRecorder: ActionRecorderInterface;
  /** Editor for adding blocks */
  editor: EditorBlockInterface;
  /** Callback to clear persistence (passed from recordingPersistence.clear) */
  onClear: () => void;
}

/**
 * Return type for useRecordingActions hook.
 */
export interface UseRecordingActionsReturn {
  /** Toggle recording into a section (start if not recording, stop if recording) */
  toggleSectionRecording: (sectionId: string) => void;
  /** Toggle recording into a conditional branch */
  toggleConditionalRecording: (conditionalId: string, branch: 'whenTrue' | 'whenFalse') => void;
  /** Stop any active recording */
  stopRecording: () => void;
  /** Submit a section block and immediately start recording into it */
  submitAndStartRecording: (block: JsonBlock, insertAtIndex?: number) => void;
  /** Ref for pending section ID (exposed for special cases) */
  pendingSectionIdRef: React.MutableRefObject<string | null>;
}

/**
 * Actions for controlling recording sessions.
 * Receives state from useRecordingState and clear callback from persistence.
 */
export function useRecordingActions(deps: RecordingActionsDependencies): UseRecordingActionsReturn {
  const { state, actionRecorder, editor, onClear } = deps;
  const {
    recordingIntoSection,
    recordingIntoConditionalBranch,
    setRecordingIntoSection,
    setRecordingIntoConditionalBranch,
    setRecordingStartUrl,
  } = state;

  // Ref for pending section ID (for submit-and-record flow)
  const pendingSectionIdRef = useRef<string | null>(null);
  // Ref for submit timeout (for cleanup on unmount)
  const submitTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // REACT: cleanup timeout on unmount (R1)
  useEffect(() => {
    return () => {
      if (submitTimeoutRef.current) {
        clearTimeout(submitTimeoutRef.current);
      }
    };
  }, []);

  // Process recorded steps and add to section
  const processAndAddToSection = useCallback(
    (sectionId: string) => {
      const steps = actionRecorder.recordedSteps;
      const processed = groupRecordedStepsByGroupId(steps);
      processed.forEach((item) => {
        if (item.type === 'single') {
          const interactiveBlock = convertStepToInteractiveBlock(item.steps[0]!);
          editor.addBlockToSection(interactiveBlock, sectionId);
        } else {
          const multistepBlock = convertStepsToMultistepBlock(item.steps);
          editor.addBlockToSection(multistepBlock, sectionId);
        }
      });
    },
    [actionRecorder.recordedSteps, editor]
  );

  // Process recorded steps and add to conditional branch
  const processAndAddToConditional = useCallback(
    (conditionalId: string, branch: 'whenTrue' | 'whenFalse') => {
      const steps = actionRecorder.recordedSteps;
      const processed = groupRecordedStepsByGroupId(steps);
      processed.forEach((item) => {
        if (item.type === 'single') {
          const interactiveBlock = convertStepToInteractiveBlock(item.steps[0]!);
          editor.addBlockToConditionalBranch(conditionalId, branch, interactiveBlock);
        } else {
          const multistepBlock = convertStepsToMultistepBlock(item.steps);
          editor.addBlockToConditionalBranch(conditionalId, branch, multistepBlock);
        }
      });
    },
    [actionRecorder.recordedSteps, editor]
  );

  // Start recording into a section
  const startSectionRecording = useCallback(
    (sectionId: string) => {
      setRecordingIntoConditionalBranch(null);
      actionRecorder.clearRecording();
      actionRecorder.startRecording();
      setRecordingIntoSection(sectionId);
      setRecordingStartUrl(window.location.href);
    },
    [actionRecorder, setRecordingIntoSection, setRecordingIntoConditionalBranch, setRecordingStartUrl]
  );

  // Stop recording into a section
  const stopSectionRecording = useCallback(
    (sectionId: string) => {
      actionRecorder.stopRecording();
      processAndAddToSection(sectionId);
      actionRecorder.clearRecording();
      setRecordingIntoSection(null);
      setRecordingStartUrl(null);
      onClear();
    },
    [actionRecorder, processAndAddToSection, setRecordingIntoSection, setRecordingStartUrl, onClear]
  );

  // Toggle section recording (start or stop)
  const toggleSectionRecording = useCallback(
    (sectionId: string) => {
      if (recordingIntoSection === sectionId) {
        stopSectionRecording(sectionId);
      } else {
        startSectionRecording(sectionId);
      }
    },
    [recordingIntoSection, startSectionRecording, stopSectionRecording]
  );

  // Start recording into a conditional branch
  const startConditionalRecording = useCallback(
    (conditionalId: string, branch: 'whenTrue' | 'whenFalse') => {
      setRecordingIntoSection(null);
      actionRecorder.clearRecording();
      actionRecorder.startRecording();
      setRecordingIntoConditionalBranch({ conditionalId, branch });
      setRecordingStartUrl(window.location.href);
    },
    [actionRecorder, setRecordingIntoSection, setRecordingIntoConditionalBranch, setRecordingStartUrl]
  );

  // Stop recording into a conditional branch
  const stopConditionalRecording = useCallback(
    (conditionalId: string, branch: 'whenTrue' | 'whenFalse') => {
      actionRecorder.stopRecording();
      processAndAddToConditional(conditionalId, branch);
      actionRecorder.clearRecording();
      setRecordingIntoConditionalBranch(null);
      setRecordingStartUrl(null);
      onClear();
    },
    [actionRecorder, processAndAddToConditional, setRecordingIntoConditionalBranch, setRecordingStartUrl, onClear]
  );

  // Toggle conditional recording (start or stop)
  const toggleConditionalRecording = useCallback(
    (conditionalId: string, branch: 'whenTrue' | 'whenFalse') => {
      const isRecordingThis =
        recordingIntoConditionalBranch?.conditionalId === conditionalId &&
        recordingIntoConditionalBranch?.branch === branch;

      if (isRecordingThis) {
        stopConditionalRecording(conditionalId, branch);
      } else {
        startConditionalRecording(conditionalId, branch);
      }
    },
    [recordingIntoConditionalBranch, startConditionalRecording, stopConditionalRecording]
  );

  // Stop any active recording
  const stopRecording = useCallback(() => {
    if (recordingIntoSection) {
      stopSectionRecording(recordingIntoSection);
    } else if (recordingIntoConditionalBranch) {
      stopConditionalRecording(recordingIntoConditionalBranch.conditionalId, recordingIntoConditionalBranch.branch);
    }
  }, [recordingIntoSection, recordingIntoConditionalBranch, stopSectionRecording, stopConditionalRecording]);

  // Submit block and immediately start recording
  const submitAndStartRecording = useCallback(
    (block: JsonBlock, insertAtIndex?: number) => {
      const editorBlockId = editor.addBlock(block, insertAtIndex);
      pendingSectionIdRef.current = editorBlockId;
      const capturedUrl = window.location.href;

      // REACT: store timeout ID for cleanup (R1)
      submitTimeoutRef.current = setTimeout(() => {
        if (pendingSectionIdRef.current) {
          setRecordingIntoConditionalBranch(null);
          actionRecorder.clearRecording();
          actionRecorder.startRecording();
          setRecordingIntoSection(pendingSectionIdRef.current);
          setRecordingStartUrl(capturedUrl);
          pendingSectionIdRef.current = null;
        }
        submitTimeoutRef.current = null;
      }, 100);
    },
    [editor, actionRecorder, setRecordingIntoSection, setRecordingIntoConditionalBranch, setRecordingStartUrl]
  );

  return {
    toggleSectionRecording,
    toggleConditionalRecording,
    stopRecording,
    submitAndStartRecording,
    pendingSectionIdRef,
  };
}
