import { warn } from '../../lib/logger';
/**
 * Hook for recording user interactions as tutorial steps (Record Mode)
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { shouldCaptureElement, getActionDescription } from '../../interactive-engine/auto-completion/action-detector';
import { generateSelectorFromEvent } from './selector-generator.util';
import { exportStepsToHTML, type RecordedStep, type ExportOptions } from './tutorial-exporter';
import { formatStepsToString } from './step-parser.util';
import { useElementInspector } from './element-inspector.hook';

export type RecordingState = 'idle' | 'recording' | 'paused';

/**
 * Represents a group of actions that were recorded while a modal/dropdown was open.
 * These will be converted to a multistep block.
 */
export interface ActionGroup {
  /** The action that triggered the modal to open */
  triggerStep: RecordedStep;
  /** Actions performed inside the modal */
  modalSteps: RecordedStep[];
  /** The modal element that was detected */
  modalElement: Element;
}

// Selectors for detecting modals, dialogs, dropdowns, and popovers
const MODAL_SELECTORS = [
  '[role="dialog"]',
  '[role="menu"]',
  '[role="listbox"]',
  '[role="alertdialog"]',
  '[role="tooltip"]',
  '.modal',
  '.ReactModal__Content',
  '.ReactModal__Overlay',
  '[data-popper-placement]',
  '.dropdown-menu',
  '[data-radix-popper-content-wrapper]',
  '[data-floating-ui-portal]',
  '.grafana-portal', // Grafana-specific portals
  '[class*="dropdown"]', // Catch various dropdown implementations
  '[class*="popover"]', // Catch popovers
  '[class*="Overlay"]', // Modal overlays
  '.rc-cascader-menus', // Cascader menus
  '[data-testid="data-testid Modal"]', // Grafana test ID modals
];

// Time to wait for modal to appear after a click (ms)
const MODAL_DETECTION_TIMEOUT = 250;

/**
 * Check if an element is a modal/dropdown/popover
 */
function isModalElement(el: Element): boolean {
  return MODAL_SELECTORS.some((sel) => el.matches(sel));
}

/**
 * Find the first modal element in a list of added nodes
 */
function findModalInNodes(nodes: NodeList): Element | null {
  for (const node of nodes) {
    if (node instanceof Element) {
      if (isModalElement(node)) {
        return node;
      }
      // Check children
      const modalChild = node.querySelector(MODAL_SELECTORS.join(','));
      if (modalChild) {
        return modalChild;
      }
    }
  }
  return null;
}

/**
 * Scan the entire DOM for any visible modal elements
 * Used as a backup when MutationObserver might have missed the modal
 */
function findAnyVisibleModal(excludeElement?: Element | null): Element | null {
  const selector = MODAL_SELECTORS.join(',');
  const modals = document.querySelectorAll(selector);

  for (const modal of modals) {
    // Skip the element we're already tracking
    if (excludeElement && (modal === excludeElement || modal.contains(excludeElement))) {
      continue;
    }

    // Check if it's visible (has dimensions and is not hidden)
    const rect = modal.getBoundingClientRect();
    const style = window.getComputedStyle(modal);
    if (
      rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== 'hidden' &&
      style.display !== 'none' &&
      style.opacity !== '0'
    ) {
      return modal;
    }
  }
  return null;
}

export interface UseActionRecorderOptions {
  excludeSelectors?: string[];
  onStepRecorded?: (step: RecordedStep) => void;
  /** Called when a group of actions (triggered by modal) is completed */
  onActionGroupCompleted?: (group: ActionGroup) => void;
  enableInspector?: boolean;
  /** Enable auto-detection of modals/dropdowns for grouping actions into multisteps */
  enableModalDetection?: boolean;
}

export interface UseActionRecorderReturn {
  isRecording: boolean; // Backward compatibility: true when state is 'recording'
  recordingState: RecordingState;
  isPaused: boolean;
  recordedSteps: RecordedStep[];
  startRecording: () => void;
  pauseRecording: () => void;
  resumeRecording: () => void;
  stopRecording: () => void;
  clearRecording: () => void;
  deleteStep: (index: number) => void;
  setRecordedSteps: (steps: RecordedStep[]) => void;
  exportSteps: (format: 'string' | 'html', options?: ExportOptions) => string;
  // Inspector data for tooltip rendering
  hoveredElement: HTMLElement | null;
  domPath: string | null;
  cursorPosition: { x: number; y: number } | null;
  // Modal detection state
  activeModal: Element | null;
  pendingGroupSteps: RecordedStep[];
}

