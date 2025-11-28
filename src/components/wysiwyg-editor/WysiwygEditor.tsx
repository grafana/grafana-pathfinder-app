import React, { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import { EditorContent, Editor } from '@tiptap/react';
import { useStyles2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';

// Components
import Toolbar from './Toolbar';
import FormPanel from './FormPanel';
import CommentDialog from './CommentDialog';
import ExportDialog from './ExportDialog';
import BubbleMenuBar from './BubbleMenuBar';
import { FullScreenModeOverlay } from './FullScreenModeOverlay';
import { FullScreenStepEditor, type EditElementData, type EditSaveData } from './FullScreenStepEditor';

// Hooks
import { useEditState } from './hooks/useEditState';
import { useEditorInitialization } from './hooks/useEditorInitialization';
import { useEditorPersistence } from './hooks/useEditorPersistence';
import { useEditorActions } from './hooks/useEditorActions';
import { useEditorModals } from './hooks/useEditorModals';
import { useFullScreenMode } from './hooks/useFullScreenMode';

// Constants
import { CSS_CLASSES } from '../../constants/editor-config';
import { ACTION_TYPES } from '../../constants/interactive-config';

// Utils
import { debug, error as logError } from './utils/logger';

// Styles
import { getSharedPanelStyles } from './editor.styles';

// Test IDs
import { testIds } from '../testIds';

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(2),
    padding: theme.spacing(2),
    height: '100%',
    backgroundColor: theme.colors.background.primary,
    position: 'relative',
  }),
  editorWrapperHidden: css({
    visibility: 'hidden',
    position: 'absolute',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
  }),
  title: css({
    fontSize: theme.typography.h2.fontSize,
    fontWeight: theme.typography.h2.fontWeight,
    margin: 0,
    color: theme.colors.text.primary,
  }),
});

/**
 * Extract text content from a ProseMirror node, excluding comments
 */
function extractTextContent(node: any): string {
  let text = '';
  if (node.content) {
    node.content.forEach((child: any) => {
      // Skip interactiveComment nodes
      if (child.type?.name === 'interactiveComment') {
        return;
      }
      if (child.type?.name === 'text' || child.isText) {
        text += child.text || '';
      } else if (child.content) {
        text += extractTextContent(child);
      }
    });
  }
  return text.trim();
}

/**
 * Extract interactive comment text from a ProseMirror node's children
 */
function extractCommentText(node: any): string {
  let commentText = '';
  if (node.content) {
    node.content.forEach((child: any) => {
      if (child.type?.name === 'interactiveComment') {
        // Extract text from the comment node
        if (child.content) {
          child.content.forEach((textNode: any) => {
            if (textNode.type?.name === 'text' || textNode.isText) {
              commentText += textNode.text || '';
            }
          });
        }
      }
    });
  }
  return commentText.trim();
}

/**
 * Extract nested steps from a multistep or guided block
 */
function extractNestedSteps(node: any): Array<{
  actionType: string;
  refTarget: string;
  targetValue?: string;
  requirements?: string;
  interactiveComment?: string;
  textContent?: string;
}> {
  const steps: Array<{
    actionType: string;
    refTarget: string;
    targetValue?: string;
    requirements?: string;
    interactiveComment?: string;
    textContent?: string;
  }> = [];

  if (!node.content) {
    return steps;
  }

  // For list items (multistep/guided), look for nested interactive spans
  node.content.forEach((child: any) => {
    // Check if this is an interactive span
    if (child.type?.name === 'interactiveSpan' && child.attrs) {
      const actionType = child.attrs['data-targetaction'];
      const refTarget = child.attrs['data-reftarget'];

      // Skip if it's another multistep/guided container
      if (actionType === 'multistep' || actionType === 'guided') {
        return;
      }

      if (actionType && refTarget) {
        steps.push({
          actionType,
          refTarget,
          targetValue: child.attrs['data-targetvalue'] || undefined,
          requirements: child.attrs['data-requirements'] || undefined,
          interactiveComment: extractCommentText(child) || undefined,
          textContent: extractTextContent(child) || undefined,
        });
      }
    }
    // Also check paragraphs and other containers
    else if (child.content) {
      child.content.forEach((grandChild: any) => {
        if (grandChild.type?.name === 'interactiveSpan' && grandChild.attrs) {
          const actionType = grandChild.attrs['data-targetaction'];
          const refTarget = grandChild.attrs['data-reftarget'];

          if (actionType === 'multistep' || actionType === 'guided') {
            return;
          }

          if (actionType && refTarget) {
            steps.push({
              actionType,
              refTarget,
              targetValue: grandChild.attrs['data-targetvalue'] || undefined,
              requirements: grandChild.attrs['data-requirements'] || undefined,
              interactiveComment: extractCommentText(grandChild) || undefined,
              textContent: extractTextContent(grandChild) || undefined,
            });
          }
        }
      });
    }
  });

  return steps;
}

