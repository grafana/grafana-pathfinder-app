/**
 * Hook for full screen authoring mode
 *
 * Enables authors to create walkthroughs by clicking through the Grafana UI
 * while pausing to add step descriptions. Each click is intercepted, the author
 * describes the step, then the click is executed on their behalf.
 *
 * State machine:
 * - inactive: Normal editing mode
 * - active: Full screen mode, awaiting clicks with hover highlighting
 * - editing: Step editor dialog open (click was intercepted)
 * - bundling: Collecting multiple clicks for dropdown/modal (multistep)
 */

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { Editor } from '@tiptap/react';
import { useElementInspector } from '../devtools/element-inspector.hook';
import { generateSelectorFromEvent, type SelectorGenerationResult } from '../devtools/selector-generator.util';
import type { RecordedStep } from '../devtools/tutorial-exporter';
import {
  shouldCaptureElement,
  getActionDescription,
} from '../../../interactive-engine/auto-completion/action-detector';
import { fullScreenModeStorage, type PersistedBundledStep } from '../../../lib/user-storage';

/**
 * Full screen mode states
 */
export type FullScreenModeState = 'inactive' | 'active' | 'editing' | 'bundling' | 'bundling-editing';

/**
 * Pending click information captured when intercepting
 */
export interface PendingClickInfo {
  element: HTMLElement;
  event: MouseEvent;
  selector: string;
  action: string;
  selectorInfo: SelectorGenerationResult['selectorInfo'];
  description: string;
  warnings: string[];
  /** Optional comment for this step (used in bundled steps) */
  interactiveComment?: string;
  /** Optional requirements for this step (used in bundled steps) */
  requirements?: string;
}

/**
 * Data for mini step editor during bundling
 */
export interface BundledStepEditorData {
  interactiveComment?: string;
  requirements?: string;
}

/**
 * Step data for the editor to display and edit
 */
export interface FullScreenStep extends RecordedStep {
  requirements?: string;
  interactiveComment?: string;
  sectionId?: string;
  sectionTitle?: string;
}

/**
 * Section information extracted from the document
 */
export interface SectionInfo {
  id: string;
  title?: string;
}

/**
 * Options for the useFullScreenMode hook
 */
export interface UseFullScreenModeOptions {
  /** TipTap editor instance for document sync */
  editor: Editor | null;
  /** CSS selectors for elements to exclude from click interception */
  excludeSelectors?: string[];
  /** Callback when full screen mode state changes */
  onStateChange?: (state: FullScreenModeState) => void;
  /** Callback when a step is added to the document */
  onStepAdded?: (step: FullScreenStep) => void;
  /** When true, pauses click interception (e.g., when sidebar form is capturing) */
  pauseInterception?: boolean;
}

/**
 * Data passed from the step editor
 */
export interface StepEditorData {
  description: string;
  actionType: string;
  requirements?: string;
  interactiveComment?: string;
  formFillValue?: string;
  sectionId?: string;
  sectionTitle?: string;
}

/**
 * Return type for the useFullScreenMode hook
 */
export interface UseFullScreenModeReturn {
  /** Current state of full screen mode */
  state: FullScreenModeState;
  /** Whether full screen mode is active (not inactive) */
  isActive: boolean;
  /** Pending click info when in 'editing' state or 'bundling-editing' state */
  pendingClick: PendingClickInfo | null;
  /** Steps collected during bundling mode */
  bundledSteps: PendingClickInfo[];
  /** Action type being bundled (multistep or guided) */
  bundlingActionType: string | null;
  /** All recorded steps in current session */
  recordedSteps: FullScreenStep[];
  /** Total count of recorded steps */
  stepCount: number;
  /** Existing sections in the document */
  existingSections: SectionInfo[];
  /** Initial section ID to pre-populate when capturing (from cursor position) */
  initialSectionId: string | null;
  /** Enter full screen authoring mode. If singleCapture is true, exits after one step. */
  enterFullScreenMode: (options?: { singleCapture?: boolean; initialSectionId?: string }) => void;
  /** Exit full screen authoring mode */
  exitFullScreenMode: () => void;
  /** Save the current pending step and execute the click */
  saveStepAndClick: (data: StepEditorData) => void;
  /** Start bundling mode - save first step and begin collecting subsequent clicks */
  startBundling: (data: StepEditorData) => void;
  /** Skip the current click without recording */
  skipClick: () => void;
  /** Cancel the current editing/bundling operation */
  cancelEdit: () => void;
  /** Finish bundling mode and create multistep */
  finishBundling: (description: string) => void;
  /** Save bundled step data (comment/requirements) and continue bundling */
  saveBundledStep: (data: BundledStepEditorData) => void;
  /** Skip bundled step editing and just record the click */
  skipBundledStepEdit: () => void;
  /** Clear all recorded steps */
  clearSteps: () => void;
  // Inspector data for tooltip rendering (from useElementInspector)
  hoveredElement: HTMLElement | null;
  domPath: string | null;
  cursorPosition: { x: number; y: number } | null;
}

