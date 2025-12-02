import { useState, useCallback } from 'react';
import type { Editor } from '@tiptap/react';

// Utils
import { debug, error as logError } from '../utils/logger';

// Constants
import { ACTION_TYPES } from '../../../constants/interactive-config';
import { CSS_CLASSES } from '../../../constants/editor-config';

// Types
import type { EditState, InteractiveElementType, InteractiveAttributesOutput } from '../types';

// Hooks
import { useCommentDialog } from './useCommentDialog';

export interface UseEditorModalsOptions {
  editor: Editor | null;
  editState: EditState | null;
  startEditing: (
    type: InteractiveElementType,
    attributes: Record<string, string>,
    pos: number,
    commentText?: string
  ) => void;
  stopEditing: () => void;
}

export interface UseEditorModalsReturn {
  isModalOpen: boolean;
  isCommentDialogOpen: boolean;
  openModal: () => void;
  closeModal: () => void;
  openCommentDialog: () => void;
  closeCommentDialog: () => void;
  handleAddInteractive: () => void;
  handleAddSequence: () => void;
  handleAddComment: () => void;
  handleInsertComment: (commentText: string) => void;
  handleDeleteComment: () => void;
  handleFormSubmit: (attributes: InteractiveAttributesOutput) => void;
  commentDialogMode: 'insert' | 'edit';
  commentDialogInitialText: string;
  initialSelectedActionType: string | null;
}

/**
 * Hook for managing modal state and handlers for interactive element editing
 */
