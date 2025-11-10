import { useState, useCallback } from 'react';
import type { Editor } from '@tiptap/react';

// Utils
import { debug, error as logError } from '../utils/logger';

// Types
import type { EditState, InteractiveElementType } from '../types';

export interface UseEditorModalsOptions {
  editor: Editor | null;
  editState: EditState | null;
  startEditing: (type: InteractiveElementType, attributes: Record<string, string>, pos: number) => void;
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

  const openModal = useCallback(() => {
    setIsModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
    stopEditing();
  }, [stopEditing]);

  const openCommentDialog = useCallback(() => {
    setIsCommentDialogOpen(true);
  }, []);

  const closeCommentDialog = useCallback(() => {
    setIsCommentDialogOpen(false);
  }, []);

  // Handle form submission
  const handleFormSubmit = useCallback(
    (attributes: Record<string, any>) => {
      if (!editor || !editState) {
        return;
      }

      debug('[useEditorModals] Form submitted', { attributes, editState });

      // Update attributes based on element type
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
            editor.commands.updateAttributes('interactiveComment', attributes);
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

    // Open comment dialog
    setIsCommentDialogOpen(true);
  }, [editor]);

  // Handle inserting comment from dialog
  const handleInsertComment = useCallback(
    (commentText: string) => {
      if (!editor || !commentText.trim()) {
        return;
      }

      debug('[useEditorModals] Inserting comment', { commentText });

      try {
        // Insert comment at cursor position
        // TipTap will automatically handle the text content
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
    },
    [editor]
  );

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
  };
}

