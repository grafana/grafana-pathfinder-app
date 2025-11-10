import React from 'react';
import { Modal } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
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

interface FormModalProps {
  isOpen: boolean;
  onClose: () => void;
  editor: Editor | null;
  editState: EditState | null;
  onFormSubmit: (attributes: Record<string, any>) => void;
}

const getStyles = (theme: GrafanaTheme2) => ({
  modalContent: css({
    padding: theme.spacing(2),
  }),
  modal: css({
    width: '600px',
    maxWidth: '90vw',
  }),
});

/**
 * Insert a new interactive element into the editor
 */
const insertNewInteractiveElement = (editor: Editor, attributes: Record<string, any>) => {
  const actionType = attributes['data-targetaction'];
  const { from, to } = editor.state.selection;
  const hasSelection = from !== to;
  
  debug('[FormModal] Inserting interactive element', { 
    actionType, 
    attributes, 
    hasSelection,
    selectionRange: { from, to }
  });

  try {
    if (actionType === ACTION_TYPES.SEQUENCE) {
      // Sequence sections: Insert BEFORE selection without destroying it
      const insertPos = hasSelection ? from : undefined;
      
      if (!editor.can().insertContent({ type: 'sequenceSection' })) {
        logError('[FormModal] Cannot insert sequence section at current position');
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
        logError('[FormModal] Cannot insert bullet list at current position');
        throw new Error('Cannot insert multistep action at current cursor position');
      }

      if (hasSelection) {
        // Replace selection with bulletList containing selected content
        const selectedContent = editor.state.doc.slice(from, to).content.toJSON();
        editor.chain().focus().insertContentAt(
          { from, to },
          {
            type: 'bulletList',
            content: [{
              type: 'listItem',
              attrs: attributes,
              content: [{
                type: 'paragraph',
                content: selectedContent,
              }],
            }],
          }
        ).run();
      } else {
        // Insert at cursor with default text
        editor.chain().focus().insertContent({
          type: 'bulletList',
          content: [{
            type: 'listItem',
            attrs: attributes,
            content: [{
              type: 'paragraph',
              content: [{ type: 'text', text: 'Action description' }],
            }],
          }],
        }).run();
      }
      
    } else {
      // Inline spans: Check if we're inside a list item within a sequence section
      // If so, convert to interactive list item instead of creating a span
      if (isInsideSequenceSectionListItem(editor)) {
        debug('[FormModal] Converting interactive span to list item (inside sequence section)');
        
        // Apply attributes directly to the list item
        // Ensure class="interactive" is included
        const listItemAttributes = {
          ...attributes,
          class: attributes.class || 'interactive',
        };
        
        const success = editor.chain().focus().updateAttributes('listItem', listItemAttributes).run();
        
        if (!success) {
          logError('[FormModal] Failed to convert to interactive list item');
          throw new Error('Cannot convert to interactive list item at current position');
        }
        
        debug('[FormModal] Successfully converted to interactive list item');
        return;
      }
      
      // Normal inline span behavior (not in sequence section)
      const displayText = attributes['data-reftarget'] || 'Interactive action';
      
      if (!editor.can().insertContent({ type: 'interactiveSpan' })) {
        logError('[FormModal] Cannot insert interactive span at current position');
        throw new Error('Cannot insert interactive action at current cursor position');
      }

      if (hasSelection) {
        // Wrap selected content in interactiveSpan
        const selectedContent = editor.state.doc.slice(from, to).content.toJSON();
        editor.chain().focus().insertContentAt(
          { from, to },
          {
            type: 'interactiveSpan',
            attrs: attributes,
            content: selectedContent,
          }
        ).run();
      } else {
        // Insert with default text at cursor
        editor.chain().focus().insertContent({
          type: 'interactiveSpan',
          attrs: attributes,
          content: [{ type: 'text', text: displayText }],
        }).run();
      }
    }

    debug('[FormModal] Element inserted successfully', { actionType, hasSelection });
  } catch (err) {
    logError('[FormModal] Failed to insert interactive element:', err);
    throw err;
  }
};

/**
 * FormModal Component
 * 
 * Renders a Grafana UI Modal containing the appropriate form based on the current edit state.
 * Uses a centered modal that doesn't interfere with sidebars.
 * Implements two-step flow: select action type, then configure and insert.
 */
export const FormModal: React.FC<FormModalProps> = ({
  isOpen,
  onClose,
  editor,
  editState,
  onFormSubmit,
}) => {
  const styles = useStyles2(getStyles);
  
  // Track selected action type during creation (when editState is null)
  const [selectedActionType, setSelectedActionType] = React.useState<string | null>(null);
  
  // Reset selectedActionType when modal closes
  React.useEffect(() => {
    if (!isOpen) {
      setSelectedActionType(null);
    }
  }, [isOpen]);

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
          logError('[FormModal] Failed to apply changes:', err);
          // Keep modal open on error so user can retry
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
    const actionType = editState 
      ? editState.attributes['data-targetaction'] 
      : selectedActionType;
    
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

  // Don't render modal at all when closed to prevent auto-opening
  if (!isOpen) {
    return null;
  }

  return (
    <Modal
      title={getTitle()}
      isOpen={isOpen}
      onDismiss={onClose}
      className={styles.modal}
    >
      <div className={styles.modalContent}>
        {renderForm()}
      </div>
    </Modal>
  );
};

export default FormModal;

