import React from 'react';
import { useStyles2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';
import { Editor } from '@tiptap/react';

import { EditState, InteractiveAttributesOutput } from './types';
import { InteractiveFormContent } from './forms/InteractiveFormContent';

interface FormPanelProps {
  onClose: () => void;
  editor: Editor | null;
  editState: EditState | null;
  onFormSubmit: (attributes: InteractiveAttributesOutput) => void;
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

  const getTitle = () => {
    // Determine action type from either editState or selectedActionType
    const actionType = editState ? editState.attributes['data-targetaction'] : selectedActionType;

    if (!actionType) {
      return 'Select Action Type';
    }

    const prefix = editState ? 'Edit' : 'Create';
    return `${prefix} ${actionType}`;
  };

  return (
    <div className={styles.panelWrapper}>
      <div className={styles.panelContent}>
        <h3 className={styles.panelTitle}>{getTitle()}</h3>
        <InteractiveFormContent
          editor={editor}
          editState={editState}
          selectedActionType={selectedActionType}
          onSelectActionType={setSelectedActionType}
          onFormSubmit={onFormSubmit}
          onCancel={onClose}
        />
      </div>
    </div>
  );
};

export default FormPanel;
