import { useState, useCallback, useEffect, useRef } from 'react';
import type { EditState } from '../types';

export interface UseCommentDialogOptions {
  editState: EditState | null;
  stopEditing: () => void;
}

export interface UseCommentDialogReturn {
  isCommentDialogOpen: boolean;
  openCommentDialog: () => void;
  closeCommentDialog: () => void;
  commentDialogMode: 'insert' | 'edit';
  commentDialogInitialText: string;
}

/**
 * Hook for managing comment dialog state
 * Handles synchronization between editState and dialog open/closed state
 */
export function useCommentDialog({ editState, stopEditing }: UseCommentDialogOptions): UseCommentDialogReturn {
  const [isCommentDialogOpen, setIsCommentDialogOpen] = useState(false);
  const isManuallyControlledRef = useRef(false);

  // Determine comment dialog mode and initial text from editState
  const commentDialogMode: 'insert' | 'edit' = editState?.type === 'comment' ? 'edit' : 'insert';
  const commentDialogInitialText = editState?.type === 'comment' ? editState.commentText || '' : '';

  const openCommentDialog = useCallback(() => {
    isManuallyControlledRef.current = true;
    setIsCommentDialogOpen(true);
  }, []);

  const closeCommentDialog = useCallback(() => {
    isManuallyControlledRef.current = true;
    setIsCommentDialogOpen(false);
    // Clear edit state when closing comment dialog
    if (editState?.type === 'comment') {
      stopEditing();
    }
  }, [editState, stopEditing]);

  // Synchronize dialog state with editState (only if not manually controlled)
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (isManuallyControlledRef.current) {
      // Reset manual control flag when editState changes
      if (editState?.type !== 'comment') {
        isManuallyControlledRef.current = false;
      }
      return;
    }

    if (editState?.type === 'comment' && !isCommentDialogOpen) {
      setIsCommentDialogOpen(true);
    } else if (editState?.type !== 'comment' && isCommentDialogOpen) {
      setIsCommentDialogOpen(false);
    }
  }, [editState, isCommentDialogOpen]);
  /* eslint-enable react-hooks/set-state-in-effect */

  return {
    isCommentDialogOpen,
    openCommentDialog,
    closeCommentDialog,
    commentDialogMode,
    commentDialogInitialText,
  };
}
