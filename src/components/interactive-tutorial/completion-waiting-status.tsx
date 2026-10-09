import React from 'react';
import { Button } from '@grafana/ui';

import { getPostVerifyExplanation } from '../../requirements-manager';
import { t } from '@grafana/i18n';
import { testIds } from '../../constants/testIds';

interface CompletionWaitingStatusProps {
  id: string;
  unmet?: string;
  onCheck: () => void;
}

export function CompletionWaitingStatus({ id, unmet, onCheck }: CompletionWaitingStatusProps) {
  const explanation = unmet ? getPostVerifyExplanation(unmet) : undefined;
  const friendlyExplanation = explanation?.includes(unmet!) ? undefined : explanation;
  return (
    <div
      className="interactive-completion-waiting"
      role="status"
      data-testid={testIds.interactive.completionWaiting(id)}
    >
      <span>
        {friendlyExplanation
          ? t('completion.waiting-reason', 'Waiting for completion: {{reason}}', { reason: friendlyExplanation })
          : t('completion.waiting', 'Waiting for completion')}
      </span>{' '}
      <Button
        size="sm"
        variant="secondary"
        onClick={onCheck}
        data-testid={testIds.interactive.checkCompletionButton(id)}
      >
        {t('completion.check', 'Check completion')}
      </Button>
    </div>
  );
}
