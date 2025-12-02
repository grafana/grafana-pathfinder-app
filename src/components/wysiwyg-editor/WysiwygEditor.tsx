import React, { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import { EditorContent } from '@tiptap/react';
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
import {
  FullScreenStepEditor,
  type EditElementData,
  type EditSaveData,
  type NestedStepData,
} from './FullScreenStepEditor';

// Hooks
import { useEditState } from './hooks/useEditState';
import { useEditorInitialization } from './hooks/useEditorInitialization';
import { useEditorPersistence } from './hooks/useEditorPersistence';
import { useEditorActions } from './hooks/useEditorActions';
import { useEditorModals } from './hooks/useEditorModals';
import { useFullScreenMode } from './hooks/useFullScreenMode';

// Constants
import { ACTION_TYPES } from '../../constants/interactive-config';

// Utils
import { debug, error as logError } from './utils/logger';

// Services
import { applyJsonUpdate, type SpanUpdateData, type ListItemUpdateData } from './services/jsonNodeUpdater';

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
 * Extract text content from a ProseMirror node, excluding comments and interactive spans.
 * For atomic interactiveSpan nodes, reads from the 'text' attribute.
 * For container nodes (like listItem), only extracts direct text, not nested interactive content.
 */
function extractTextContent(node: any, excludeInteractiveSpans = false): string {
  // For atomic nodes (interactiveSpan), text is stored in the text attribute
  if (node.type?.name === 'interactiveSpan' && node.attrs?.text) {
    return node.attrs.text;
  }

  let text = '';
  if (node.content) {
    node.content.forEach((child: any) => {
      // Skip interactiveComment nodes
      if (child.type?.name === 'interactiveComment') {
        return;
      }
      // Skip interactiveSpan nodes when extracting container description
      if (excludeInteractiveSpans && child.type?.name === 'interactiveSpan') {
        return;
      }
      if (child.type?.name === 'text' || child.isText) {
        text += child.text || '';
      } else if (child.content) {
        text += extractTextContent(child, excludeInteractiveSpans);
      }
    });
  }
  return text.trim();
}

/**
 * Extract interactive comment/tooltip text from a ProseMirror node.
 * For atomic interactiveSpan nodes, reads from the 'tooltip' attribute.
 * For legacy nodes, reads from nested interactiveComment children.
 */
function extractCommentText(node: any): string {
  // First, check if this node has a tooltip attribute (atomic interactiveSpan)
  if (node.attrs?.tooltip) {
    return node.attrs.tooltip.trim();
  }

  // Fall back to extracting from nested interactiveComment children
  let commentText = '';
  if (node.content) {
    node.content.forEach((child: any) => {
      if (child.type?.name === 'interactiveComment') {
        // For atomic comments, text is stored in the text attribute
        if (child.attrs?.text) {
          commentText += child.attrs.text;
        } else if (child.content) {
          // Fall back to extracting from content for non-atomic comments
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
 * Extract nested steps from a multistep or guided block.
 * For atomic nodes, reads text from the 'text' attribute.
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
  // Track comment siblings that follow spans
  let lastSpanIndex = -1;

  node.content.forEach((child: any, index: number) => {
    // Check if this is an interactive span (atomic node)
    if (child.type?.name === 'interactiveSpan' && child.attrs) {
      const actionType = child.attrs['data-targetaction'];
      const refTarget = child.attrs['data-reftarget'];

      // Skip if it's another multistep/guided container
      if (actionType === ACTION_TYPES.MULTISTEP || actionType === ACTION_TYPES.GUIDED) {
        return;
      }

      if (actionType && refTarget) {
        steps.push({
          actionType,
          refTarget,
          targetValue: child.attrs['data-targetvalue'] || undefined,
          requirements: child.attrs['data-requirements'] || undefined,
          // For atomic spans, tooltip is in the tooltip attribute
          interactiveComment: child.attrs.tooltip || undefined,
          // For atomic nodes, text is in the text attribute
          textContent: child.attrs.text || extractTextContent(child) || undefined,
        });
        lastSpanIndex = steps.length - 1;
      }
    }
    // Check for comment siblings (legacy - for backward compatibility)
    else if (child.type?.name === 'interactiveComment' && lastSpanIndex >= 0) {
      // Only fill if not already set from tooltip attribute
      if (!steps[lastSpanIndex].interactiveComment) {
        const commentText = child.attrs?.text || extractCommentText({ content: [child] });
        if (commentText && steps[lastSpanIndex]) {
          steps[lastSpanIndex].interactiveComment = commentText;
        }
      }
      lastSpanIndex = -1; // Reset after associating
    }
    // Also check paragraphs and other containers
    else if (child.content) {
      let lastNestedSpanIndex = -1;
      child.content.forEach((grandChild: any) => {
        if (grandChild.type?.name === 'interactiveSpan' && grandChild.attrs) {
          const actionType = grandChild.attrs['data-targetaction'];
          const refTarget = grandChild.attrs['data-reftarget'];

          if (actionType === ACTION_TYPES.MULTISTEP || actionType === ACTION_TYPES.GUIDED) {
            return;
          }

          if (actionType && refTarget) {
            steps.push({
              actionType,
              refTarget,
              targetValue: grandChild.attrs['data-targetvalue'] || undefined,
              requirements: grandChild.attrs['data-requirements'] || undefined,
              // For atomic spans, tooltip is in the tooltip attribute
              interactiveComment: grandChild.attrs.tooltip || undefined,
              // For atomic nodes, text is in the text attribute
              textContent: grandChild.attrs.text || extractTextContent(grandChild) || undefined,
            });
            lastNestedSpanIndex = steps.length - 1;
          }
        }
        // Check for comment siblings in nested content (legacy)
        else if (grandChild.type?.name === 'interactiveComment' && lastNestedSpanIndex >= 0) {
          // Only fill if not already set from tooltip attribute
          if (!steps[lastNestedSpanIndex].interactiveComment) {
            const commentText = grandChild.attrs?.text || extractCommentText({ content: [grandChild] });
            if (commentText && steps[lastNestedSpanIndex]) {
              steps[lastNestedSpanIndex].interactiveComment = commentText;
            }
          }
          lastNestedSpanIndex = -1;
        }
      });
    }
  });

  return steps;
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

  // State for action creation form (shows action selector first)
  const [isActionFormOpen, setIsActionFormOpen] = useState(false);

  // State for re-recording nested steps
  // Stores the original editState while re-recording, and the new steps after bundling
  const [reRecordingEditState, setReRecordingEditState] = useState<typeof editState | null>(null);
  const [reRecordedSteps, setReRecordedSteps] = useState<NestedStepData[] | null>(null);

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
    handleDeleteComment,
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
    pauseInterception: isModalOpen || isSectionFormOpen || isActionFormOpen,
  });

  // Toggle full screen mode
  const handleToggleFullScreen = useCallback(() => {
    if (fullScreenMode.isActive) {
      fullScreenMode.exitFullScreenMode();
    } else {
      fullScreenMode.enterFullScreenMode();
    }
  }, [fullScreenMode]);

  // Handle re-recording completion: when bundling-review is reached while re-recording,
  // convert the bundled steps and re-open the edit modal
  useEffect(() => {
    if (fullScreenMode.state === 'bundling-review' && reRecordingEditState) {
      debug('[WysiwygEditor] Re-recording finished, converting steps', {
        bundledStepsCount: fullScreenMode.bundledSteps.length,
      });

      // Convert bundledSteps (PendingClickInfo[]) to NestedStepData[]
      const newSteps: NestedStepData[] = fullScreenMode.bundledSteps.map((step) => ({
        actionType: step.action || ACTION_TYPES.HIGHLIGHT,
        refTarget: step.selector,
        requirements: step.requirements,
        interactiveComment: step.interactiveComment,
        textContent: step.selector, // Use selector as display text
      }));

      // Store the new steps
      setReRecordedSteps(newSteps);

      // Clear bundled steps and exit full screen mode
      fullScreenMode.clearSteps();
      fullScreenMode.exitFullScreenMode();

      // Restore the original editState to re-open the modal
      // The editElementData will use reRecordedSteps
      startEditing(
        reRecordingEditState.type,
        reRecordingEditState.attributes,
        reRecordingEditState.pos,
        reRecordingEditState.commentText
      );

      // Clear the re-recording state
      setReRecordingEditState(null);

      // Open the modal
      openModal();
    }
  }, [
    fullScreenMode.state,
    fullScreenMode.bundledSteps,
    reRecordingEditState,
    fullScreenMode,
    startEditing,
    openModal,
  ]);

  // Handle "Action" button - open action creation form
  // Shows action type selector first, then form with selector capture option
  const handleAddInteractive = useCallback(() => {
    debug('[WysiwygEditor] Add interactive action clicked - opening action form');
    stopEditing();
    setIsActionFormOpen(true);
  }, [stopEditing]);

  // Close action form
  const closeActionForm = useCallback(() => {
    setIsActionFormOpen(false);
    stopEditing();
  }, [stopEditing]);

  // Handle action form submission
  const handleActionFormSubmit = useCallback(
    (attributes: any) => {
      debug('[WysiwygEditor] Action form submitted', { attributes });
      // Form handles insertion via insertNewInteractiveElement
      // Just close the form
      closeActionForm();
    },
    [closeActionForm]
  );

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
                content: [{ type: 'text', text: attributes.id || 'New section' }],
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
    let sectionId: string | undefined;
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

      // Check if this is a multistep/guided block (need to exclude nested spans from description)
      const actionType = attributes['data-targetaction'];
      const isMultistepOrGuided =
        type === 'listItem' && (actionType === ACTION_TYPES.MULTISTEP || actionType === ACTION_TYPES.GUIDED);

      doc.nodesBetween(pos, pos + 1, (node, nodePos) => {
        if (node.type.name === nodeTypeName) {
          // For multistep/guided, exclude nested interactiveSpan content from description
          textContent = extractTextContent(node, isMultistepOrGuided);
          commentText = extractCommentText(node);

          // Extract nested steps for multistep/guided blocks
          // Use reRecordedSteps if available (from re-recording flow)
          if (isMultistepOrGuided) {
            if (reRecordedSteps && reRecordedSteps.length > 0) {
              nestedSteps = reRecordedSteps;
            } else {
              nestedSteps = extractNestedSteps(node);
            }
          }

          return false; // Stop iteration
        }
        return true;
      });

      // Detect parent section by traversing from the position
      // Use $pos to find ancestor nodes
      const $pos = doc.resolve(pos);
      for (let i = $pos.depth; i > 0; i--) {
        const ancestorNode = $pos.node(i);
        if (ancestorNode.type.name === 'sequenceSection') {
          sectionId = ancestorNode.attrs.id;
          break;
        }
      }
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
      sectionId,
    };
  }, [editState, editor, reRecordedSteps]);

  // Handle save from FullScreenStepEditor (edit mode)
  // Uses JSON-based approach: get document as JSON, update node, replace content
  const handleSaveEdit = useCallback(
    (data: EditSaveData) => {
      if (!editor || !editState) {
        return;
      }

      debug('[WysiwygEditor] Saving edit (JSON approach)', { data, editState });

      const { pos, type } = editState;

      try {
        // Use the JSON-based approach for cleaner updates
        if (type === 'span') {
          // Build update data for span
          const spanUpdate: SpanUpdateData = {
            actionType: data.actionType,
            refTarget: data.refTarget,
            targetValue: data.targetValue,
            requirements: data.requirements,
            text: data.description?.trim() || '',
            tooltip: data.interactiveComment?.trim() || '',
          };

          const success = applyJsonUpdate(editor, 'span', pos, spanUpdate);
          if (success) {
            debug('[WysiwygEditor] Span updated successfully via JSON');
          } else {
            logError('[WysiwygEditor] Failed to update span via JSON');
          }
        } else if (type === 'listItem') {
          // Build update data for list item
          const listItemUpdate: ListItemUpdateData = {
            actionType: data.actionType,
            refTarget: data.refTarget,
            targetValue: data.targetValue,
            requirements: data.requirements,
            description: data.description?.trim(),
            nestedSteps: data.nestedSteps?.map((step) => ({
              actionType: step.actionType,
              refTarget: step.refTarget,
              targetValue: step.targetValue,
              requirements: step.requirements,
              text: step.textContent || step.refTarget,
              tooltip: step.interactiveComment,
            })),
          };

          const success = applyJsonUpdate(editor, 'listItem', pos, listItemUpdate);
          if (success) {
            debug('[WysiwygEditor] ListItem updated successfully via JSON');
          } else {
            logError('[WysiwygEditor] Failed to update listItem via JSON');
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

      // Clear re-recorded steps and close modal
      setReRecordedSteps(null);
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

    // Clear re-recorded steps and close modal
    setReRecordedSteps(null);
    closeModal();
  }, [editor, editState, closeModal]);

  // Handle re-recording for multistep/guided elements
  // Stores the current editState, closes the modal, and enters bundling mode
  // When bundling finishes, the new steps will replace the old ones in the modal
  const handleStartReRecording = useCallback(() => {
    if (!editState || !editElementData) {
      return;
    }

    const actionType = editElementData.attributes?.['data-targetaction'];
    debug('[WysiwygEditor] Starting re-recording for element', { editState, actionType });

    // Store the current editState so we can come back to it
    setReRecordingEditState(editState);
    setReRecordedSteps(null);

    // Close the modal
    closeModal();

    // Clear any previous bundled steps and enter bundling mode
    fullScreenMode.clearSteps();

    // We need to start bundling mode directly - this requires a "fake" first click
    // For re-recording, we enter full screen mode and user will select multistep/guided again
    fullScreenMode.enterFullScreenMode();
  }, [editState, editElementData, closeModal, fullScreenMode]);

  // Handle closing the modal - also clears re-recorded steps
  const handleCloseModal = useCallback(() => {
    setReRecordedSteps(null);
    closeModal();
  }, [closeModal]);

  // Determine if we should show the editor or a form panel
  // Show when creating new section OR editing an existing section
  const isEditingSection = editState?.type === 'sequence';
  const showSectionForm = isSectionFormOpen || isEditingSection;
  // Show action form when creating a new action (not editing)
  const showActionForm = isActionFormOpen && !editState;

  return (
    <div className={`${styles.container} wysiwyg-editor-container`} data-testid={testIds.wysiwygEditor.container}>
      {/* Editor wrapper - hidden when section or action form is open */}
      <div className={`${sharedStyles.wrapper} ${showSectionForm || showActionForm ? styles.editorWrapperHidden : ''}`}>
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

      {/* Action Form Panel - shown when creating a new action */}
      {showActionForm && (
        <FormPanel
          onClose={closeActionForm}
          editor={editor}
          editState={null}
          onFormSubmit={handleActionFormSubmit}
          initialSelectedActionType={null}
        />
      )}

      {/* Step Editor Modal - for editing existing interactive elements */}
      <FullScreenStepEditor
        isOpen={isModalOpen && editState?.type !== 'comment' && editState?.type !== 'sequence'}
        editData={editElementData}
        onSaveEdit={handleSaveEdit}
        onDelete={handleDeleteElement}
        onCancel={handleCloseModal}
        existingSections={fullScreenMode.existingSections}
        onStartReRecording={
          editElementData?.attributes?.['data-targetaction'] === ACTION_TYPES.MULTISTEP ||
          editElementData?.attributes?.['data-targetaction'] === ACTION_TYPES.GUIDED
            ? handleStartReRecording
            : undefined
        }
      />

      <CommentDialog
        isOpen={isCommentDialogOpen}
        onClose={closeCommentDialog}
        editor={editor}
        onInsert={handleInsertComment}
        onDelete={handleDeleteComment}
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
