/**
 * Full Screen Mode Overlay
 *
 * Orchestrates all UI components for full screen authoring mode:
 * - DOM path tooltip (following cursor during hover)
 * - Step editor modal (when click is intercepted)
 * - Minimized sidebar icon
 *
 * This component is rendered via Portal to overlay the entire Grafana UI.
 */

import React, { useEffect, useCallback, useMemo } from 'react';
import type { Editor } from '@tiptap/react';
import { DomPathTooltip } from '../DomPathTooltip';
import { FullScreenStepEditor, type StepEditorData, type NestedStepData } from './FullScreenStepEditor';
import { BundlingIndicator } from './BundlingIndicator';
import { MinimizedSidebarIcon } from '../docs-panel/MinimizedSidebarIcon';
import { useFullScreenMode, type UseFullScreenModeReturn, type PendingClickInfo } from './hooks/useFullScreenMode';
import { useMultistepDetector } from './hooks/useMultistepDetector';

/**
 * Props for FullScreenModeOverlay
 */
export interface FullScreenModeOverlayProps {
  /** TipTap editor instance */
  editor: Editor | null;
  /** Current full screen mode state from parent */
  fullScreenState: UseFullScreenModeReturn;
}

/**
 * Orchestrates full screen mode UI components
 *
 * @example
 * ```tsx
 * const fullScreenMode = useFullScreenMode({ editor });
 *
 * return (
 *   <>
 *     <WysiwygEditor ... />
 *     <FullScreenModeOverlay
 *       editor={editor}
 *       fullScreenState={fullScreenMode}
 *     />
 *   </>
 * );
 * ```
 */