/**
 * Get the current section ID from the editor's cursor position
 * Returns the section ID if cursor is inside a sequenceSection, null otherwise
 */
function getCurrentSectionId(editor: Editor | null): string | null {
  if (!editor) {
    return null;
  }

  const { state } = editor;
  const { selection, doc } = state;
  const pos = selection.from;

  // Walk up the document tree from cursor position to find a sequenceSection
  let sectionId: string | null = null;

  // Use resolvedPos to find the path from cursor to root
  const $pos = doc.resolve(pos);

  // Check each ancestor node
  for (let depth = $pos.depth; depth >= 0; depth--) {
    const node = $pos.node(depth);
    if (node.type.name === 'sequenceSection') {
      sectionId = node.attrs.id || null;
      break;
    }
  }

  return sectionId;
}

/**
 * WysiwygEditor Component
 *
 * Main WYSIWYG editor for creating interactive guides.
 * Integrates Tiptap editor with custom extensions, toolbar, and step editor modal.
 */
export const WysiwygEditor: React.FC = () => {
  const styles = useStyles2(getStyles);
  const sharedStyles = useStyles2(getSharedPanelStyles);
  const { editState, startEditing, stopEditing } = useEditState();

  // State for section creation form
  const [isSectionFormOpen, setIsSectionFormOpen] = useState(false);

  // Use ref to store openModal callback to break circular dependency
  const openModalRef = useRef<() => void>(() => {});

  // Initialize editor with modal callback from ref
  const { editor } = useEditorInitialization({
    startEditing,
    stopEditing,
    onModalOpen: () => openModalRef.current(),
  });

  // Initialize modals with editor instance
  const {
    isModalOpen,
    isCommentDialogOpen,
    openModal,
    closeModal,
    closeCommentDialog,
    handleAddComment,
    handleInsertComment,
    commentDialogMode,
    commentDialogInitialText,
  } = useEditorModals({
    editor,
    editState,
    startEditing,
    stopEditing,
  });

  // Update ref when openModal changes
  useEffect(() => {
    openModalRef.current = openModal;
  }, [openModal]);

  // Open modal when editState changes (for non-comment, non-sequence elements)
  useEffect(() => {
    if (editState && editState.type !== 'comment' && editState.type !== 'sequence' && !isModalOpen) {
      openModal();
    }
  }, [editState, isModalOpen, openModal]);

  // Auto-save functionality
  useEditorPersistence({ editor });

  // Editor actions including export dialog state
  const { isExportDialogOpen, exportMode, openExportDialog, closeExportDialog, performExport, testGuide, resetGuide } =
    useEditorActions({ editor });

  // Toolbar callbacks for copy/download
  const handleCopy = useCallback(() => {
    openExportDialog('copy');
  }, [openExportDialog]);

  const handleDownload = useCallback(() => {
    openExportDialog('download');
  }, [openExportDialog]);

  // Full screen authoring mode
  // Pause interception when any modal/form is open
  const fullScreenMode = useFullScreenMode({
    editor,
    pauseInterception: isModalOpen || isSectionFormOpen,
  });

  // Toggle full screen mode
  const handleToggleFullScreen = useCallback(() => {
    if (fullScreenMode.isActive) {
      fullScreenMode.exitFullScreenMode();
    } else {
      fullScreenMode.enterFullScreenMode();
    }
  }, [fullScreenMode]);

  // Handle "Action" button - enter single capture mode (exit after one step)
  // Also detects current section context from cursor position
  const handleAddInteractive = useCallback(() => {
    const sectionId = getCurrentSectionId(editor);
    debug('[WysiwygEditor] Add interactive action clicked - entering single capture mode', { sectionId });
    fullScreenMode.enterFullScreenMode({ singleCapture: true, initialSectionId: sectionId || undefined });
  }, [fullScreenMode, editor]);

  // Handle "Section" button - open FormPanel for section creation
  const handleAddSequence = useCallback(() => {
    debug('[WysiwygEditor] Add sequence section clicked');
    stopEditing();
    setIsSectionFormOpen(true);
  }, [stopEditing]);

  // Close section form
  const closeSectionForm = useCallback(() => {
    setIsSectionFormOpen(false);
    stopEditing();
  }, [stopEditing]);

  // Handle section form submission
  const handleSectionFormSubmit = useCallback(
    (attributes: any) => {
      if (!editor) {
        return;
      }

      debug('[WysiwygEditor] Section form submitted', { attributes });

      try {
        // Insert a new sequence section at current cursor position
        editor
          .chain()
          .focus()
          .insertContent({
            type: 'sequenceSection',
            attrs: {
              class: 'sequence-section',
              'data-targetaction': ACTION_TYPES.SEQUENCE,
              id: attributes.id || `section-${Date.now()}`,
              ...attributes,
            },
            content: [
              {
                type: 'heading',
                attrs: { level: 3 },
                content: [{ type: 'text', text: attributes.id || 'New Section' }],
              },
              {
                type: 'bulletList',
                content: [
                  {
                    type: 'listItem',
                    content: [
                      {
                        type: 'paragraph',
                        content: [{ type: 'text', text: 'Add steps here...' }],
                      },
                    ],
                  },
                ],
              },
            ],
          })
          .run();

        debug('[WysiwygEditor] Section inserted successfully');
      } catch (error) {
        logError('[WysiwygEditor] Failed to insert section:', error);
      }

      closeSectionForm();
    },
    [editor, closeSectionForm]
  );

  // Convert EditState to EditElementData for FullScreenStepEditor
  // Extract actual content from the editor node
  const editElementData: EditElementData | null = useMemo(() => {
    if (!editState || editState.type === 'comment' || editState.type === 'sequence' || !editor) {
      return null;
    }

    const { pos, type, attributes } = editState;
    let textContent = '';
    let commentText = '';
    let nestedSteps: Array<{
      actionType: string;
      refTarget: string;
      targetValue?: string;
      requirements?: string;
      interactiveComment?: string;
      textContent?: string;
    }> = [];

    // Find the node at the position to extract its content
    try {
      const { state } = editor;
      const { doc } = state;

      // Determine node type name based on element type
      const nodeTypeName = type === 'listItem' ? 'listItem' : 'interactiveSpan';

      doc.nodesBetween(pos, pos + 1, (node, nodePos) => {
        if (node.type.name === nodeTypeName) {
          textContent = extractTextContent(node);
          commentText = extractCommentText(node);

          // Extract nested steps for multistep/guided blocks
          const actionType = attributes['data-targetaction'];
          if (type === 'listItem' && (actionType === 'multistep' || actionType === 'guided')) {
            nestedSteps = extractNestedSteps(node);
          }

          return false; // Stop iteration
        }
        return true;
      });
    } catch (err) {
      logError('[WysiwygEditor] Failed to extract node content:', err);
    }

    return {
      type,
      attributes,
      pos,
      textContent,
      commentText,
      nestedSteps: nestedSteps.length > 0 ? nestedSteps : undefined,
    };
  }, [editState, editor]);

  // Handle save from FullScreenStepEditor (edit mode)
  const handleSaveEdit = useCallback(
    (data: EditSaveData) => {
      if (!editor || !editState) {
        return;
      }

      debug('[WysiwygEditor] Saving edit', { data, editState });

      const { pos, type } = editState;

      try {
        // First, update the attributes
        const attributes: Record<string, string | null> = {
          'data-targetaction': data.actionType || null,
          'data-reftarget': data.refTarget || null,
          'data-targetvalue': data.targetValue || null,
          'data-requirements': data.requirements || null,
        };

        // Remove null/undefined values
        const cleanAttributes = Object.fromEntries(
          Object.entries(attributes).filter(([_, v]) => v !== null && v !== undefined)
        ) as Record<string, string>;

        switch (type) {
          case 'listItem':
            editor.commands.updateAttributes('listItem', cleanAttributes);
            break;
          case 'span':
            editor.commands.updateAttributes('interactiveSpan', cleanAttributes);
            break;
        }

        debug('[WysiwygEditor] Attributes updated successfully');

        // Now handle the interactive comment
        // We need to find the node and update its content
        if (type === 'span') {
          const { state } = editor;
          const { doc } = state;

          let targetNode: any = null;
          let targetPos = pos;

          doc.nodesBetween(pos, pos + 1, (node, nodePos) => {
            if (node.type.name === 'interactiveSpan') {
              targetNode = node;
              targetPos = nodePos;
              return false;
            }
            return true;
          });

          if (targetNode) {
            // Check if there's an existing comment
            let hasExistingComment = false;
            let existingCommentPos = -1;
            let existingCommentSize = 0;

            targetNode.content.forEach((child: any, offset: number) => {
              if (child.type.name === 'interactiveComment') {
                hasExistingComment = true;
                // Calculate the absolute position of the comment
                existingCommentPos = targetPos + 1 + offset;
                existingCommentSize = child.nodeSize;
              }
            });

            if (data.interactiveComment && data.interactiveComment.trim()) {
              // We want to add or update a comment
              if (hasExistingComment && existingCommentPos !== -1) {
                // Update existing comment - replace it
                editor
                  .chain()
                  .focus()
                  .setTextSelection({ from: existingCommentPos, to: existingCommentPos + existingCommentSize })
                  .deleteSelection()
                  .insertContent({
                    type: 'interactiveComment',
                    attrs: { class: CSS_CLASSES.INTERACTIVE_COMMENT },
                    content: [{ type: 'text', text: data.interactiveComment.trim() }],
                  })
                  .run();
                debug('[WysiwygEditor] Comment updated');
              } else {
                // Insert new comment at the end of the span content
                const insertPos = targetPos + targetNode.nodeSize - 1; // Before closing tag
                editor
                  .chain()
                  .focus()
                  .setTextSelection(insertPos)
                  .insertContent({
                    type: 'interactiveComment',
                    attrs: { class: CSS_CLASSES.INTERACTIVE_COMMENT },
                    content: [{ type: 'text', text: data.interactiveComment.trim() }],
                  })
                  .run();
                debug('[WysiwygEditor] Comment inserted');
              }
            } else if (hasExistingComment && existingCommentPos !== -1) {
              // No comment provided but one exists - remove it
              editor
                .chain()
                .focus()
                .setTextSelection({ from: existingCommentPos, to: existingCommentPos + existingCommentSize })
                .deleteSelection()
                .run();
              debug('[WysiwygEditor] Comment removed');
            }
          }
        }

        // Handle nested steps for multistep/guided blocks
        if (type === 'listItem' && data.nestedSteps && data.nestedSteps.length > 0) {
          const actionType = editState.attributes['data-targetaction'];
          if (actionType === 'multistep' || actionType === 'guided') {
            debug('[WysiwygEditor] Updating nested steps', { count: data.nestedSteps.length });

            // Find the list item node
            const { state } = editor;
            const { doc } = state;

            let listItemNode: any = null;
            let listItemPos = pos;

            doc.nodesBetween(pos, pos + 1, (node, nodePos) => {
              if (node.type.name === 'listItem') {
                listItemNode = node;
                listItemPos = nodePos;
                return false;
              }
              return true;
            });

            if (listItemNode) {
              // Find all nested interactive spans and update them
              let stepIndex = 0;
              const updates: Array<{ pos: number; attrs: Record<string, string> }> = [];

              // Traverse the list item content to find interactive spans
              let offset = 1; // Start after the list item opening
              listItemNode.content.forEach((child: any) => {
                if (child.type.name === 'interactiveSpan') {
                  const childActionType = child.attrs?.['data-targetaction'];
                  if (childActionType !== 'multistep' && childActionType !== 'guided') {
                    const nestedStep = data.nestedSteps![stepIndex];
                    if (nestedStep) {
                      updates.push({
                        pos: listItemPos + offset,
                        attrs: {
                          'data-targetaction': nestedStep.actionType,
                          'data-reftarget': nestedStep.refTarget,
                          'data-requirements': nestedStep.requirements || '',
                        },
                      });
                      stepIndex++;
                    }
                  }
                } else if (child.content) {
                  // Check nested content (e.g., paragraphs)
                  let nestedOffset = 1;
                  child.content.forEach((grandChild: any) => {
                    if (grandChild.type.name === 'interactiveSpan') {
                      const grandChildActionType = grandChild.attrs?.['data-targetaction'];
                      if (grandChildActionType !== 'multistep' && grandChildActionType !== 'guided') {
                        const nestedStep = data.nestedSteps![stepIndex];
                        if (nestedStep) {
                          updates.push({
                            pos: listItemPos + offset + nestedOffset,
                            attrs: {
                              'data-targetaction': nestedStep.actionType,
                              'data-reftarget': nestedStep.refTarget,
                              'data-requirements': nestedStep.requirements || '',
                            },
                          });
                          stepIndex++;
                        }
                      }
                    }
                    nestedOffset += grandChild.nodeSize;
                  });
                }
                offset += child.nodeSize;
              });

              // Apply updates in reverse order to avoid position shifts
              updates.reverse().forEach(({ pos: updatePos, attrs }) => {
                // Find the node at this position and update it
                doc.nodesBetween(updatePos, updatePos + 1, (node, nodePos) => {
                  if (node.type.name === 'interactiveSpan' && nodePos === updatePos) {
                    editor.commands.command(({ tr }) => {
                      tr.setNodeMarkup(nodePos, undefined, {
                        ...node.attrs,
                        ...attrs,
                      });
                      return true;
                    });
                    return false;
                  }
                  return true;
                });
              });

              debug('[WysiwygEditor] Nested steps updated', { updatedCount: updates.length });
            }
          }
        }

        // Handle moving element to a section (if specified)
        if (data.sectionId && type === 'listItem') {
          debug('[WysiwygEditor] Moving element to section', { sectionId: data.sectionId });

          const { state } = editor;
          const { doc } = state;

          // Find the list item node to move
          let nodeToMove: any = null;
          let nodePos = pos;

          doc.nodesBetween(pos, pos + 1, (node, foundPos) => {
            if (node.type.name === 'listItem') {
              nodeToMove = node;
              nodePos = foundPos;
              return false;
            }
            return true;
          });

          if (nodeToMove) {
            // Convert node to JSON for reinsertion
            const nodeJson = nodeToMove.toJSON();

            // Delete the node from current position
            editor.commands.command(({ tr }) => {
              tr.delete(nodePos, nodePos + nodeToMove.nodeSize);
              return true;
            });

            // Determine where to insert
            if (data.sectionId === 'new' && data.newSectionId) {
              // Create new section with this element
              const sectionTitle = data.newSectionTitle ? `<h3>${data.newSectionTitle}</h3>` : '';
              const sectionHtml = `${sectionTitle}<span id="${data.newSectionId}" class="interactive" data-targetaction="sequence" data-reftarget="span#${data.newSectionId}"><ul></ul></span>`;

              // Insert new section at end of document
              const endPos = editor.state.doc.content.size;
              editor.chain().focus().insertContentAt(endPos, sectionHtml).run();

              // Now find the section and insert the list item
              setTimeout(() => {
                const newDoc = editor.state.doc;
                let sectionListPos: number | null = null;

                newDoc.descendants((node, foundPos) => {
                  if (node.type.name === 'sequenceSection' && node.attrs.id === data.newSectionId) {
                    // Find the bulletList inside the section
                    node.descendants((child, childOffset) => {
                      if (child.type.name === 'bulletList') {
                        sectionListPos = foundPos + childOffset + 1;
                        return false;
                      }
                      return true;
                    });
                    return false;
                  }
                  return true;
                });

                if (sectionListPos !== null) {
                  editor.chain().focus().insertContentAt(sectionListPos, nodeJson).run();
                  debug('[WysiwygEditor] Element moved to new section');
                }
              }, 50);
            } else {
              // Move to existing section
              // Re-get the doc after deletion since positions have changed
              const updatedDoc = editor.state.doc;
              let sectionListEndPos: number | null = null;

              debug('[WysiwygEditor] Looking for section:', data.sectionId);

              updatedDoc.descendants((node, foundPos) => {
                // Check for sequenceSection nodes
                if (node.type.name === 'sequenceSection' && node.attrs.id === data.sectionId) {
                  debug('[WysiwygEditor] Found sequenceSection with matching ID at pos:', foundPos);
                  // Find the bulletList inside the section and get its end position
                  node.descendants((child, childOffset) => {
                    if (child.type.name === 'bulletList' || child.type.name === 'orderedList') {
                      // End position is before the closing tag of the list
                      sectionListEndPos = foundPos + childOffset + child.nodeSize;
                      debug('[WysiwygEditor] Found list at offset:', childOffset, 'endPos:', sectionListEndPos);
                      return false;
                    }
                    return true;
                  });
                  return false;
                }
                return true;
              });

              if (sectionListEndPos !== null) {
                // Insert before the closing tag of the list (inside it)
                editor
                  .chain()
                  .focus()
                  .insertContentAt(sectionListEndPos - 1, nodeJson)
                  .run();
                debug('[WysiwygEditor] Element moved to existing section');
              } else {
                logError('[WysiwygEditor] Could not find target section:', data.sectionId);
                // Log available sections for debugging
                updatedDoc.descendants((node) => {
                  if (node.type.name === 'sequenceSection') {
                    debug('[WysiwygEditor] Available section:', node.attrs.id);
                  }
                });
              }
            }
          }
        }
      } catch (error) {
        logError('[WysiwygEditor] Failed to update element:', error);
      }

      closeModal();
    },
    [editor, editState, closeModal]
  );

  // Handle delete from FullScreenStepEditor
  const handleDeleteElement = useCallback(() => {
    if (!editor || !editState) {
      return;
    }

    debug('[WysiwygEditor] Deleting element', { editState });

    try {
      const { pos, type } = editState;

      // Find and delete the node at position
      const { state } = editor;
      const { doc } = state;

      let nodeToDelete: any = null;
      let nodePos = pos;

      // Find the node at the position
      doc.nodesBetween(pos, pos + 1, (node, nodePosition) => {
        const isTargetNode =
          (type === 'listItem' && node.type.name === 'listItem') ||
          (type === 'sequence' && node.type.name === 'sequenceSection') ||
          (type === 'span' && node.type.name === 'interactiveSpan');

        if (isTargetNode) {
          nodeToDelete = node;
          nodePos = nodePosition;
          return false;
        }
        return true;
      });

      if (nodeToDelete) {
        editor
          .chain()
          .focus()
          .setTextSelection({ from: nodePos, to: nodePos + nodeToDelete.nodeSize })
          .deleteSelection()
          .run();

        debug('[WysiwygEditor] Element deleted successfully');
      } else {
        logError('[WysiwygEditor] Could not find node to delete at position:', pos);
      }
    } catch (error) {
      logError('[WysiwygEditor] Failed to delete element:', error);
    }

    closeModal();
  }, [editor, editState, closeModal]);

  // Determine if we should show the editor or the section form
  // Show when creating new section OR editing an existing section
  const isEditingSection = editState?.type === 'sequence';
  const showSectionForm = isSectionFormOpen || isEditingSection;

  return (
    <div className={`${styles.container} wysiwyg-editor-container`} data-testid={testIds.wysiwygEditor.container}>
      {/* Editor wrapper - hidden when section form is open */}
      <div className={`${sharedStyles.wrapper} ${showSectionForm ? styles.editorWrapperHidden : ''}`}>
        <Toolbar
          editor={editor}
          onAddInteractive={handleAddInteractive}
          onAddSequence={handleAddSequence}
          onAddComment={handleAddComment}
          onCopy={handleCopy}
          onDownload={handleDownload}
          onTest={testGuide}
          onReset={resetGuide}
          onToggleFullScreen={handleToggleFullScreen}
          isFullScreenActive={fullScreenMode.isActive}
        />

        <div className={sharedStyles.content} data-testid={testIds.wysiwygEditor.editorContent}>
          <EditorContent editor={editor} />
          {/* Floating bubble menu for text selection formatting */}
          <BubbleMenuBar editor={editor} />
        </div>
      </div>

      {/* Section Form Panel - shown when creating OR editing a section */}
      {showSectionForm && (
        <FormPanel
          onClose={() => {
            closeSectionForm();
            if (isEditingSection) {
              stopEditing();
            }
          }}
          editor={editor}
          editState={isEditingSection ? editState : null}
          onFormSubmit={handleSectionFormSubmit}
          initialSelectedActionType={ACTION_TYPES.SEQUENCE}
        />
      )}

      {/* Step Editor Modal - for editing existing interactive elements */}
      <FullScreenStepEditor
        isOpen={isModalOpen && editState?.type !== 'comment' && editState?.type !== 'sequence'}
        editData={editElementData}
        onSaveEdit={handleSaveEdit}
        onDelete={handleDeleteElement}
        onCancel={closeModal}
        existingSections={fullScreenMode.existingSections}
      />

      <CommentDialog
        isOpen={isCommentDialogOpen}
        onClose={closeCommentDialog}
        editor={editor}
        onInsert={handleInsertComment}
        initialText={commentDialogInitialText}
        mode={commentDialogMode}
      />

      {/* Export dialog for JSON export metadata */}
      <ExportDialog
        isOpen={isExportDialogOpen}
        onClose={closeExportDialog}
        onExport={performExport}
        mode={exportMode}
      />

      {/* Full Screen Mode Overlay - renders tooltip, step editor, and minimized sidebar */}
      <FullScreenModeOverlay editor={editor} fullScreenState={fullScreenMode} />
    </div>
  );
};

export default WysiwygEditor;
