import { useState, useEffect, useCallback, RefObject } from 'react';
import { isValidSelection } from './assistant-context.utils';
import type { TextSelectionState } from '../../types/hooks.types';

/**
 * Hook to detect and track text selection within a container
 */
export const useTextSelection = (containerRef: RefObject<HTMLElement>): TextSelectionState => {
  const [selectionState, setSelectionState] = useState<TextSelectionState>({
    selectedText: '',
    position: null,
    isValid: false,
  });

  const handleSelectionChange = useCallback(() => {
    try {
      const selection = window.getSelection();

      if (!selection || selection.rangeCount === 0) {
        setSelectionState({
          selectedText: '',
          position: null,
          isValid: false,
        });
        return;
      }

      const selectedText = selection.toString();

      // Check if selection is valid and within our container
      if (!isValidSelection(selectedText)) {
        setSelectionState({
          selectedText: '',
          position: null,
          isValid: false,
        });
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
          setSelectionState({
            selectedText: '',
            position: null,
            isValid: false,
          });
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

      setSelectionState({
        selectedText: selectedText.trim(),
        position: {
          top: rect.top + window.scrollY,
          left: rect.left + window.scrollX + rect.width / 2,
          width: rect.width,
          height: rect.height,
          buttonPlacement,
        },
        isValid: true,
      });
    } catch (error) {
      console.warn('[pathfinder]', '[useTextSelection] Error handling selection change:', error);
      setSelectionState({
        selectedText: '',
        position: null,
        isValid: false,
      });
    }
  }, [containerRef]);

  useEffect(() => {
    // Listen for selection changes
    document.addEventListener('selectionchange', handleSelectionChange);

    // Also listen for mouse up events (more reliable for some browsers)
    document.addEventListener('mouseup', handleSelectionChange);

    // Clear selection when clicking outside
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setSelectionState({
          selectedText: '',
          position: null,
          isValid: false,
        });
      }
    };

    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
      document.removeEventListener('mouseup', handleSelectionChange);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [handleSelectionChange, containerRef]);

  return selectionState;
};
