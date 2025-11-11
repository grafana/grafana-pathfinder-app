import React from 'react';
import { useStyles2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';
import { Editor } from '@tiptap/react';

// Form imports
import ActionSelector from './forms/ActionSelector';
import ButtonActionForm from './forms/ButtonActionForm';
import HighlightActionForm from './forms/HighlightActionForm';
import FormFillActionForm from './forms/FormFillActionForm';
import NavigateActionForm from './forms/NavigateActionForm';
import HoverActionForm from './forms/HoverActionForm';
import MultistepActionForm from './forms/MultistepActionForm';
import SequenceActionForm from './forms/SequenceActionForm';
import { EditState } from './types';
import { ACTION_TYPES } from '../../constants/interactive-config';
import { debug, error as logError } from './utils/logger';
import { isInsideSequenceSectionListItem } from './services/editorOperations';

interface FormPanelProps {
  onClose: () => void;
  editor: Editor | null;
  editState: EditState | null;
  onFormSubmit: (attributes: Record<string, any>) => void;
}

const getStyles = (theme: GrafanaTheme2) => ({
  // Panel wrapper matches editorWrapper CSS exactly
  panelWrapper: css({
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(2),
    overflow: 'hidden',
  }),
  // Panel content matches editorContent CSS for inner container
  panelContent: css({
    flex: 1,
    overflow: 'auto',
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    backgroundColor: theme.colors.background.primary,
    padding: theme.spacing(2),
  }),
  panelTitle: css({
    fontSize: theme.typography.h3.fontSize,
    fontWeight: theme.typography.h3.fontWeight,
    margin: 0,
    marginBottom: theme.spacing(2),
    color: theme.colors.text.primary,
  }),
});

/**
 * Insert a new interactive element into the editor
 */
const insertNewInteractiveElement = (editor: Editor, attributes: Record<string, any>) => {
  const actionType = attributes['data-targetaction'];
  const { from, to } = editor.state.selection;
  const hasSelection = from !== to;

  debug('[FormPanel] Inserting interactive element', {
    actionType,
    attributes,
    hasSelection,
    selectionRange: { from, to },
  });

  try {
    if (actionType === ACTION_TYPES.SEQUENCE) {
      // Sequence sections: Insert BEFORE selection without destroying it
      const insertPos = hasSelection ? from : undefined;

      if (!editor.can().insertContent({ type: 'sequenceSection' })) {
        logError('[FormPanel] Cannot insert sequence section at current position');
        throw new Error('Cannot insert sequence section at current cursor position');
      }

      const sequenceContent = {
        type: 'sequenceSection',
        attrs: attributes,
        content: [
          {
            type: 'heading',
            attrs: { level: 3 },
            content: [{ type: 'text', text: 'Section Title' }],
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Add content here...' }],
          },
        ],
      };

      if (insertPos !== undefined) {
        // Insert before selection
        editor.chain().focus().insertContentAt(insertPos, sequenceContent).run();
      } else {
        // Insert at cursor
        editor.chain().focus().insertContent(sequenceContent).run();
      }
    } else if (actionType === ACTION_TYPES.MULTISTEP) {
      // Multistep: Wrap selection in listItem if present
      if (!editor.can().insertContent({ type: 'bulletList' })) {
        logError('[FormPanel] Cannot insert bullet list at current position');
        throw new Error('Cannot insert multistep action at current cursor position');
      }

      if (hasSelection) {
        // Replace selection with bulletList containing selected content
        const selectedContent = editor.state.doc.slice(from, to).content.toJSON();
        editor
          .chain()
          .focus()
          .insertContentAt(
            { from, to },
            {
              type: 'bulletList',
              content: [
                {
                  type: 'listItem',
                  attrs: attributes,
                  content: [
                    {
                      type: 'paragraph',
                      content: selectedContent,
                    },
                  ],
                },
              ],
            }
          )
          .run();
      } else {
        // Insert at cursor with default text
        editor
          .chain()
          .focus()
          .insertContent({
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                attrs: attributes,
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Action description' }],
                  },
                ],
              },
            ],
          })
          .run();
      }
    } else {
      // Inline spans: Check if we're inside a list item within a sequence section
      // If so, convert to interactive list item instead of creating a span
      if (isInsideSequenceSectionListItem(editor)) {
        debug('[FormPanel] Converting interactive span to list item (inside sequence section)');

        // Apply attributes directly to the list item
        // Ensure class="interactive" is included
        const listItemAttributes = {
          ...attributes,
          class: attributes.class || 'interactive',
        };

        const success = editor.chain().focus().updateAttributes('listItem', listItemAttributes).run();

        if (!success) {
          logError('[FormPanel] Failed to convert to interactive list item');
          throw new Error('Cannot convert to interactive list item at current position');
        }

        debug('[FormPanel] Successfully converted to interactive list item');
        return;
      }

      // Normal inline span behavior (not in sequence section)
      const displayText = attributes['data-reftarget'] || 'Interactive action';

      if (!editor.can().insertContent({ type: 'interactiveSpan' })) {
        logError('[FormPanel] Cannot insert interactive span at current position');
        throw new Error('Cannot insert interactive action at current cursor position');
      }

      if (hasSelection) {
        // Wrap selected content in interactiveSpan
        const selectedContent = editor.state.doc.slice(from, to).content.toJSON();
        editor
          .chain()
          .focus()
          .insertContentAt(
            { from, to },
            {
              type: 'interactiveSpan',
              attrs: attributes,
              content: selectedContent,
            }
          )
          .run();
      } else {
        // Insert with default text at cursor
        editor
          .chain()
          .focus()
          .insertContent({
            type: 'interactiveSpan',
            attrs: attributes,
            content: [{ type: 'text', text: displayText }],
          })
          .run();
      }
    }

    debug('[FormPanel] Element inserted successfully', { actionType, hasSelection });
  } catch (err) {
    logError('[FormPanel] Failed to insert interactive element:', err);
    throw err;
  }
};