/**
 * Hook for recording user interactions as tutorial steps
 *
 * @param options - Configuration options
 * @param options.excludeSelectors - CSS selectors for elements to ignore
 * @param options.onStepRecorded - Callback when a step is recorded
 * @returns Object with recording state and control functions
 *
 * @example
 * ```typescript
 * const { isRecording, recordedSteps, startRecording, pauseRecording, resumeRecording, stopRecording, exportSteps } = useActionRecorder({
 *   onStepRecorded: (step) => log('Recorded:', step)
 * });
 *
 * // Start recording
 * startRecording();
 *
 * // Pause recording (keeps steps, stops capturing)
 * pauseRecording();
 *
 * // Resume recording (continues capturing)
 * resumeRecording();
 *
 * // Stop recording (keeps steps, exits record mode)
 * stopRecording();
 *
 * // Export as string
 * const stepsString = exportSteps('string');
 * ```
 */
// Default empty array - defined outside to prevent recreation
const DEFAULT_EXCLUDE_SELECTORS = ['[class*="debug"]', '.context-container', '[data-devtools-panel]'];

export function useActionRecorder(options: UseActionRecorderOptions = {}): UseActionRecorderReturn {
  const {
    excludeSelectors = DEFAULT_EXCLUDE_SELECTORS,
    onStepRecorded,
    onActionGroupCompleted,
    enableInspector = true,
    enableModalDetection = false, // Disabled by default to avoid breaking existing behavior
  } = options;

  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [recordedSteps, setRecordedSteps] = useState<RecordedStep[]>([]);
  const recordingElementsRef = useRef<Map<HTMLElement, { value: string; timestamp: number }>>(new Map());

  // Modal detection state
  const [activeModal, setActiveModal] = useState<Element | null>(null);
  const [pendingGroupSteps, setPendingGroupSteps] = useState<RecordedStep[]>([]);
  const triggerStepRef = useRef<RecordedStep | null>(null);
  const modalObserverRef = useRef<MutationObserver | null>(null);
  const pendingModalCheckRef = useRef<boolean>(false);

  // Backward compatibility: isRecording is true when actively recording (not paused)
  const isRecording = recordingState === 'recording';
  const isPaused = recordingState === 'paused';

  // Element inspector for hover highlighting and DOM path display
  // Only active when actually recording (not paused)
  const { hoveredElement, domPath, cursorPosition } = useElementInspector({
    isActive: isRecording && enableInspector,
    excludeSelectors,
  });

  const startRecording = useCallback(() => {
    setRecordingState('recording');
    recordingElementsRef.current.clear();
  }, []);

  const pauseRecording = useCallback(() => {
    if (recordingState === 'recording') {
      setRecordingState('paused');
      // Keep recorded steps and tracking refs - just stop capturing
    }
  }, [recordingState]);

  const resumeRecording = useCallback(() => {
    if (recordingState === 'paused') {
      setRecordingState('recording');
      // Resume capturing - reuse existing state/refs
    }
  }, [recordingState]);

  const stopRecording = useCallback(() => {
    setRecordingState('idle');
    // Keep recorded steps when stopping
  }, []);

  const clearRecording = useCallback(() => {
    setRecordedSteps([]);
    recordingElementsRef.current.clear();
    // Also clear modal detection state
    setActiveModal(null);
    setPendingGroupSteps([]);
    triggerStepRef.current = null;
  }, []);

  /**
   * Handle when a modal closes - finalize the action group
   * Instead of calling a callback immediately, we add all steps to recordedSteps
   * with a shared groupId so they can be processed together when recording stops.
   */
  const finalizeActionGroup = useCallback(() => {
    if (!triggerStepRef.current) {
      return;
    }

    const triggerStep = triggerStepRef.current;
    const modalSteps = pendingGroupSteps;

    // Clear the pending state
    triggerStepRef.current = null;
    setPendingGroupSteps([]);
    setActiveModal(null);

    if (modalSteps.length === 0) {
      // No actions inside modal - just record the trigger as a normal step
      setRecordedSteps((prev) => [...prev, triggerStep]);
      if (onStepRecorded) {
        onStepRecorded(triggerStep);
      }
    } else {
      // We have a group! Add all steps with a shared groupId
      // This preserves order and allows grouping when recording stops
      const groupId = `group-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const allSteps = [triggerStep, ...modalSteps].map((step) => ({
        ...step,
        groupId,
      }));

      setRecordedSteps((prev) => [...prev, ...allSteps]);

      // Notify about each step
      allSteps.forEach((step) => {
        if (onStepRecorded) {
          onStepRecorded(step);
        }
      });

      // Also call onActionGroupCompleted if provided (for any other listeners)
      if (onActionGroupCompleted) {
        onActionGroupCompleted({
          triggerStep,
          modalSteps,
          modalElement: document.body,
        });
      }
    }
  }, [pendingGroupSteps, onActionGroupCompleted, onStepRecorded]);

  const deleteStep = useCallback((index: number) => {
    setRecordedSteps((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const exportSteps = useCallback(
    (format: 'string' | 'html', exportOptions?: ExportOptions): string => {
      if (format === 'string') {
        return formatStepsToString(
          recordedSteps.map((step) => ({
            action: step.action,
            selector: step.selector,
            value: step.value,
          }))
        );
      } else {
        return exportStepsToHTML(recordedSteps, {
          includeComments: true,
          includeHints: true,
          wrapInSection: true,
          sectionId: 'tutorial-section',
          sectionTitle: 'Tutorial Section',
          ...exportOptions,
        });
      }
    },
    [recordedSteps]
  );

  // MutationObserver for modal detection
  // Watches for modals appearing/disappearing to group actions
  useEffect(() => {
    if (recordingState !== 'recording' || !enableModalDetection) {
      // Clean up observer when not recording
      if (modalObserverRef.current) {
        modalObserverRef.current.disconnect();
        modalObserverRef.current = null;
      }
      return;
    }

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        // Check for modal appearing (added nodes)
        if (mutation.addedNodes.length > 0 && pendingModalCheckRef.current) {
          const modal = findModalInNodes(mutation.addedNodes);
          if (modal && !activeModal) {
            // Modal appeared after a click - start grouping
            setActiveModal(modal);
            pendingModalCheckRef.current = false;
          }
        }

        // Check for modal disappearing (removed nodes)
        if (mutation.removedNodes.length > 0 && activeModal) {
          for (const node of mutation.removedNodes) {
            if (node instanceof Element) {
              // Check if the removed node is our active modal or contains it
              if (node === activeModal || node.contains(activeModal)) {
                // Modal closed - finalize the action group
                finalizeActionGroup();
                break;
              }
            }
          }
        }

        // Also check for modal appearing via attribute changes (e.g., display: none → block)
        if (mutation.type === 'attributes' && pendingModalCheckRef.current && !activeModal) {
          const target = mutation.target as Element;
          if (isModalElement(target)) {
            const style = window.getComputedStyle(target);
            const rect = target.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none') {
              setActiveModal(target);
              pendingModalCheckRef.current = false;
            }
          }
        }

        // Check for modal hiding via attribute changes
        if (mutation.type === 'attributes' && activeModal) {
          const target = mutation.target as Element;
          if (target === activeModal || target.contains(activeModal)) {
            const style = window.getComputedStyle(activeModal);
            if (style.display === 'none' || style.visibility === 'hidden') {
              finalizeActionGroup();
            }
          }
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class', 'hidden', 'aria-hidden'],
    });

    modalObserverRef.current = observer;

    return () => {
      observer.disconnect();
      modalObserverRef.current = null;
    };
  }, [recordingState, enableModalDetection, activeModal, finalizeActionGroup]);

  // Record Mode event listeners
  // Only active when recording (not paused or idle)
  useEffect(() => {
    if (recordingState !== 'recording') {
      return;
    }

    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;

      if (!shouldCaptureElement(target)) {
        return;
      }

      // Check exclusion selectors
      const shouldExclude = excludeSelectors.some((selector) => target.closest(selector));
      if (shouldExclude) {
        return;
      }

      // DON'T preventDefault - let the click proceed normally!
      // Just record the action and let navigation/actions happen
      //
      // ⚠️ LIMITATION: During recording, clicking navigation links or submit buttons
      // will cause page navigation, potentially losing all recorded steps.
      // Recorded steps are stored in React state only and are not persisted.
      // Users should avoid navigating away while recording, or export steps frequently.

      // Generate selector using shared utility
      const result = generateSelectorFromEvent(target, event);
      const selector = result.selector;
      const action = result.action;
      const selectorInfo = result.selectorInfo;

      // Log validation warnings for debugging
      if (result.warnings.length > 0) {
        warn('Selector validation warnings:', result.warnings);
      }

      const description = getActionDescription(action, target);

      // For text form elements, track them but don't record yet (wait for value)
      // Radio/checkbox use 'highlight' action and are recorded immediately, not tracked
      if (action === 'formfill') {
        recordingElementsRef.current.set(target, {
          value: (target as HTMLInputElement).value || '',
          timestamp: Date.now(),
        });
        return;
      }

      // Create the step
      const newStep: RecordedStep = {
        action,
        selector,
        value: undefined,
        description: result.wasModified ? `${description} ⚠️ (cleaned)` : description,
        isUnique: selectorInfo.isUnique,
        matchCount: selectorInfo.matchCount,
        contextStrategy: selectorInfo.contextStrategy,
      };

      // Modal detection: check if we're inside an active modal or if this might trigger one
      if (enableModalDetection) {
        if (activeModal) {
          // We're inside a modal - add to pending group
          // Check for duplicate in pending group
          const lastPendingStep = pendingGroupSteps.length > 0 ? pendingGroupSteps[pendingGroupSteps.length - 1] : null;
          if (lastPendingStep && lastPendingStep.selector === selector && lastPendingStep.action === action) {
            warn('Skipping duplicate selector in modal:', selector);
            return;
          }
          setPendingGroupSteps((prev) => [...prev, newStep]);
          return;
        }

        // Check if there's already a pending trigger step waiting for a modal
        if (triggerStepRef.current) {
          // The previous click didn't trigger a modal - record it normally
          const prevStep = triggerStepRef.current;
          setRecordedSteps((prev) => [...prev, prevStep]);
          if (onStepRecorded) {
            onStepRecorded(prevStep);
          }
        }

        // This click might trigger a modal - store it and wait to see
        triggerStepRef.current = newStep;
        pendingModalCheckRef.current = true;

        // Use requestAnimationFrame to check for modal after DOM updates
        requestAnimationFrame(() => {
          // Give the DOM time to update - modals may have animations
          setTimeout(() => {
            // If no modal appeared and we still have a pending trigger, do a final check
            if (pendingModalCheckRef.current && triggerStepRef.current === newStep && !activeModal) {
              // Backup: scan the DOM for any modal that might have appeared
              // This catches cases where MutationObserver missed the modal
              const foundModal = findAnyVisibleModal();
              if (foundModal) {
                // Modal found! Start grouping
                setActiveModal(foundModal);
                pendingModalCheckRef.current = false;
                return;
              }

              // No modal found - record the step normally
              pendingModalCheckRef.current = false;
              triggerStepRef.current = null;
              setRecordedSteps((prev) => {
                // Double-check for duplicates
                const lastStep = prev.length > 0 ? prev[prev.length - 1] : null;
                if (lastStep && lastStep.selector === selector && lastStep.action === action) {
                  return prev;
                }
                return [...prev, newStep];
              });
              if (onStepRecorded) {
                onStepRecorded(newStep);
              }
            }
          }, MODAL_DETECTION_TIMEOUT);
        });
        return;
      }

      // Modal detection disabled - use original logic
      setRecordedSteps((prev) => {
        const lastStep = prev.length > 0 ? prev[prev.length - 1] : null;
        if (lastStep && lastStep.selector === selector && lastStep.action === action) {
          warn('Skipping duplicate selector:', selector);
          return prev;
        }

        if (onStepRecorded) {
          onStepRecorded(newStep);
        }

        return [...prev, newStep];
      });
    };

    const handleInput = (event: Event) => {
      const target = event.target as HTMLElement;

      if (!shouldCaptureElement(target)) {
        return;
      }

      // Check exclusion selectors
      const shouldExclude = excludeSelectors.some((selector) => target.closest(selector));
      if (shouldExclude) {
        return;
      }

      // Skip tracking radio/checkbox inputs - they're handled on click
      const inputElement = target as HTMLInputElement;
      if (inputElement.type === 'radio' || inputElement.type === 'checkbox') {
        return;
      }

      // Update the tracked value for text inputs
      recordingElementsRef.current.set(target, {
        value: inputElement.value || '',
        timestamp: Date.now(),
      });
    };

    const handleChange = (event: Event) => {
      const target = event.target as HTMLElement;

      if (!shouldCaptureElement(target)) {
        return;
      }

      // Check exclusion selectors
      const shouldExclude = excludeSelectors.some((selector) => target.closest(selector));
      if (shouldExclude) {
        return;
      }

      const tracked = recordingElementsRef.current.get(target);
      if (tracked) {
        // Generate selector using shared utility
        const result = generateSelectorFromEvent(target, event);
        const selector = result.selector;
        const action = result.action;
        const selectorInfo = result.selectorInfo;

        // Skip recording radio/checkbox change events - they're already recorded on click
        if (action === 'highlight') {
          recordingElementsRef.current.delete(target);
          return;
        }

        // Log validation warnings for debugging
        if (result.warnings.length > 0) {
          warn('Selector validation warnings:', result.warnings);
        }

        const description = getActionDescription(action, target);
        recordingElementsRef.current.delete(target);

        const newStep: RecordedStep = {
          action,
          selector,
          value: tracked.value,
          description: result.wasModified ? `${description} ⚠️ (cleaned)` : description,
          isUnique: selectorInfo.isUnique,
          matchCount: selectorInfo.matchCount,
          contextStrategy: selectorInfo.contextStrategy,
        };

        // Modal detection: if we're inside a modal, add to pending group
        if (enableModalDetection && activeModal) {
          // Check for duplicate in pending group
          const lastPendingStep = pendingGroupSteps.length > 0 ? pendingGroupSteps[pendingGroupSteps.length - 1] : null;
          if (
            lastPendingStep &&
            lastPendingStep.selector === selector &&
            lastPendingStep.action === action &&
            lastPendingStep.value === tracked.value
          ) {
            warn('Skipping duplicate formfill in modal:', selector);
            return;
          }
          setPendingGroupSteps((prev) => [...prev, newStep]);
          return;
        }

        // Check for duplicate - don't record if last step has same selector, action, and value
        setRecordedSteps((prev) => {
          const lastStep = prev.length > 0 ? prev[prev.length - 1] : null;
          if (
            lastStep &&
            lastStep.selector === selector &&
            lastStep.action === action &&
            lastStep.value === tracked.value
          ) {
            warn('Skipping duplicate formfill:', selector);
            return prev; // Skip duplicate
          }

          if (onStepRecorded) {
            onStepRecorded(newStep);
          }

          return [...prev, newStep];
        });
      }
    };

    document.addEventListener('click', handleClick, true);
    document.addEventListener('input', handleInput, true);
    document.addEventListener('change', handleChange, true);

    return () => {
      document.removeEventListener('click', handleClick, true);
      document.removeEventListener('input', handleInput, true);
      document.removeEventListener('change', handleChange, true);
    };
  }, [recordingState, excludeSelectors, onStepRecorded, enableModalDetection, activeModal, pendingGroupSteps]);

  return {
    isRecording, // Backward compatibility
    recordingState,
    isPaused,
    recordedSteps,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    clearRecording,
    deleteStep,
    setRecordedSteps, // State setter from useState is already stable
    exportSteps,
    // Inspector data
    hoveredElement,
    domPath,
    cursorPosition,
    // Modal detection state
    activeModal,
    pendingGroupSteps,
  };
}
