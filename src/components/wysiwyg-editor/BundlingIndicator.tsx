/**
 * Bundling Indicator
 *
 * A floating indicator shown during multistep/guided recording mode.
 * Displays the count of collected steps and provides Finish/Cancel actions.
 *
 * CRITICAL: Uses data-bundling-indicator attribute to exclude from click interception.
 */

import React, { useCallback } from 'react';
import { Portal, Button, Badge, Icon, useStyles2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css, keyframes } from '@emotion/css';
import { testIds } from '../testIds';

const pulseAnimation = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
`;

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    position: 'fixed',
    bottom: theme.spacing(3),
    right: theme.spacing(3),
    zIndex: theme.zIndex.portal + 100,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: theme.spacing(1),
  }),
  indicator: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(2),
    padding: theme.spacing(1.5, 2),
    backgroundColor: theme.colors.background.primary,
    borderRadius: theme.shape.radius.default,
    border: `2px solid ${theme.colors.primary.border}`,
    boxShadow: theme.shadows.z3,
  }),
  recordingStatus: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
  }),
  recordingDot: css({
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    backgroundColor: theme.colors.error.main,
    animation: `${pulseAnimation} 1.5s ease-in-out infinite`,
  }),
  recordingText: css({
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
    fontSize: theme.typography.bodySmall.fontSize,
  }),
  stepCount: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
  }),
  buttonGroup: css({
    display: 'flex',
    gap: theme.spacing(1),
  }),
  finishButton: css({
    fontWeight: theme.typography.fontWeightBold,
  }),
  helpText: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    backgroundColor: theme.colors.background.secondary,
    padding: theme.spacing(1, 1.5),
    borderRadius: theme.shape.radius.default,
    maxWidth: '280px',
  }),
});

export interface BundlingIndicatorProps {
  /** Number of steps collected so far */
  stepCount: number;
  /** Action type being recorded (multistep or guided) */
  actionType: string;
  /** Called when user clicks Finish */
  onFinish: () => void;
  /** Called when user clicks Cancel */
  onCancel: () => void;
}

/**
 * Floating indicator for multistep/guided recording mode
 *
 * @example
 * ```tsx
 * <BundlingIndicator
 *   stepCount={3}
 *   actionType="multistep"
 *   onFinish={() => finishBundling('Description')}
 *   onCancel={cancelEdit}
 * />
 * ```
 */
export function BundlingIndicator({ stepCount, actionType, onFinish, onCancel }: BundlingIndicatorProps) {
  const styles = useStyles2(getStyles);

  const handleFinish = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onFinish();
    },
    [onFinish]
  );

  const handleCancel = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onCancel();
    },
    [onCancel]
  );

  const actionLabel = actionType === 'guided' ? 'Guided' : 'Multistep';

  return (
    <Portal>
      <div
        className={styles.container}
        data-bundling-indicator="true"
        data-testid={testIds.wysiwygEditor.fullScreen.bundlingIndicator}
      >
        {/* Help text */}
        <div className={styles.helpText}>
          Click elements to add them to this {actionLabel.toLowerCase()}. Press <strong>Finish</strong> when done.
        </div>

        {/* Main indicator */}
        <div className={styles.indicator}>
          <div className={styles.recordingStatus}>
            <div className={styles.recordingDot} />
            <span className={styles.recordingText}>Recording {actionLabel}</span>
          </div>

          <Badge text={`${stepCount} step${stepCount !== 1 ? 's' : ''}`} color="blue" />

          <div className={styles.buttonGroup}>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleCancel}
              tooltip="Cancel recording and discard all steps"
              data-testid={testIds.wysiwygEditor.fullScreen.bundlingStepEditor.cancelButton}
            >
              <Icon name="times" />
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleFinish}
              className={styles.finishButton}
              tooltip="Finish recording and create the multistep"
              disabled={stepCount === 0}
              data-testid={testIds.wysiwygEditor.fullScreen.bundlingStepEditor.saveButton}
            >
              <Icon name="check" />
              Finish
            </Button>
          </div>
        </div>
      </div>
    </Portal>
  );
}

export default BundlingIndicator;