export function FullScreenModeOverlay({ editor, fullScreenState }: FullScreenModeOverlayProps) {
  const {
    state,
    isActive,
    pendingClick,
    bundledSteps,
    bundlingActionType,
    stepCount,
    existingSections,
    initialSectionId,
    exitFullScreenMode,
    saveStepAndClick,
    startBundling,
    skipClick,
    cancelEdit,
    finishBundling,
    confirmBundling,
    domPath,
    cursorPosition,
  } = fullScreenState;

  // Multistep detection - triggers after click is executed
  const { triggerDetection } = useMultistepDetector({
    isActive: state === 'active',
    onOverlayDetected: (result) => {
      if (result.detected) {
        console.log('[FullScreenMode] Overlay detected:', result.type);
        // Could enter bundling mode here if needed
        // For now, we let the user continue clicking
      }
    },
    onOverlayDismissed: () => {
      console.log('[FullScreenMode] Overlay dismissed');
      // Could finish bundling here if in bundling mode
    },
  });

  // Handle save and trigger detection after click
  const handleSaveAndClick = useCallback(
    (data: StepEditorData) => {
      saveStepAndClick(data);
      // Trigger detection for potential dropdown/modal
      triggerDetection();
    },
    [saveStepAndClick, triggerDetection]
  );

  // Handle save and start bundling for multistep/guided
  const handleSaveAndStartBundling = useCallback(
    (data: StepEditorData) => {
      startBundling(data);
      // Trigger detection after the first click
      triggerDetection();
    },
    [startBundling, triggerDetection]
  );

  // Handle skip and trigger detection
  const handleSkip = useCallback(() => {
    skipClick();
    triggerDetection();
  }, [skipClick, triggerDetection]);

  // Handle finish bundling - transitions to review mode
  const handleFinishBundling = useCallback(() => {
    finishBundling();
  }, [finishBundling]);

  // Convert bundled steps to nested step format for the review editor
  const bundledStepsAsNested: NestedStepData[] = useMemo(() => {
    return bundledSteps.map((step) => ({
      actionType: step.action,
      refTarget: step.selector,
      requirements: step.requirements,
      interactiveComment: step.interactiveComment,
      textContent: step.description,
    }));
  }, [bundledSteps]);

  // Handle confirm bundling from review - creates the element
  const handleConfirmBundling = useCallback(
    (data: StepEditorData, updatedNestedSteps: NestedStepData[]) => {
      // Convert nested steps back to PendingClickInfo format
      const updatedSteps: PendingClickInfo[] = bundledSteps.map((original, index) => {
        const updated = updatedNestedSteps[index];
        return {
          ...original,
          interactiveComment: updated?.interactiveComment,
          requirements: updated?.requirements,
        };
      });
      confirmBundling(data, updatedSteps);
    },
    [bundledSteps, confirmBundling]
  );

  // Listen for request to exit full screen mode (from minimized sidebar)
  useEffect(() => {
    const handleExitRequest = () => {
      exitFullScreenMode();
    };

    window.addEventListener('pathfinder-request-exit-fullscreen', handleExitRequest);

    return () => {
      window.removeEventListener('pathfinder-request-exit-fullscreen', handleExitRequest);
    };
  }, [exitFullScreenMode]);

  // Determine if tooltip should be visible
  // Show when in active or bundling state and hovering over an element
  const showTooltip = (state === 'active' || state === 'bundling') && domPath && cursorPosition;

  // Determine if step editor should be open (for single step capture)
  const showStepEditor = state === 'editing' && pendingClick !== null;

  // Determine if bundling review editor should be shown (after recording, to add descriptions)
  const showBundlingReview = state === 'bundling-review' && bundledSteps.length > 0;

  // Determine if bundling indicator should be shown (during recording)
  const showBundlingIndicator = state === 'bundling';

  // Determine recording state for minimized icon
  const isRecording = state === 'active' || state === 'bundling';

  return (
    <>
      {/* DOM Path Tooltip - follows cursor when hovering */}
      {showTooltip && <DomPathTooltip domPath={domPath} position={cursorPosition} visible={true} />}

      {/* Step Editor Modal - shown when click is intercepted (single step capture) */}
      <FullScreenStepEditor
        isOpen={showStepEditor}
        pendingClick={pendingClick}
        onSaveAndClick={handleSaveAndClick}
        onSaveAndStartBundling={handleSaveAndStartBundling}
        onSkip={handleSkip}
        onCancel={cancelEdit}
        stepNumber={stepCount + 1}
        existingSections={existingSections}
        initialSectionId={initialSectionId}
      />

      {/* Bundling Review Editor - shown after recording to add descriptions/comments */}
      <FullScreenStepEditor
        isOpen={showBundlingReview}
        isBundlingReview={true}
        bundlingActionType={bundlingActionType || 'multistep'}
        bundledNestedSteps={bundledStepsAsNested}
        onConfirmBundling={handleConfirmBundling}
        onCancel={cancelEdit}
        existingSections={existingSections}
        initialSectionId={initialSectionId}
      />

      {/* Bundling Indicator - shown during recording to show step count */}
      {showBundlingIndicator && (
        <BundlingIndicator
          stepCount={bundledSteps.length}
          actionType={bundlingActionType || 'multistep'}
          onFinish={handleFinishBundling}
          onCancel={cancelEdit}
        />
      )}

      {/* Minimized Sidebar Icon - shown when in full screen mode */}
      <MinimizedSidebarIcon
        isActive={isActive}
        stepCount={stepCount}
        isRecording={isRecording}
        onClick={exitFullScreenMode}
      />
    </>
  );
}

/**
 * Context provider for full screen mode
 * Allows deep components to access full screen mode state without prop drilling
 */
export const FullScreenModeContext = React.createContext<UseFullScreenModeReturn | null>(null);

/**
 * Hook to access full screen mode context
 */
export function useFullScreenModeContext(): UseFullScreenModeReturn | null {
  return React.useContext(FullScreenModeContext);
}

/**
 * Provider component that wraps children with full screen mode context
 */
export interface FullScreenModeProviderProps {
  editor: Editor | null;
  children: React.ReactNode;
}

export function FullScreenModeProvider({ editor, children }: FullScreenModeProviderProps) {
  const fullScreenMode = useFullScreenMode({ editor });

  return (
    <FullScreenModeContext.Provider value={fullScreenMode}>
      {children}
      <FullScreenModeOverlay editor={editor} fullScreenState={fullScreenMode} />
    </FullScreenModeContext.Provider>
  );
}

export default FullScreenModeOverlay;
