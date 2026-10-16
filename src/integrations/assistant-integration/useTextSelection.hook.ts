import { useState, useEffect, useCallback, useRef, RefObject } from 'react';
import { isValidSelection } from './assistant-context.utils';
import type { TextSelectionState } from '../../types/hooks.types';
import { logger } from '../../lib/logging';

const SELECTION_DEBOUNCE_MS = 400;

export const useTextSelection = (containerRef: RefObject<HTMLElement | null>): TextSelectionState => {
  const [selectionState, setSelectionState] = useState<TextSelectionState>({
    selectedText: '',
    position: null,
    isValid: false,
  });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearDebounceTimer = useCallback(() => {
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, []);

  const clearSelectionState = useCallback(() => {
    clearDebounceTimer();
    setSelectionState({ selectedText: '', position: null, isValid: false });
  }, [clearDebounceTimer]);

  const readSelection = useCallback(() => {
    debounceRef.current = null;
    try {
      const container = containerRef.current;
      const selection = window.getSelection();
      if (!container || !selection || selection.rangeCount === 0 || !isValidSelection(selection.toString())) {
        clearSelectionState();
        return;
      }
      const range = selection.getRangeAt(0);
      if (!container.contains(range.commonAncestorContainer)) {
        clearSelectionState();
        return;
      }
      const rect = range.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      setSelectionState({
        selectedText: selection.toString().trim(),
        position: {
          top: rect.top - containerRect.top - container.clientTop + container.scrollTop,
          left: rect.left - containerRect.left - container.clientLeft + container.scrollLeft + rect.width / 2,
          width: rect.width,
          height: rect.height,
          buttonPlacement: rect.top - Math.max(containerRect.top, 0) < 40 ? 'bottom' : 'top',
        },
        isValid: true,
      });
    } catch (error) {
      logger.warn('[useTextSelection] Error handling selection change', { error });
      clearSelectionState();
    }
  }, [containerRef, clearSelectionState]);

  const handleSelectionChange = useCallback(() => {
    clearSelectionState();
    debounceRef.current = setTimeout(readSelection, SELECTION_DEBOUNCE_MS);
  }, [clearSelectionState, readSelection]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        clearSelectionState();
      }
    };

    const handleMouseUp = (event: MouseEvent) => {
      if (containerRef.current?.contains(event.target as Node)) {
        handleSelectionChange();
      }
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('mousedown', handleClickOutside);
    // Nested code blocks and the guide panel scroll independently of the window.
    window.addEventListener('scroll', clearSelectionState, true);
    window.addEventListener('resize', clearSelectionState);
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', clearSelectionState, true);
      window.removeEventListener('resize', clearSelectionState);
      clearDebounceTimer();
    };
  }, [handleSelectionChange, containerRef, clearDebounceTimer, clearSelectionState]);

  return selectionState;
};
