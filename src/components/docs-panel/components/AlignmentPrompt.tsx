/**
 * Alignment prompt for the implied 0th step.
 *
 * Renders before step 1 when the user's current location doesn't match the
 * guide's `startingLocation`. Two actions: navigate to the starting location
 * (Confirm) or proceed in place and let the existing on-page `Fix this`
 * handle it (Cancel).
 *
 * @see docs/design/AUTORECOVERY_DESIGN.md § "The implied 0th step"
 */

import React from 'react';
import { Alert, Button } from '@grafana/ui';
import { t } from '@grafana/i18n';
import { testIds } from '../../../constants/testIds';

export interface AlignmentPromptProps {
  /** The path the guide expects to start on */
  startingLocation: string;
  /** Confirm: caller is responsible for navigation */
  onConfirm: () => void;
  /** Cancel: caller clears the pending state without navigating */
  onCancel: () => void;
}

export const AlignmentPrompt: React.FC<AlignmentPromptProps> = ({ startingLocation, onConfirm, onCancel }) => {
  return (
    <div data-testid={testIds.alignmentPrompt.container}>
      <Alert severity="info" title={t('alignmentPrompt.title', 'Navigate to start this guide?')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <p style={{ margin: 0 }}>
            {t('alignmentPrompt.message', 'This guide starts on')} <code>{startingLocation}</code>.
          </p>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button size="sm" onClick={onConfirm} data-testid={testIds.alignmentPrompt.confirmButton}>
              {t('alignmentPrompt.confirm', 'Navigate')}
            </Button>
            <Button size="sm" variant="secondary" onClick={onCancel} data-testid={testIds.alignmentPrompt.cancelButton}>
              {t('alignmentPrompt.cancel', 'Continue here')}
            </Button>
          </div>
        </div>
      </Alert>
    </div>
  );
};
