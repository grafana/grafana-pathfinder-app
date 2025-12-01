/**
 * Mini step editor for bundling mode
 *
 * A compact modal that appears when a click is captured during multistep/guided bundling.
 * Allows authors to add optional interactive comments and requirements for each sub-step.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Modal, Button, Field, TextArea, Input, useStyles2, Stack, Badge } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';
import type { BundledStepEditorData, PendingClickInfo } from './hooks/useFullScreenMode';
import { testIds } from '../testIds';
import { ACTION_TYPES } from '../../constants/interactive-config';

interface BundlingStepEditorProps {
  /** The captured click information */
  pendingClick: PendingClickInfo;
  /** Current count of bundled steps (before this one) */
  stepCount: number;
  /** Action type being recorded (multistep or guided) */
  actionType: string;
  /** Called when user saves the step with optional data */
  onSave: (data: BundledStepEditorData) => void;
  /** Called when user skips adding data and just records the click */
  onSkip: () => void;
  /** Called when user cancels (doesn't record this click) */
  onCancel: () => void;
}

const getStyles = (theme: GrafanaTheme2) => ({
  modal: css`
    max-width: 500px;
  `,
  header: css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing(1)};
    margin-bottom: ${theme.spacing(2)};
  `,
  selectorPreview: css`
    font-family: ${theme.typography.fontFamilyMonospace};
    font-size: ${theme.typography.bodySmall.fontSize};
    background: ${theme.colors.background.secondary};
    padding: ${theme.spacing(1)};
    border-radius: ${theme.shape.radius.default};
    word-break: break-all;
    max-height: 60px;
    overflow: auto;
  `,
  actionBadge: css`
    text-transform: capitalize;
  `,
  hint: css`
    color: ${theme.colors.text.secondary};
    font-size: ${theme.typography.bodySmall.fontSize};
    margin-top: ${theme.spacing(0.5)};
  `,
  buttonGroup: css`
    display: flex;
    justify-content: flex-end;
    gap: ${theme.spacing(1)};
    margin-top: ${theme.spacing(2)};
  `,
});

export const BundlingStepEditor: React.FC<BundlingStepEditorProps> = ({
  pendingClick,
  stepCount,
  actionType,
  onSave,
  onSkip,
  onCancel,
}) => {
  const styles = useStyles2(getStyles);
  const [interactiveComment, setInteractiveComment] = useState('');
  const [requirements, setRequirements] = useState('');
  const commentRef = useRef<HTMLTextAreaElement>(null);

  // Define handleSave first so it can be used in effects
  const handleSave = useCallback(() => {
    onSave({
      interactiveComment: interactiveComment.trim() || undefined,
      requirements: requirements.trim() || undefined,
    });
  }, [interactiveComment, requirements, onSave]);

  // Focus the comment field on mount
  useEffect(() => {
    // Use setTimeout to ensure modal is fully rendered
    const timer = setTimeout(() => {
      commentRef.current?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        handleSave();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        onSkip();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleSave, onSkip]);

  const stepNumber = stepCount + 1;
  const actionLabel = actionType === ACTION_TYPES.GUIDED ? 'Guided' : 'Multistep';

  return (
    <Modal
      title={`${actionLabel} Step ${stepNumber}`}
      isOpen={true}
      onDismiss={onSkip}
      className={styles.modal}
      data-bundling-step-editor
      data-testid={testIds.wysiwygEditor.fullScreen.bundlingStepEditor.modal}
    >
      <div className={styles.header}>
        <Badge text={pendingClick.action} color="blue" className={styles.actionBadge} />
        <span>captured on element</span>
      </div>

      <div className={styles.selectorPreview}>{pendingClick.selector}</div>

      <Stack direction="column" gap={2}>
        <Field label="Interactive Comment" description="Optional: Add educational context for this step">
          <TextArea
            ref={commentRef}
            value={interactiveComment}
            onChange={(e) => setInteractiveComment(e.currentTarget.value)}
            placeholder="Explain why this step is important..."
            rows={3}
            data-testid={testIds.wysiwygEditor.fullScreen.bundlingStepEditor.commentInput}
          />
        </Field>

        <Field label="Requirements" description="Optional: Conditions for this step (e.g., exists-reftarget)">
          <Input
            value={requirements}
            onChange={(e) => setRequirements(e.currentTarget.value)}
            placeholder="exists-reftarget"
            data-testid={testIds.wysiwygEditor.fullScreen.bundlingStepEditor.requirementsInput}
          />
        </Field>
      </Stack>

      <p className={styles.hint}>Press Ctrl+Enter to save, Escape to skip</p>

      <div className={styles.buttonGroup}>
        <Button
          variant="secondary"
          onClick={onCancel}
          size="sm"
          data-testid={testIds.wysiwygEditor.fullScreen.bundlingStepEditor.cancelButton}
        >
          Cancel Recording
        </Button>
        <Button
          variant="secondary"
          onClick={onSkip}
          size="sm"
          data-testid={testIds.wysiwygEditor.fullScreen.bundlingStepEditor.skipButton}
        >
          Skip
        </Button>
        <Button
          variant="primary"
          onClick={handleSave}
          size="sm"
          data-testid={testIds.wysiwygEditor.fullScreen.bundlingStepEditor.saveButton}
        >
          Save & Continue
        </Button>
      </div>
    </Modal>
  );
};

export default BundlingStepEditor;