/**
 * FormPanel Component
 *
 * Renders a panel containing the appropriate form based on the current edit state.
 * Replaces the editor area when forms are open, using identical CSS sizing to prevent layout shifts.
 * Implements two-step flow: select action type, then configure and insert.
 */
export const FormPanel: React.FC<FormPanelProps> = ({ onClose, editor, editState, onFormSubmit }) => {
  const styles = useStyles2(getStyles);

  // Track selected action type during creation (when editState is null)
  const [selectedActionType, setSelectedActionType] = React.useState<string | null>(null);

  // Reset selectedActionType when panel closes (component unmounts or editState becomes null)
  // This is handled by the parent component's conditional rendering
  // When FormPanel unmounts, state will reset on next mount

  // Determine which form to show based on edit state or selected action type
  const renderForm = () => {
    if (!editor) {
      return null;
    }

    // Determine which action type to use
    let actionType: string;

    if (editState) {
      // Edit mode: use action type from editState
      actionType = editState.attributes['data-targetaction'] || '';
    } else if (selectedActionType) {
      // Creation mode after action selection
      actionType = selectedActionType;
    } else {
      // Creation mode: show action selector
      return (
        <ActionSelector
          onSelect={(actionType: string) => {
            // Set selected action type to show the configuration form
            setSelectedActionType(actionType);
          }}
          onCancel={onClose}
        />
      );
    }

    // Build form props for both edit and create modes
    const formProps = {
      editor,
      initialValues: editState ? (editState.attributes as any) : undefined,
      onApply: (attrs: Record<string, any>) => {
        try {
          if (editState) {
            // Edit mode: update existing element
            onFormSubmit(attrs);
          } else {
            // Creation mode: insert new element
            insertNewInteractiveElement(editor, attrs);
          }
          onClose();
        } catch (err) {
          logError('[FormPanel] Failed to apply changes:', err);
          // Keep panel open on error so user can retry
        }
      },
      onCancel: onClose,
    };

    // Render appropriate form based on action type
    switch (actionType) {
      case ACTION_TYPES.BUTTON:
        return <ButtonActionForm {...formProps} />;
      case ACTION_TYPES.HIGHLIGHT:
        return <HighlightActionForm {...formProps} />;
      case ACTION_TYPES.FORM_FILL:
        return <FormFillActionForm {...formProps} />;
      case ACTION_TYPES.NAVIGATE:
        return <NavigateActionForm {...formProps} />;
      case ACTION_TYPES.HOVER:
        return <HoverActionForm {...formProps} />;
      case ACTION_TYPES.MULTISTEP:
        return <MultistepActionForm {...formProps} />;
      case ACTION_TYPES.SEQUENCE:
        return <SequenceActionForm {...formProps} />;
      default:
        return <ActionSelector onSelect={(type) => setSelectedActionType(type)} onCancel={onClose} />;
    }
  };

  const getTitle = () => {
    // Determine action type from either editState or selectedActionType
    const actionType = editState ? editState.attributes['data-targetaction'] : selectedActionType;

    if (!actionType) {
      return 'Select Action Type';
    }

    const typeLabels: Record<string, string> = {
      [ACTION_TYPES.BUTTON]: 'Button Action',
      [ACTION_TYPES.HIGHLIGHT]: 'Highlight Action',
      [ACTION_TYPES.FORM_FILL]: 'Form Fill Action',
      [ACTION_TYPES.NAVIGATE]: 'Navigate Action',
      [ACTION_TYPES.HOVER]: 'Hover Action',
      [ACTION_TYPES.MULTISTEP]: 'Multi-Step Action',
      [ACTION_TYPES.SEQUENCE]: 'Sequence Section',
    };

    const prefix = editState ? 'Edit' : 'Create';
    return `${prefix} ${typeLabels[actionType] || 'Interactive Element'}`;
  };

  return (
    <div className={styles.panelWrapper}>
      <div className={styles.panelContent}>
        <h3 className={styles.panelTitle}>{getTitle()}</h3>
        {renderForm()}
      </div>
    </div>
  );
};

export default FormPanel;
