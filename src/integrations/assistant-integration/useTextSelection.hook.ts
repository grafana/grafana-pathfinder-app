import { useState, useEffect, useCallback, useRef, RefObject } from 'react';
import { isValidSelection } from './assistant-context.utils';
import type { TextSelectionState } from '../../types/hooks.types';

/** Delay (ms) after user stops selecting before showing the popover */
const SELECTION_DEBOUNCE_MS = 400;

/**
 * Hook to detect and track text selection within a container.
 * Debounces updates so the popover appears after the user finishes selecting,
 * not while they are still dragging.
 */
export const useTextSelection = (containerRef: RefObject<HTMLElement>): TextSelectionState => {
  const [selectionState, setSelectionState] = useState<TextSelectionState>({
    selectedText: '',
    position: null,
    isValid: false,
  });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearDebounceTimer = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, []);

  const clearSelectionState = useCallback(() => {
    clearDebounceTimer();
    setSelectionState({
      selectedText: '',
      position: null,
      isValid: false,
    });
  }, [clearDebounceTimer]);

  const handleSelectionChange = useCallback(() => {
    try {
      const selection = window.getSelection();

      if (!selection || selection.rangeCount === 0) {
        clearSelectionState();
        return;
      }

      const selectedText = selection.toString();

      // Check if selection is valid and within our container
      if (!isValidSelection(selectedText)) {
        clearSelectionState();
        return;
      }

      // Verify selection is within the content container
      if (containerRef.current) {
        const range = selection.getRangeAt(0);
        const selectionContainer = range.commonAncestorContainer;

        // Check if selection is within our container
        const isWithinContainer =
          containerRef.current === selectionContainer || containerRef.current.contains(selectionContainer as Node);

        if (!isWithinContainer) {
          clearSelectionState();
          return;
        }
      }

      // Get position of the selection for popover placement
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();

      // Determine button placement (top or bottom based on space)
      const containerRect = containerRef.current?.getBoundingClientRect();
      const BUTTON_HEIGHT = 40;
      let buttonPlacement: 'top' | 'bottom' = 'top';

      if (containerRect) {
        const spaceAbove = rect.top - containerRect.top;
        // If not enough space above, place at bottom
        if (spaceAbove < BUTTON_HEIGHT) {
          buttonPlacement = 'bottom';
        }
      }

      const scrollY = window.scrollY;
      const scrollX = window.scrollX;

      // Debounce: wait for user to finish selecting before showing popover
      clearDebounceTimer();
      debounceRef.current = setTimeout(() => {
        setSelectionState({
          selectedText: selectedText.trim(),
          position: {
            top: rect.top + scrollY,
            left: rect.left + scrollX + rect.width / 2,
            width: rect.width,
            height: rect.height,
            buttonPlacement,
          },
          isValid: true,
        });
        debounceRef.current = null;
      }, SELECTION_DEBOUNCE_MS);
    } catch (error) {
      console.warn('[useTextSelection] Error handling selection change:', error);
      clearSelectionState();
    }
  }, [containerRef, clearDebounceTimer, clearSelectionState]);

  useEffect(() => {
    // Listen for selection changes
    document.addEventListener('selectionchange', handleSelectionChange);

    // Also listen for mouse up events (more reliable for some browsers)
    document.addEventListener('mouseup', handleSelectionChange);

    // Clear selection when clicking outside
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        clearSelectionState();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
      document.removeEventListener('mouseup', handleSelectionChange);
      document.removeEventListener('mousedown', handleClickOutside);
      clearDebounceTimer();
    };
  }, [handleSelectionChange, containerRef, clearDebounceTimer, clearSelectionState]);

  return selectionState;
};
