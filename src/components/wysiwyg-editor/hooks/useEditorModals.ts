import { useState, useCallback, useEffect, useRef } from 'react';
import type { Editor } from '@tiptap/react';

// Utils
import { debug, error as logError } from '../utils/logger';

// Types
import type { EditState, InteractiveElementType } from '../types';

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
  handleFormSubmit: (attributes: Record<string, any>) => void;
  commentDialogMode: 'insert' | 'edit';
  commentDialogInitialText: string;
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
  const [isCommentDialogOpen, setIsCommentDialogOpen] = useState(false);
  const isManuallyControlledRef = useRef(false);

  // Determine comment dialog mode and initial text from editState
  const commentDialogMode: 'insert' | 'edit' = editState?.type === 'comment' ? 'edit' : 'insert';
  const commentDialogInitialText = editState?.type === 'comment' ? editState.commentText || '' : '';

  const openModal = useCallback(() => {
    setIsModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
    stopEditing();
  }, [stopEditing]);

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

  // Handle form submission
  const handleFormSubmit = useCallback(
    (attributes: Record<string, any>) => {
      if (!editor || !editState) {
        return;
      }

      debug('[useEditorModals] Form submitted', { attributes, editState });

      // Update attributes based on element type
      // Note: Comments are handled by CommentDialog, not FormModal
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
    if (!editor) {
      return;
    }

    // Insert a new sequence section at cursor
    editor
      .chain()
      .focus()
      .insertContent({
        type: 'sequenceSection',
        attrs: {
          'data-targetaction': 'sequence',
          'data-reftarget': 'span#guide-section-1',
          class: 'interactive',
        },
        content: [
          {
            type: 'heading',
            attrs: { level: 3 },
            content: [{ type: 'text', text: 'Section Title' }],
          },
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Step 1' }],
                  },
                ],
              },
            ],
          },
        ],
      })
      .run();
  }, [editor]);

  // Handle adding comment
  const handleAddComment = useCallback(() => {
    debug('[useEditorModals] Add comment clicked');
    if (!editor) {
      return;
    }

    // Clear any existing edit state and open comment dialog for insertion
    stopEditing();
    setIsCommentDialogOpen(true);
  }, [editor, stopEditing]);

  // Handle inserting/updating comment from dialog
  const handleInsertComment = useCallback(
    (commentText: string) => {
      if (!editor || !commentText.trim()) {
        return;
      }

      // Check if we're editing an existing comment
      if (editState?.type === 'comment' && editState.pos !== undefined) {
        debug('[useEditorModals] Updating comment', { commentText, pos: editState.pos });

        try {
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
            // Replace the comment node with updated content
            editor
              .chain()
              .focus()
              .setTextSelection({ from: commentPos, to: commentPos + commentNode.nodeSize })
              .deleteSelection()
              .insertContent({
                type: 'interactiveComment',
                attrs: {
                  class: 'interactive-comment',
                },
                content: [{ type: 'text', text: commentText }],
              })
              .run();

            debug('[useEditorModals] Comment updated successfully');
            stopEditing();
          } else {
            logError('[useEditorModals] Could not find comment node at position:', pos);
          }
        } catch (error) {
          logError('[useEditorModals] Failed to update comment:', error);
        }
      } else {
        debug('[useEditorModals] Inserting comment', { commentText });

        try {
          // Insert comment at cursor position
          editor
            .chain()
            .focus()
            .insertContent({
              type: 'interactiveComment',
              attrs: {
                class: 'interactive-comment',
              },
              content: [{ type: 'text', text: commentText }],
            })
            .run();

          debug('[useEditorModals] Comment inserted successfully');
        } catch (error) {
          logError('[useEditorModals] Failed to insert comment:', error);
        }
      }
    },
    [editor, editState, stopEditing]
  );

  // Open comment dialog when editing a comment (only if not manually controlled)
  // Synchronizing UI state (dialog open/closed) with editState is necessary for proper UX
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
    handleFormSubmit,
    commentDialogMode,
    commentDialogInitialText,
  };
}
