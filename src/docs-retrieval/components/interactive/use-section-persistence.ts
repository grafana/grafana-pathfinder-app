import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  interactiveStepStorage,
  sectionCollapseStorage,
  interactiveCompletionStorage,
} from '../../../lib/user-storage';
import { getContentKey } from './get-content-key';
import { getTotalDocumentSteps } from './step-registry';
import type { StepInfo } from '../../../types/component-props.types';

/**
 * Hook for managing section-level persistence (completed steps, collapse state).
 *
 * Handles:
 * - Restoring completed steps from storage (filtered by current content)
 * - Persisting completed steps with document-wide completion percentage
 * - Collapse state persistence (skip in preview mode)
 * - Preview mode detection
 */

export interface UseSectionPersistenceParams {
  sectionId: string;
  stepComponents: StepInfo[];
}

export interface UseSectionPersistenceResult {
  completedSteps: Set<string>;
  setCompletedSteps: React.Dispatch<React.SetStateAction<Set<string>>>;
  currentStepIndex: number;
  setCurrentStepIndex: React.Dispatch<React.SetStateAction<number>>;
  isCollapsed: boolean;
  setIsCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  isPreviewMode: boolean;
  toggleCollapse: () => void;
  persistCompletedSteps: (ids: Set<string>) => void;
}

export function useSectionPersistence({
  sectionId,
  stepComponents,
}: UseSectionPersistenceParams): UseSectionPersistenceResult {
  // State
  const [completedSteps, setCompletedSteps] = useState(new Set<string>());
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Detect if we're in preview mode (block editor preview)
  // Preview mode uses a special URL pattern: block-editor://preview/{guide-id}
  const isPreviewMode = useMemo(() => {
    const contentKey = getContentKey();
    return contentKey.indexOf('devtools') > -1 || contentKey.startsWith('block-editor://preview/');
  }, []);

  // Persist completed steps using new user storage system
  const persistCompletedSteps = useCallback(
    (ids: Set<string>) => {
      const contentKey = getContentKey();
      interactiveStepStorage.setCompleted(contentKey, sectionId, ids);

      // Compute unified completion percentage across ALL sections (including standalone)
      const docTotal = getTotalDocumentSteps();
      const allCompleted = interactiveStepStorage.countAllCompleted(contentKey);
      const percentage = docTotal > 0 ? Math.round((allCompleted / docTotal) * 100) : undefined;
      if (percentage !== undefined) {
        interactiveCompletionStorage.set(contentKey, percentage);
      }

      // Dispatch event to notify that progress was saved (for reset button visibility)
      if (ids.size > 0 && typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('interactive-progress-saved', {
            detail: { contentKey, hasProgress: true, completionPercentage: percentage },
          })
        );
      }
    },
    [sectionId]
  );

  // Toggle collapse state and persist to storage (skip persistence in preview mode)
  const toggleCollapse = useCallback(() => {
    const newCollapseState = !isCollapsed;
    setIsCollapsed(newCollapseState);
    // Only persist collapse state for non-preview mode to avoid polluting localStorage
    if (!isPreviewMode) {
      const contentKey = getContentKey();
      sectionCollapseStorage.set(contentKey, sectionId, newCollapseState);
    }
  }, [isCollapsed, sectionId, isPreviewMode]);

  // Restore collapse state from storage on mount (skip in preview mode)
  useEffect(() => {
    // Don't restore collapse state in preview mode - always start expanded
    if (isPreviewMode) {
      return;
    }
    const restoreCollapseState = async () => {
      const contentKey = getContentKey();
      const savedCollapseState = await sectionCollapseStorage.get(contentKey, sectionId);
      setIsCollapsed(savedCollapseState);
    };
    restoreCollapseState();
  }, [sectionId, isPreviewMode]);

  // Load persisted completed steps on mount/section change
  useEffect(() => {
    const contentKey = getContentKey();

    interactiveStepStorage.getCompleted(contentKey, sectionId).then((restored) => {
      if (restored.size > 0) {
        // Only keep steps that exist in current content
        const validIds = new Set(stepComponents.map((s) => s.stepId));
        const filtered = Array.from(restored).filter((id) => validIds.has(id));
        if (filtered.length > 0) {
          const restoredSet = new Set(filtered);
          setCompletedSteps(restoredSet);
          // Move index to next uncompleted
          const nextIdx = stepComponents.findIndex((s) => !restoredSet.has(s.stepId));
          setCurrentStepIndex(nextIdx === -1 ? stepComponents.length : nextIdx);
        }
      }
    });
  }, [sectionId, stepComponents]);

  return {
    completedSteps,
    setCompletedSteps,
    currentStepIndex,
    setCurrentStepIndex,
    isCollapsed,
    setIsCollapsed,
    isPreviewMode,
    toggleCollapse,
    persistCompletedSteps,
  };
}