// Default exclude selectors - pathfinder content, form panels, dev tools, modals, bundling indicator
const DEFAULT_EXCLUDE_SELECTORS = [
  '[data-pathfinder-content]',
  '[data-wysiwyg-form]',
  '[data-devtools-panel]',
  '[data-fullscreen-step-editor]',
  '[data-minimized-sidebar]',
  '[data-bundling-indicator]',
  '[data-bundling-step-editor]',
  '[class*="debug"]',
  '.context-container',
];

/**
 * Hook for full screen authoring mode
 *
 * @example
 * ```typescript
 * const {
 *   state,
 *   isActive,
 *   enterFullScreenMode,
 *   exitFullScreenMode,
 *   pendingClick,
 *   saveStepAndClick,
 * } = useFullScreenMode({ editor });
 *
 * // Enter full screen mode
 * enterFullScreenMode();
 *
 * // In the step editor dialog:
 * if (pendingClick) {
 *   // Show form with pendingClick.selector, pendingClick.action
 *   // On submit:
 *   saveStepAndClick(description, requirements);
 * }
 * ```
 */
export function useFullScreenMode(options: UseFullScreenModeOptions): UseFullScreenModeReturn {
  const {
    editor,
    excludeSelectors = DEFAULT_EXCLUDE_SELECTORS,
    onStateChange,
    onStepAdded,
    pauseInterception = false,
  } = options;

  // State machine
  const [state, setState] = useState<FullScreenModeState>('inactive');
  const [pendingClick, setPendingClick] = useState<PendingClickInfo | null>(null);
  const [bundledSteps, setBundledSteps] = useState<PendingClickInfo[]>([]);
  const [bundlingActionType, setBundlingActionType] = useState<string | null>(null);
  const [bundlingSectionInfo, setBundlingSectionInfo] = useState<{
    sectionId?: string;
    sectionTitle?: string;
    description?: string;
    interactiveComment?: string;
    requirements?: string;
  } | null>(null);
  const [recordedSteps, setRecordedSteps] = useState<FullScreenStep[]>([]);

  const isActive = state !== 'inactive';
  // Don't intercept clicks when paused (e.g., sidebar form is in capture mode)
  const isIntercepting = (state === 'active' || state === 'bundling') && !pauseInterception;

  // Refs for stable callback references
  const onStateChangeRef = useRef(onStateChange);
  const onStepAddedRef = useRef(onStepAdded);
  const editorRef = useRef(editor);
  // Track if we're in single capture mode (exit after one step)
  const singleCaptureModeRef = useRef(false);
  // Track initial section ID from cursor position (for pre-populating section dropdown)
  const [initialSectionId, setInitialSectionId] = useState<string | null>(null);
  // Track if state has been restored from storage (to prevent re-saving initial state)
  const hasRestoredRef = useRef(false);

  // Restore state from storage on mount (for page refresh persistence)
  useEffect(() => {
    const restoreState = async () => {
      try {
        const persistedState = await fullScreenModeStorage.getState();

        // Only restore if we were in an active state (not inactive)
        if (persistedState && persistedState.state !== 'inactive') {
          // Restore mode state
          setState(persistedState.state);
          singleCaptureModeRef.current = persistedState.singleCapture;
          setInitialSectionId(persistedState.initialSectionId);

          // Restore bundled steps (note: these are serialized versions without DOM refs)
          const bundledStepsData = await fullScreenModeStorage.getBundledSteps();
          if (bundledStepsData.length > 0) {
            // Convert persisted steps back to PendingClickInfo (without element/event refs)
            const restoredSteps: PendingClickInfo[] = bundledStepsData.map((step: PersistedBundledStep) => ({
              element: null as unknown as HTMLElement, // Can't restore DOM reference
              event: null as unknown as MouseEvent, // Can't restore event reference
              selector: step.selector,
              action: step.action,
              selectorInfo: {
                method: step.selectorInfo.method,
                isUnique: step.selectorInfo.isUnique,
                matchCount: step.selectorInfo.matchCount,
                contextStrategy: step.selectorInfo.contextStrategy,
              },
              description: '',
              warnings: [],
              interactiveComment: step.interactiveComment,
              requirements: step.requirements,
            }));
            setBundledSteps(restoredSteps);
          }

          // Restore bundling action type
          const bundlingAction = await fullScreenModeStorage.getBundlingAction();
          if (bundlingAction) {
            setBundlingActionType(bundlingAction);
          }

          // Restore section info
          const sectionInfo = await fullScreenModeStorage.getSectionInfo();
          if (sectionInfo) {
            setBundlingSectionInfo(sectionInfo);
          }

          // Notify that state was restored
          console.log('[FullScreenMode] Restored state from storage:', persistedState.state);
        }

        hasRestoredRef.current = true;
      } catch (error) {
        console.warn('[FullScreenMode] Failed to restore state from storage:', error);
        hasRestoredRef.current = true;
      }
    };

    restoreState();
  }, []); // Only run on mount

  // Persist state changes to storage (for page refresh persistence)
  useEffect(() => {
    // Don't persist until we've restored (to prevent overwriting with initial state)
    if (!hasRestoredRef.current) {
      return;
    }

    const persistState = async () => {
      try {
        // Save current state
        await fullScreenModeStorage.setState({
          state,
          singleCapture: singleCaptureModeRef.current,
          initialSectionId,
        });

        // Save bundled steps (only the serializable parts)
        const stepsToSave: PersistedBundledStep[] = bundledSteps.map((step) => ({
          selector: step.selector,
          action: step.action,
          selectorInfo: {
            method: step.selectorInfo.method,
            isUnique: step.selectorInfo.isUnique,
            matchCount: step.selectorInfo.matchCount,
            contextStrategy: step.selectorInfo.contextStrategy,
          },
          interactiveComment: step.interactiveComment,
          requirements: step.requirements,
        }));
        await fullScreenModeStorage.setBundledSteps(stepsToSave);

        // Save bundling action type
        await fullScreenModeStorage.setBundlingAction(bundlingActionType);

        // Save section info
        await fullScreenModeStorage.setSectionInfo(bundlingSectionInfo);
      } catch (error) {
        console.warn('[FullScreenMode] Failed to persist state to storage:', error);
      }
    };

    persistState();
  }, [state, bundledSteps, bundlingActionType, bundlingSectionInfo, initialSectionId]);

  useEffect(() => {
    onStateChangeRef.current = onStateChange;
  }, [onStateChange]);

  useEffect(() => {
    onStepAddedRef.current = onStepAdded;
  }, [onStepAdded]);

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  // Element inspector for hover highlighting
  const { hoveredElement, domPath, cursorPosition } = useElementInspector({
    isActive: isIntercepting,
    excludeSelectors,
  });

  // State change handler
  const changeState = useCallback((newState: FullScreenModeState) => {
    setState(newState);
    if (onStateChangeRef.current) {
      onStateChangeRef.current(newState);
    }

    // Dispatch global event for sidebar to listen to
    const event = new CustomEvent('pathfinder-fullscreen-mode-changed', {
      detail: { state: newState, isActive: newState !== 'inactive' },
    });
    window.dispatchEvent(event);

    // Reset single capture mode and initial section when exiting
    if (newState === 'inactive') {
      singleCaptureModeRef.current = false;
      setInitialSectionId(null);
    }
  }, []);

  // Enter full screen mode
  // If singleCapture is true, will exit after capturing one step
  // If initialSectionId is provided, pre-populate the section dropdown
  const enterFullScreenMode = useCallback(
    (options?: { singleCapture?: boolean; initialSectionId?: string }) => {
      if (state === 'inactive') {
        singleCaptureModeRef.current = options?.singleCapture ?? false;
        setInitialSectionId(options?.initialSectionId ?? null);
        changeState('active');
      }
    },
    [state, changeState]
  );

  // Exit full screen mode
  const exitFullScreenMode = useCallback(() => {
    setPendingClick(null);
    setBundledSteps([]);
    changeState('inactive');
    // Explicitly clear storage when exiting
    fullScreenModeStorage.clear().catch((error) => {
      console.warn('[FullScreenMode] Failed to clear storage on exit:', error);
    });
  }, [changeState]);

  // Execute click programmatically on the original element
  const executeClick = useCallback((clickInfo: PendingClickInfo) => {
    const { element, event } = clickInfo;

    // Create a new click event with the same properties
    const newEvent = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: event.clientX,
      clientY: event.clientY,
      screenX: event.screenX,
      screenY: event.screenY,
      button: event.button,
      buttons: event.buttons,
    });

    // Mark as programmatic so we don't intercept it again
    (newEvent as any).__fullScreenModeExecuted = true;

    // Small delay to let React state settle before dispatching
    requestAnimationFrame(() => {
      element.dispatchEvent(newEvent);
    });
  }, []);

  // Escape a string for use in HTML attributes (escape quotes and special chars)
  const escapeHtmlAttribute = useCallback((str: string): string => {
    return str
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }, []);

  // Find a section by ID in the document
  const findSectionEndPos = useCallback((sectionId: string): number | null => {
    const currentEditor = editorRef.current;
    if (!currentEditor) {
      return null;
    }

    const { state: editorState } = currentEditor;
    const { doc } = editorState;

    let sectionEndPos: number | null = null;
    doc.descendants((node, pos) => {
      // Look for SequenceSection nodes with matching ID
      if (node.type.name === 'sequenceSection') {
        const attrs = node.attrs;
        if (attrs.id === sectionId) {
          // Find the list inside the section and get its end position
          node.descendants((childNode, childPos) => {
            if (childNode.type.name === 'bulletList' || childNode.type.name === 'orderedList') {
              sectionEndPos = pos + childPos + childNode.nodeSize - 1;
            }
          });
        }
      }
    });

    return sectionEndPos;
  }, []);

  // Build list item content for TipTap (can be HTML or JSON based on context)
  const buildListItemContent = useCallback(
    (step: FullScreenStep): string => {
      const escapedSelector = escapeHtmlAttribute(step.selector);
      const requirementsAttr = step.requirements
        ? ` data-requirements="${escapeHtmlAttribute(step.requirements)}"`
        : '';
      const valueAttr = step.value ? ` data-targetvalue="${escapeHtmlAttribute(step.value)}"` : '';

      // Build interactive comment if provided
      const commentHtml = step.interactiveComment
        ? `<span class="interactive-comment">${step.interactiveComment}</span>`
        : '';

      // Build the list item content
      const listItemContent = commentHtml + step.description;
      return `<li class="interactive" data-targetaction="${step.action}" data-reftarget="${escapedSelector}"${requirementsAttr}${valueAttr}>${listItemContent}</li>`;
    },
    [escapeHtmlAttribute]
  );

  // Add step to TipTap document
  const addStepToDocument = useCallback(
    (step: FullScreenStep) => {
      const currentEditor = editorRef.current;
      if (!currentEditor) {
        return;
      }

      const listItemHtml = buildListItemContent(step);

      // Get current document content
      const { state: editorState } = currentEditor;
      const { doc } = editorState;

      // Calculate end of document position for inserting new content
      const endOfDocPos = doc.content.size;

      // If step has a section ID, try to add to existing section or create new one
      if (step.sectionId) {
        // Try to find existing section with matching ID
        const sectionEndPos = findSectionEndPos(step.sectionId);

        if (sectionEndPos !== null) {
          // Add to existing section
          currentEditor.chain().focus().insertContentAt(sectionEndPos, listItemHtml).run();
          return;
        }

        // Create new section with this step - build complete HTML and insert at end of document
        const sectionTitle = step.sectionTitle ? `<h2>${step.sectionTitle}</h2>` : '';
        const sectionHtml = `${sectionTitle}<span id="${step.sectionId}" class="interactive" data-targetaction="sequence" data-reftarget="span#${step.sectionId}"><ul>${listItemHtml}</ul></span>`;

        // Insert at end of document (not at cursor position)
        currentEditor.chain().focus().insertContentAt(endOfDocPos, sectionHtml).run();
        return;
      }

      // No section - add as standalone step
      // Find the last TOP-LEVEL list in the document (direct child of doc, not nested)
      let lastTopLevelListEndPos: number | null = null;

      // Only check direct children of the document for top-level lists
      doc.forEach((node, offset) => {
        if (node.type.name === 'bulletList' || node.type.name === 'orderedList') {
          // This is a top-level list (direct child of doc)
          // Calculate end position: offset + 1 (for doc start) + nodeSize - 1 (to insert before closing)
          lastTopLevelListEndPos = offset + 1 + node.nodeSize - 1;
        }
      });

      if (lastTopLevelListEndPos !== null) {
        // Append to end of existing top-level list
        currentEditor.chain().focus().insertContentAt(lastTopLevelListEndPos, listItemHtml).run();
      } else {
        // Create new bullet list with the item at end of document
        currentEditor.chain().focus().insertContentAt(endOfDocPos, `<ul>${listItemHtml}</ul>`).run();
      }
    },
    [buildListItemContent, findSectionEndPos]
  );

  // Add multistep/guided to TipTap document
  const addMultistepToDocument = useCallback(
    (
      steps: PendingClickInfo[],
      description: string,
      actionType = 'multistep',
      sectionInfo?: { sectionId?: string; sectionTitle?: string; interactiveComment?: string; requirements?: string }
    ) => {
      const currentEditor = editorRef.current;
      if (!currentEditor) {
        return;
      }

      // Build internal spans for each step - escape selectors to handle quotes properly
      // Include per-step interactive comments and requirements
      const spansHtml = steps
        .map((step) => {
          const escapedSelector = escapeHtmlAttribute(step.selector);
          const valueAttr = step.action === 'formfill' ? ' data-targetvalue=""' : '';
          // Use step-specific requirements if provided, otherwise default to exists-reftarget
          const stepRequirements = step.requirements || 'exists-reftarget';
          const requirementsAttr = ` data-requirements="${escapeHtmlAttribute(stepRequirements)}"`;
          // Include interactive comment inside the span if provided
          const stepComment = step.interactiveComment
            ? `<span class="interactive-comment">${step.interactiveComment}</span>`
            : '';
          return `<span class="interactive" data-targetaction="${step.action}" data-reftarget="${escapedSelector}"${requirementsAttr}${valueAttr}>${stepComment}</span>`;
        })
        .join('\n    ');

      // Generate different HTML based on action type
      const actionAttr = actionType === 'guided' ? 'guided' : 'multistep';
      const extraAttrs = actionType === 'guided' ? ' data-step-timeout="45000"' : '';
      // Note: Per-step comments are inside each internal span, not at the listItem level
      // sectionInfo.requirements is for the SECTION, not individual steps

      const listItemHtml = `<li class="interactive" data-targetaction="${actionAttr}"${extraAttrs}>
    ${spansHtml}
    ${description}
</li>`;

      // Get current document state
      const { state: editorState } = currentEditor;
      const { doc } = editorState;

      // Calculate end of document position
      const endOfDocPos = doc.content.size;

      // If section is specified, try to add to section or create new one
      if (sectionInfo?.sectionId) {
        // Try to find existing section with matching ID
        const sectionEndPos = findSectionEndPos(sectionInfo.sectionId);

        if (sectionEndPos !== null) {
          // Add to existing section
          currentEditor.chain().focus().insertContentAt(sectionEndPos, listItemHtml).run();
          return;
        }

        // Create new section with this multistep - build complete HTML and insert at end of document
        const sectionTitle = sectionInfo.sectionTitle ? `<h2>${sectionInfo.sectionTitle}</h2>` : '';
        const sectionHtml = `${sectionTitle}<span id="${sectionInfo.sectionId}" class="interactive" data-targetaction="sequence" data-reftarget="span#${sectionInfo.sectionId}"><ul>${listItemHtml}</ul></span>`;

        // Insert at end of document (not at cursor position)
        currentEditor.chain().focus().insertContentAt(endOfDocPos, sectionHtml).run();
        return;
      }

      // No section - find the last TOP-LEVEL list in the document (direct child of doc, not nested)
      let lastTopLevelListEndPos: number | null = null;

      // Only check direct children of the document for top-level lists
      doc.forEach((node, offset) => {
        if (node.type.name === 'bulletList' || node.type.name === 'orderedList') {
          // This is a top-level list (direct child of doc)
          // Calculate end position: offset + 1 (for doc start) + nodeSize - 1 (to insert before closing)
          lastTopLevelListEndPos = offset + 1 + node.nodeSize - 1;
        }
      });

      if (lastTopLevelListEndPos !== null) {
        // Append to end of existing top-level list
        currentEditor.chain().focus().insertContentAt(lastTopLevelListEndPos, listItemHtml).run();
      } else {
        // Create new bullet list with the item at end of document (not at cursor)
        currentEditor.chain().focus().insertContentAt(endOfDocPos, `<ul>${listItemHtml}</ul>`).run();
      }
    },
    [escapeHtmlAttribute, findSectionEndPos]
  );

  // Save step and execute click
  const saveStepAndClick = useCallback(
    (data: StepEditorData) => {
      if (!pendingClick) {
        return;
      }

      const step: FullScreenStep = {
        action: data.actionType, // Use the user-selected action type, not the detected one
        selector: pendingClick.selector,
        description: data.description,
        requirements: data.requirements,
        value: data.formFillValue, // For formfill action
        interactiveComment: data.interactiveComment,
        sectionId: data.sectionId,
        sectionTitle: data.sectionTitle,
        isUnique: pendingClick.selectorInfo.isUnique,
        matchCount: pendingClick.selectorInfo.matchCount,
        contextStrategy: pendingClick.selectorInfo.contextStrategy,
      };

      // Add to recorded steps
      setRecordedSteps((prev) => [...prev, step]);

      // Add to document
      addStepToDocument(step);

      // Notify callback
      if (onStepAddedRef.current) {
        onStepAddedRef.current(step);
      }

      // Execute the click
      executeClick(pendingClick);

      // Clear pending
      setPendingClick(null);

      // In single capture mode, exit after one step; otherwise return to active state
      if (singleCaptureModeRef.current) {
        changeState('inactive');
      } else {
        changeState('active');
      }
    },
    [pendingClick, executeClick, addStepToDocument, changeState]
  );

  // Start bundling mode - save first step and collect subsequent clicks
  const startBundling = useCallback(
    (data: StepEditorData) => {
      if (!pendingClick) {
        return;
      }

      // Store the first step with ALL its data (description, comment, requirements)
      const firstStep: PendingClickInfo = {
        ...pendingClick,
        description: data.description,
        interactiveComment: data.interactiveComment, // Include comment in first step
        requirements: data.requirements, // Include requirements in first step
      };

      // Initialize bundling with the first step
      setBundledSteps([firstStep]);
      setBundlingActionType(data.actionType);

      // Save section info for when we finish bundling (for section creation, NOT for step comments)
      setBundlingSectionInfo({
        sectionId: data.sectionId,
        sectionTitle: data.sectionTitle,
        description: data.description,
        // Don't duplicate interactiveComment here - it's already in firstStep
      });

      // Execute the first click
      executeClick(pendingClick);

      // Clear pending and transition to bundling state
      setPendingClick(null);
      changeState('bundling');
    },
    [pendingClick, executeClick, changeState]
  );

  // Skip click without recording
  const skipClick = useCallback(() => {
    if (!pendingClick) {
      return;
    }

    // Execute the click without recording
    executeClick(pendingClick);

    // Clear pending
    setPendingClick(null);

    // In single capture mode, exit after skip; otherwise return to active state
    if (singleCaptureModeRef.current) {
      changeState('inactive');
    } else {
      changeState('active');
    }
  }, [pendingClick, executeClick, changeState]);

  // Cancel editing
  const cancelEdit = useCallback(() => {
    setPendingClick(null);
    setBundledSteps([]);
    setBundlingActionType(null);
    setBundlingSectionInfo(null);

    // In single capture mode, exit on cancel; otherwise return to active state
    if (singleCaptureModeRef.current) {
      changeState('inactive');
    } else {
      changeState('active');
    }
  }, [changeState]);

  // Save bundled step data (comment/requirements) and continue bundling
  const saveBundledStep = useCallback(
    (data: BundledStepEditorData) => {
      if (!pendingClick) {
        return;
      }

      // Add the step with comment/requirements to bundled steps
      const stepWithData: PendingClickInfo = {
        ...pendingClick,
        interactiveComment: data.interactiveComment,
        requirements: data.requirements,
      };

      setBundledSteps((prev) => [...prev, stepWithData]);

      // Execute the click
      executeClick(pendingClick);

      // Clear pending and return to bundling state
      setPendingClick(null);
      changeState('bundling');
    },
    [pendingClick, executeClick, changeState]
  );

  // Skip bundled step editing and just record the click
  const skipBundledStepEdit = useCallback(() => {
    if (!pendingClick) {
      return;
    }

    // Add the step without comment/requirements
    setBundledSteps((prev) => [...prev, pendingClick]);

    // Execute the click
    executeClick(pendingClick);

    // Clear pending and return to bundling state
    setPendingClick(null);
    changeState('bundling');
  }, [pendingClick, executeClick, changeState]);

  // Finish bundling mode
  const finishBundling = useCallback(
    (description: string) => {
      if (bundledSteps.length === 0) {
        setBundlingActionType(null);
        setBundlingSectionInfo(null);
        // In single capture mode, exit; otherwise return to active state
        if (singleCaptureModeRef.current) {
          changeState('inactive');
        } else {
          changeState('active');
        }
        return;
      }

      // Determine action type from bundlingActionType or default to multistep
      const actionType = bundlingActionType || 'multistep';

      // Use saved description from startBundling if available
      const finalDescription = bundlingSectionInfo?.description || description;

      // If only one step, just add as regular step with the original action
      if (bundledSteps.length === 1) {
        const step: FullScreenStep = {
          action: bundledSteps[0].action,
          selector: bundledSteps[0].selector,
          description: finalDescription,
          isUnique: bundledSteps[0].selectorInfo.isUnique,
          matchCount: bundledSteps[0].selectorInfo.matchCount,
          contextStrategy: bundledSteps[0].selectorInfo.contextStrategy,
          sectionId: bundlingSectionInfo?.sectionId,
          sectionTitle: bundlingSectionInfo?.sectionTitle,
          interactiveComment: bundlingSectionInfo?.interactiveComment,
          requirements: bundlingSectionInfo?.requirements,
        };

        setRecordedSteps((prev) => [...prev, step]);
        addStepToDocument(step);

        if (onStepAddedRef.current) {
          onStepAddedRef.current(step);
        }
      } else {
        // Create multistep/guided based on bundlingActionType - pass section info
        addMultistepToDocument(bundledSteps, finalDescription, actionType, bundlingSectionInfo || undefined);

        // Add to recorded steps as single entry
        const multistep: FullScreenStep = {
          action: actionType,
          selector: `${bundledSteps.length} steps`,
          description: finalDescription,
          isUnique: true,
          sectionId: bundlingSectionInfo?.sectionId,
          sectionTitle: bundlingSectionInfo?.sectionTitle,
        };
        setRecordedSteps((prev) => [...prev, multistep]);

        if (onStepAddedRef.current) {
          onStepAddedRef.current(multistep);
        }
      }

      setBundledSteps([]);
      setBundlingActionType(null);
      setBundlingSectionInfo(null);

      // In single capture mode, exit after completing bundling; otherwise return to active state
      if (singleCaptureModeRef.current) {
        changeState('inactive');
      } else {
        changeState('active');
      }
    },
    [bundledSteps, bundlingActionType, bundlingSectionInfo, addStepToDocument, addMultistepToDocument, changeState]
  );

  // Clear all steps
  const clearSteps = useCallback(() => {
    setRecordedSteps([]);
    setBundledSteps([]);
    setBundlingActionType(null);
    setBundlingSectionInfo(null);
    setPendingClick(null);
    // Clear storage as well
    fullScreenModeStorage.clear().catch((error) => {
      console.warn('[FullScreenMode] Failed to clear storage:', error);
    });
  }, []);

  // Click interception effect
  useEffect(() => {
    if (!isIntercepting) {
      return;
    }

    const handleClick = (event: MouseEvent) => {
      // Skip programmatic clicks we dispatched
      if ((event as any).__fullScreenModeExecuted) {
        return;
      }

      const target = event.target as HTMLElement;

      // Check if we should capture this element
      if (!shouldCaptureElement(target)) {
        return;
      }

      // Check exclusion selectors
      const shouldExclude = excludeSelectors.some((selector) => {
        try {
          return target.closest(selector);
        } catch {
          return false;
        }
      });

      if (shouldExclude) {
        return;
      }

      // Prevent the click from propagating
      event.preventDefault();
      event.stopImmediatePropagation();

      // Generate selector info
      const result = generateSelectorFromEvent(target, event);

      // Log warnings for debugging
      if (result.warnings.length > 0) {
        console.warn('[FullScreenMode] Selector warnings:', result.warnings);
      }

      const clickInfo: PendingClickInfo = {
        element: target,
        event,
        selector: result.selector,
        action: result.action,
        selectorInfo: result.selectorInfo,
        description: getActionDescription(result.action, target),
        warnings: result.warnings,
      };

      if (state === 'bundling') {
        // In bundling mode, pause to show mini editor for comment/requirements
        setPendingClick(clickInfo);
        changeState('bundling-editing');
      } else {
        // In active mode, show the full step editor
        setPendingClick(clickInfo);
        changeState('editing');
      }
    };

    // Use capture phase to intercept before any other handlers
    document.addEventListener('click', handleClick, { capture: true });

    // Handle Escape key when in active or bundling state
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (state === 'bundling') {
          // In bundling, Escape finishes bundling with generic description
          if (bundledSteps.length > 0) {
            finishBundling('Combined steps');
          } else {
            changeState('active');
          }
        } else {
          // In active state, exit full screen mode
          exitFullScreenMode();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('click', handleClick, { capture: true });
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    isIntercepting,
    state,
    excludeSelectors,
    executeClick,
    finishBundling,
    bundledSteps.length,
    exitFullScreenMode,
    changeState,
  ]);

  // Track existing sections in state - updated via effect
  const [existingSections, setExistingSections] = useState<SectionInfo[]>([]);

  // Update existing sections when editor content changes
  // This runs always (not just when full screen is active) so sections are available for editing
  useEffect(() => {
    // Use the editor prop directly (not ref) for reliable timing
    if (!editor) {
      return;
    }

    const extractSections = () => {
      const sections: SectionInfo[] = [];
      const { state: editorState } = editor;
      const { doc } = editorState;

      doc.descendants((node) => {
        // Look for sequence sections (span with data-targetaction="sequence")
        if (node.type.name === 'sequenceSection') {
          const id = node.attrs.id;
          if (id) {
            sections.push({
              id,
              title: node.attrs.title || undefined,
            });
          }
        }
      });

      setExistingSections(sections);
    };

    // Extract sections initially
    extractSections();

    // Subscribe to editor updates to refresh sections
    const handleUpdate = () => {
      extractSections();
    };

    editor.on('update', handleUpdate);

    return () => {
      editor.off('update', handleUpdate);
    };
  }, [editor]); // Re-run when editor changes

  // Memoize return value
  return useMemo(
    () => ({
      state,
      isActive,
      pendingClick,
      bundledSteps,
      bundlingActionType,
      recordedSteps,
      stepCount: recordedSteps.length,
      existingSections,
      initialSectionId,
      enterFullScreenMode,
      exitFullScreenMode,
      saveStepAndClick,
      startBundling,
      skipClick,
      cancelEdit,
      finishBundling,
      saveBundledStep,
      skipBundledStepEdit,
      clearSteps,
      // Inspector data
      hoveredElement,
      domPath,
      cursorPosition,
    }),
    [
      state,
      isActive,
      pendingClick,
      bundledSteps,
      bundlingActionType,
      recordedSteps,
      existingSections,
      initialSectionId,
      enterFullScreenMode,
      exitFullScreenMode,
      saveStepAndClick,
      startBundling,
      skipClick,
      cancelEdit,
      finishBundling,
      saveBundledStep,
      skipBundledStepEdit,
      clearSteps,
      hoveredElement,
      domPath,
      cursorPosition,
    ]
  );
}
