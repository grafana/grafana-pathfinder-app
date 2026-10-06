import React from 'react';
import { Button } from '@grafana/ui';

import { getPostVerifyExplanation } from '../../requirements-manager';
import { testIds } from '../../constants/testIds';

interface CompletionWaitingStatusProps {
  id: string;
  unmet?: string;
  onCheck: () => void;
}

export function CompletionWaitingStatus({ id, unmet, onCheck }: CompletionWaitingStatusProps) {
  return (
    <div
      className="interactive-completion-waiting"
      role="status"
      data-testid={testIds.interactive.completionWaiting(id)}
    >
      <span>{unmet ? `Waiting for completion: ${getPostVerifyExplanation(unmet)}` : 'Waiting for completion'}</span>{' '}
      <Button
        size="sm"
        variant="secondary"
        onClick={onCheck}
        data-testid={testIds.interactive.checkCompletionButton(id)}
      >
        Check completion
      </Button>
    </div>
  );
}