export function useEditorModals({
  editor,
  editState,
  startEditing,
  stopEditing,
}: UseEditorModalsOptions): UseEditorModalsReturn {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [initialSelectedActionType, setInitialSelectedActionType] = useState<string | null>(null);

  // Use separate hook for comment dialog state management
  const { isCommentDialogOpen, openCommentDialog, closeCommentDialog, commentDialogMode, commentDialogInitialText } =
    useCommentDialog({ editState, stopEditing });

  const openModal = useCallback(() => {
    setIsModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
    setInitialSelectedActionType(null);
    stopEditing();
  }, [stopEditing]);

  // Handle form submission
  const handleFormSubmit = useCallback(
    (attributes: InteractiveAttributesOutput) => {
      if (!editor || !editState) {
        return;
      }

      debug('[useEditorModals] Form submitted', { attributes, editState });

      // Update attributes based on element type
      // Note: Comments are handled by CommentDialog, not FormPanel
      const { type } = editState;

      try {
        switch (type) {
          case 'listItem':
            editor.commands.updateAttributes('listItem', attributes);
            break;
          case 'sequence':
            editor.commands.updateAttributes('sequenceSection', attributes);
            break;
          case 'span':
            editor.commands.updateAttributes('interactiveSpan', attributes);
            break;
          case 'comment':
            // Comments are handled by CommentDialog, skip here
            debug('[useEditorModals] Comment editing handled by CommentDialog');
            break;
        }

        debug('[useEditorModals] Attributes updated successfully');
      } catch (error) {
        logError('[useEditorModals] Failed to update attributes:', error);
      }

      stopEditing();
    },
    [editor, editState, stopEditing]
  );

  // Handle adding interactive action
  const handleAddInteractive = useCallback(() => {
    debug('[useEditorModals] Add interactive action clicked');
    // Open modal with no edit state to show action selector
    stopEditing();
    setIsModalOpen(true);
  }, [stopEditing]);

  // Handle adding sequence section
  const handleAddSequence = useCallback(() => {
    debug('[useEditorModals] Add sequence section clicked');
    // Open modal with sequence action type pre-selected
    stopEditing();
    setInitialSelectedActionType(ACTION_TYPES.SEQUENCE);
    setIsModalOpen(true);
  }, [stopEditing]);

  // Handle adding comment
  const handleAddComment = useCallback(() => {
    debug('[useEditorModals] Add comment clicked');
    if (!editor) {
      return;
    }

    // Clear any existing edit state and open comment dialog for insertion
    stopEditing();
    openCommentDialog();
  }, [editor, stopEditing, openCommentDialog]);

  // Handle inserting/updating comment from dialog
  // Comments are now atomic nodes - text is stored in the 'text' attribute
  const handleInsertComment = useCallback(
    (commentText: string) => {
      if (!editor || !commentText.trim()) {
        return;
      }

      try {
        // Check if we're editing an existing comment
        if (editState?.type === 'comment' && editState.pos !== undefined) {
          debug('[useEditorModals] Updating atomic comment', { commentText, pos: editState.pos });

          // Find the comment node at the position
          const { pos } = editState;
          const { state } = editor;
          const { doc } = state;

          // Find the comment node
          let commentNode: any = null;
          let commentPos = pos;

          doc.nodesBetween(pos, pos + 1, (node, nodePos) => {
            if (node.type.name === 'interactiveComment') {
              commentNode = node;
              commentPos = nodePos;
              return false; // stop iteration
            }
            return true;
          });

          if (commentNode) {
            // For atomic nodes, replace with new node that has updated text attribute
            editor
              .chain()
              .focus()
              .setTextSelection({ from: commentPos, to: commentPos + commentNode.nodeSize })
              .deleteSelection()
              .insertContent({
                type: 'interactiveComment',
                attrs: {
                  class: CSS_CLASSES.INTERACTIVE_COMMENT,
                  text: commentText, // Store text in attribute for atomic node
                },
              })
              .run();

            debug('[useEditorModals] Atomic comment updated successfully');
            stopEditing();
          } else {
            logError('[useEditorModals] Could not find comment node at position:', pos);
          }
        } else {
          debug('[useEditorModals] Inserting atomic comment', { commentText });

          // Insert atomic comment node with text in attribute
          editor
            .chain()
            .focus()
            .insertContent({
              type: 'interactiveComment',
              attrs: {
                class: CSS_CLASSES.INTERACTIVE_COMMENT,
                text: commentText, // Store text in attribute for atomic node
              },
            })
            .run();

          debug('[useEditorModals] Atomic comment inserted successfully');
        }
      } catch (error) {
        logError('[useEditorModals] Failed to handle comment:', error);
      }
    },
    [editor, editState, stopEditing]
  );

  // Handle deleting comment from dialog
  const handleDeleteComment = useCallback(() => {
    if (!editor || editState?.type !== 'comment' || editState.pos === undefined) {
      return;
    }

    debug('[useEditorModals] Deleting comment', { pos: editState.pos });

    try {
      const { pos } = editState;
      const { state } = editor;
      const { doc } = state;

      // Find the comment node at the position
      let commentNode: any = null;
      let commentPos = pos;

      doc.nodesBetween(pos, pos + 1, (node, nodePos) => {
        if (node.type.name === 'interactiveComment') {
          commentNode = node;
          commentPos = nodePos;
          return false; // stop iteration
        }
        return true;
      });

      if (commentNode) {
        // Delete the comment node
        editor
          .chain()
          .focus()
          .setTextSelection({ from: commentPos, to: commentPos + commentNode.nodeSize })
          .deleteSelection()
          .run();

        debug('[useEditorModals] Comment deleted successfully');
      } else {
        logError('[useEditorModals] Could not find comment node at position:', pos);
      }
    } catch (error) {
      logError('[useEditorModals] Failed to delete comment:', error);
    }

    closeCommentDialog();
    stopEditing();
  }, [editor, editState, closeCommentDialog, stopEditing]);

  return {
    isModalOpen,
    isCommentDialogOpen,
    openModal,
    closeModal,
    openCommentDialog,
    closeCommentDialog,
    handleAddInteractive,
    handleAddSequence,
    handleAddComment,
    handleInsertComment,
    handleDeleteComment,
    handleFormSubmit,
    commentDialogMode,
    commentDialogInitialText,
    initialSelectedActionType,
  };
}
