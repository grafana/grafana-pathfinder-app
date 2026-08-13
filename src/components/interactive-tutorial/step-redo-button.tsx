import React from 'react';
import { Button } from '@grafana/ui';

import { testIds } from '../../constants/testIds';

interface StepRedoButtonProps {
  stepId: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}

export function StepRedoButton({ stepId, onClick, disabled = false, title }: StepRedoButtonProps) {
  return (
    <Button
      size="sm"
      variant="secondary"
      fill="text"
      onClick={onClick}
      disabled={disabled}
      data-testid={testIds.interactive.redoButton(stepId)}
      title={title ?? 'Redo this step'}
    >
      ↻ Redo
    </Button>
  );
}
